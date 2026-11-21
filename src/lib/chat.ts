import "server-only";
import { and, asc, count, desc, eq, gt, inArray, max, ne, or, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { answers, chatMembers, chatMessages, chatReactions, chats, gamePlayers, gameSongs, games, users } from "@/db/schema";
import { publishChatUpdate } from "./live";
import { openRound, roundLabel } from "./modes";
import {
  CHAT_PAGE,
  chatTitle,
  cleanMessage,
  heldUntil,
  isReactionKind,
  memberKey,
  reactionCounts,
  type ChatHold,
  type ReaderProgress,
} from "./chat-rules";

// Chat: one per exact group of players, kept across games (Pass the Aux and
// solo games have none). Everything a player sees goes through here, so a
// message held back by a game in progress never leaves the server: the phone
// gets sparkles, not the words. The rules are in chat-rules.ts.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** A player can send this many messages a minute (a stuck key or a runaway script, not a chatty friend). */
const MESSAGES_PER_MINUTE = 30;

/** The chat for this exact group of players, made if it doesn't exist yet, with everyone in it. */
export async function chatForPlayers(q: Db | Tx, userIds: string[]): Promise<string> {
  const key = memberKey(userIds);
  const [row] = await q
    .insert(chats)
    .values({ memberKey: key })
    .onConflictDoUpdate({ target: chats.memberKey, set: { memberKey: key } })
    .returning({ id: chats.id });
  await q
    .insert(chatMembers)
    .values([...new Set(userIds)].map((userId) => ({ chatId: row.id, userId })))
    .onConflictDoNothing();
  return row.id;
}

async function membership(chatId: string, userId: string) {
  const [m] = await db
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
    .limit(1);
  return m ?? null;
}

/** How far this player has got in each of these games (for holding messages back). */
async function readerProgress(userId: string, gameIds: string[]): Promise<Map<string, ReaderProgress>> {
  const out = new Map<string, ReaderProgress>();
  const ids = [...new Set(gameIds)];
  if (ids.length === 0) return out;
  const [rows, mine, done] = await Promise.all([
    db.select({ id: games.id, status: games.status }).from(games).where(inArray(games.id, ids)),
    db
      .select({ gameId: gamePlayers.gameId })
      .from(gamePlayers)
      .where(and(eq(gamePlayers.userId, userId), inArray(gamePlayers.gameId, ids))),
    db
      .select({ gameId: gameSongs.gameId, position: gameSongs.position })
      .from(answers)
      .innerJoin(gameSongs, eq(gameSongs.id, answers.gameSongId))
      .where(and(eq(answers.userId, userId), inArray(gameSongs.gameId, ids), sql`${answers.answeredAt} is not null`)),
  ]);
  for (const g of rows) {
    out.set(g.id, {
      active: g.status === "active",
      inGame: mine.some((m) => m.gameId === g.id),
      answered: new Set(done.filter((d) => d.gameId === g.id).map((d) => d.position)),
    });
  }
  return out;
}

/** For each game this group has running, the furthest song the writer has heard (tapped Play on). */
async function holdsFor(chatId: string, userId: string): Promise<ChatHold[]> {
  const rows = await db
    .select({ gameId: games.id, position: max(gameSongs.position) })
    .from(games)
    .innerJoin(gameSongs, eq(gameSongs.gameId, games.id))
    .innerJoin(answers, and(eq(answers.gameSongId, gameSongs.id), eq(answers.userId, userId)))
    .where(and(eq(games.chatId, chatId), eq(games.status, "active")))
    .groupBy(games.id);
  return rows.flatMap((r) => (r.position ? [{ gameId: r.gameId, position: r.position }] : []));
}

// ---------------------------------------------------------------------------
// The chat list and unread counts
// ---------------------------------------------------------------------------

export type ChatPreview = { sender: string; mine: boolean; text: string | null; after: number | null };

export type ChatSummary = {
  id: string;
  title: string;
  unread: number;
  /** When the last message was sent (or the chat was made), for sorting. */
  at: number;
  last: ChatPreview | null;
};

/** Every chat this player is in, latest first, with unread counts and the last message (held back when it must be). */
export async function chatSummaries(userId: string): Promise<ChatSummary[]> {
  const mine = await db
    .select({ chat: chats, lastReadAt: chatMembers.lastReadAt })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(eq(chatMembers.userId, userId));
  if (mine.length === 0) return [];
  const ids = mine.map((m) => m.chat.id);

  const [members, unread, lasts] = await Promise.all([
    db
      .select({ chatId: chatMembers.chatId, userId: users.id, name: users.name })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(inArray(chatMembers.chatId, ids)),
    db
      .select({ chatId: chatMessages.chatId, n: count() })
      .from(chatMessages)
      .innerJoin(chatMembers, and(eq(chatMembers.chatId, chatMessages.chatId), eq(chatMembers.userId, userId)))
      .where(
        and(
          inArray(chatMessages.chatId, ids),
          gt(chatMessages.createdAt, chatMembers.lastReadAt),
          or(isNull(chatMessages.userId), ne(chatMessages.userId, userId)),
        ),
      )
      .groupBy(chatMessages.chatId),
    db
      .selectDistinctOn([chatMessages.chatId])
      .from(chatMessages)
      .where(inArray(chatMessages.chatId, ids))
      .orderBy(chatMessages.chatId, desc(chatMessages.createdAt)),
  ]);
  const progress = await readerProgress(
    userId,
    lasts.flatMap((m) => m.holds.map((h) => h.gameId)),
  );

  return mine
    .map(({ chat }) => {
      const others = members.filter((m) => m.chatId === chat.id && m.userId !== userId).map((m) => m.name);
      const m = lasts.find((x) => x.chatId === chat.id);
      const isMine = m?.userId === userId;
      const after = m && !isMine ? heldUntil(m.holds, progress) : null;
      return {
        id: chat.id,
        title: chatTitle(others),
        unread: unread.find((u) => u.chatId === chat.id)?.n ?? 0,
        at: (chat.lastMessageAt ?? chat.createdAt).getTime(),
        last: m ? { sender: isMine ? "You" : m.senderName, mine: isMine, text: after === null ? m.body : null, after } : null,
      };
    })
    .sort((a, b) => b.at - a.at);
}

// ---------------------------------------------------------------------------
// One chat
// ---------------------------------------------------------------------------

export type ChatMessageView = {
  id: string;
  mine: boolean;
  sender: string;
  at: number;
  /** Null while it's held back: the panel shows sparkles. */
  text: string | null;
  /** Held back until this player has played this song. */
  heldUntil: number | null;
  /** Shown, but written further into a game still being played: "after song 5". */
  afterSong: number | null;
  reactions: { kind: string; emoji: string; count: number; mine: boolean }[];
};

export type ChatView = {
  id: string;
  title: string;
  /** "Songs 4–6 of 9" while the group has a game going, else null. */
  status: string | null;
  messages: ChatMessageView[];
};

/** A chat as this player sees it, with its latest messages (oldest first). Null if they aren't in it. */
export async function loadChat(chatId: string, userId: string): Promise<ChatView | null> {
  const me = await membership(chatId, userId);
  if (!me) return null;
  const [members, recent, running] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name })
      .from(chatMembers)
      .innerJoin(users, eq(users.id, chatMembers.userId))
      .where(eq(chatMembers.chatId, chatId)),
    db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(CHAT_PAGE),
    db
      .select()
      .from(games)
      .where(and(eq(games.chatId, chatId), eq(games.status, "active")))
      .orderBy(desc(games.createdAt))
      .limit(1),
  ]);
  const messages = recent.reverse();
  const [reactions, progress] = await Promise.all([
    messages.length
      ? db
          .select({ messageId: chatReactions.messageId, userId: chatReactions.userId, kind: chatReactions.kind })
          .from(chatReactions)
          .where(
            inArray(
              chatReactions.messageId,
              messages.map((m) => m.id),
            ),
          )
          .orderBy(asc(chatReactions.createdAt))
      : Promise.resolve([]),
    readerProgress(
      userId,
      messages.flatMap((m) => m.holds.map((h) => h.gameId)),
    ),
  ]);

  const game = running[0];
  return {
    id: chatId,
    title: chatTitle(members.filter((m) => m.userId !== userId).map((m) => m.name)),
    status: game ? roundLabel(game.mode, game.songCount, openRound(game.mode, game.songCount, game.currentPosition)) : null,
    messages: messages.map((m) => {
      const isMine = m.userId === userId;
      const held = isMine ? null : heldUntil(m.holds, progress);
      const furthest = isMine
        ? null
        : m.holds.reduce<number | null>((acc, h) => {
            const p = progress.get(h.gameId);
            return p?.active && p.inGame ? Math.max(acc ?? 0, h.position) : acc;
          }, null);
      return {
        id: m.id,
        mine: isMine,
        sender: m.senderName,
        at: m.createdAt.getTime(),
        text: held === null ? m.body : null,
        heldUntil: held,
        afterSong: held === null ? furthest : null,
        reactions: held === null ? reactionCounts(reactions.filter((r) => r.messageId === m.id), userId) : [],
      };
    }),
  };
}

/** Send a message. It's held back from anyone who hasn't played as far as the writer has. */
export async function sendMessage(userId: string, chatId: string, text: string): Promise<Result> {
  if (!(await membership(chatId, userId))) return { ok: false, error: "That isn't your chat." };
  const body = cleanMessage(text);
  if (!body) return { ok: false, error: "Type a message first." };
  const [[recent], [me], holds] = await Promise.all([
    db
      .select({ n: count() })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.chatId, chatId),
          eq(chatMessages.userId, userId),
          gt(chatMessages.createdAt, new Date(Date.now() - 60_000)),
        ),
      ),
    db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1),
    holdsFor(chatId, userId),
  ]);
  if (recent.n >= MESSAGES_PER_MINUTE) return { ok: false, error: "Slow down a little: too many messages in a minute." };
  const now = new Date();
  await db.insert(chatMessages).values({ chatId, userId, senderName: me?.name ?? "Someone", body, holds, createdAt: now });
  await Promise.all([
    db.update(chats).set({ lastMessageAt: now }).where(eq(chats.id, chatId)),
    // Your own message doesn't count as unread, and you've seen everything before it.
    db
      .update(chatMembers)
      .set({ lastReadAt: now })
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId))),
  ]);
  await publishChatUpdate(chatId);
  return { ok: true };
}

/**
 * React to a message: a new reaction, a different one (it replaces yours), or
 * the same one again (takes it back). Not on a message still held back from you.
 */
export async function reactToMessage(userId: string, messageId: string, kind: string): Promise<Result> {
  if (!isReactionKind(kind)) return { ok: false, error: "That isn't a reaction." };
  const [m] = await db.select().from(chatMessages).where(eq(chatMessages.id, messageId)).limit(1);
  if (!m || !(await membership(m.chatId, userId))) return { ok: false, error: "That message isn't in your chat." };
  if (m.userId !== userId) {
    const progress = await readerProgress(
      userId,
      m.holds.map((h) => h.gameId),
    );
    if (heldUntil(m.holds, progress) !== null) return { ok: false, error: "You can't see that message yet." };
  }
  const [existing] = await db
    .select({ kind: chatReactions.kind })
    .from(chatReactions)
    .where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.userId, userId)))
    .limit(1);
  if (existing?.kind === kind) {
    await db.delete(chatReactions).where(and(eq(chatReactions.messageId, messageId), eq(chatReactions.userId, userId)));
  } else {
    await db
      .insert(chatReactions)
      .values({ messageId, userId, kind })
      .onConflictDoUpdate({ target: [chatReactions.messageId, chatReactions.userId], set: { kind, createdAt: new Date() } });
  }
  await publishChatUpdate(m.chatId);
  return { ok: true };
}

/** Unread messages in one chat for this player (the count on a game page's chat tab). */
export async function unreadIn(userId: string, chatId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(chatMessages)
    .innerJoin(chatMembers, and(eq(chatMembers.chatId, chatMessages.chatId), eq(chatMembers.userId, userId)))
    .where(
      and(
        eq(chatMessages.chatId, chatId),
        gt(chatMessages.createdAt, chatMembers.lastReadAt),
        or(isNull(chatMessages.userId), ne(chatMessages.userId, userId)),
      ),
    );
  return row?.n ?? 0;
}

/** The chat panel is open on this chat: everything in it so far is read. */
export async function markChatRead(userId: string, chatId: string): Promise<void> {
  await db
    .update(chatMembers)
    .set({ lastReadAt: new Date() })
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)));
}

/** The chats this player is in, of these (for the live feed). */
export async function myChatIds(userId: string, chatIds: string[]): Promise<string[]> {
  if (chatIds.length === 0) return [];
  const rows = await db
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .where(and(eq(chatMembers.userId, userId), inArray(chatMembers.chatId, chatIds)));
  return rows.map((r) => r.chatId);
}

/** The games still being played in these chats (their progress unlocks held-back messages). */
export async function activeGamesIn(chatIds: string[]): Promise<string[]> {
  if (chatIds.length === 0) return [];
  const rows = await db
    .select({ id: games.id })
    .from(games)
    .where(and(inArray(games.chatId, chatIds), eq(games.status, "active")));
  return rows.map((r) => r.id);
}
