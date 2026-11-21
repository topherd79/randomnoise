// Chat end to end: one chat per group of players across games, messages held
// back until you've played as far as the writer had, unread counts, reactions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(Promise.resolve().then(fn)) }));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMembers, chatMessages, gameSongs, games, users } from "@/db/schema";
import { answerSong, cancelGame, createGame, startSong } from "@/lib/games";
import { chatSummaries, loadChat, markChatRead, reactToMessage, sendMessage, unreadIn } from "@/lib/chat";
import { NO_FILTERS } from "@/lib/song-filters";
import { addUser, addVariedSongs, resetAll } from "./helpers";

const base = { clipLengthSec: 10, wrongAnswers: "random" as const, filters: NO_FILTERS };

async function chatOf(gameId: string) {
  const [g] = await db.select({ chatId: games.chatId }).from(games).where(eq(games.id, gameId));
  return g.chatId;
}

/** One player plays the song at this position (Play, then the right answer). */
async function play(userId: string, gameId: string, position: number) {
  const [gs] = await db
    .select()
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, position)));
  await startSong(userId, gs.id);
  return answerSong(userId, gs.id, gs.songId);
}

beforeEach(async () => {
  await resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(afterTasks.splice(0));
  vi.restoreAllMocks();
});

describe("chats", () => {
  it("one chat per exact group of players, kept across their games; none solo or in Pass the Aux", async () => {
    const [topher, mike, sarah, dave] = [await addUser("Topher"), await addUser("Mike"), await addUser("Sarah"), await addUser("Dave")];
    await addVariedSongs(30);
    const make = async (playerIds: string[], mode: "og" | "aux" = "og") => {
      const r = await createGame({ ...base, mode, playerIds, songCount: mode === "aux" ? playerIds.length * 5 : 5, createdBy: topher });
      if (!r.ok) throw new Error(r.error);
      return r.gameId;
    };
    const g1 = await make([topher, mike, sarah]);
    const g2 = await make([sarah, topher, mike]); // the same three, in another order
    const g3 = await make([topher, mike, sarah, dave]);
    const solo = await make([topher]);
    const aux = await make([topher, mike], "aux");

    expect(await chatOf(g1)).not.toBeNull();
    expect(await chatOf(g2)).toBe(await chatOf(g1));
    expect(await chatOf(g3)).not.toBe(await chatOf(g1));
    expect(await chatOf(solo)).toBeNull();
    expect(await chatOf(aux)).toBeNull();

    const members = await db.select().from(chatMembers).where(eq(chatMembers.chatId, (await chatOf(g1))!));
    expect(new Set(members.map((m) => m.userId))).toEqual(new Set([topher, mike, sarah]));
    expect((await chatSummaries(dave)).map((c) => c.title)).toEqual(["Mike, Sarah, Topher and you"]);
    expect((await chatSummaries(topher)).map((c) => c.title).sort()).toEqual(["Dave, Mike, Sarah and you", "Mike, Sarah and you"]);
  });

  it("holds a message back until you've played as far as its writer had", async () => {
    const [topher, mike, sarah] = [await addUser("Topher"), await addUser("Mike"), await addUser("Sarah")];
    await addVariedSongs(12);
    const r = await createGame({ ...base, mode: "all", playerIds: [topher, mike, sarah], songCount: 5, createdBy: topher });
    if (!r.ok) throw new Error(r.error);
    const chatId = (await chatOf(r.gameId))!;

    // Before anyone has heard a song, nothing can be spoiled.
    expect(await sendMessage(sarah, chatId, "good luck all")).toEqual({ ok: true });
    // Mike plays songs 1 and 2, then talks about them.
    await play(mike, r.gameId, 1);
    await play(mike, r.gameId, 2);
    await play(topher, r.gameId, 1);
    await play(topher, r.gameId, 2);
    expect(await sendMessage(mike, chatId, "song 2 is so obvious")).toEqual({ ok: true });
    const [held] = await db.select().from(chatMessages).where(eq(chatMessages.body, "song 2 is so obvious"));
    expect(held.holds).toEqual([{ gameId: r.gameId, position: 2 }]);

    // Sarah hasn't played song 2: sparkles, never the words.
    let sarahSees = (await loadChat(chatId, sarah))!;
    expect(sarahSees.messages.map((m) => m.text)).toEqual(["good luck all", null]);
    expect(sarahSees.messages[1]).toMatchObject({ sender: "Mike", heldUntil: 2, afterSong: null, reactions: [] });
    expect(JSON.stringify(sarahSees)).not.toContain("obvious");
    expect(sarahSees.status).toBe("All 5 songs");
    // Topher has: he sees it, marked "after song 2". Mike sees his own.
    expect((await loadChat(chatId, topher))!.messages[1]).toMatchObject({ text: "song 2 is so obvious", afterSong: 2, heldUntil: null });
    expect((await loadChat(chatId, mike))!.messages[1]).toMatchObject({ text: "song 2 is so obvious", mine: true, afterSong: null });
    // The chat list doesn't give it away either.
    expect((await chatSummaries(sarah))[0].last).toEqual({ sender: "Mike", mine: false, text: null, after: 2 });

    // She can't react to it yet; once she's played song 2, it's there.
    expect(await reactToMessage(sarah, held.id, "fire")).toMatchObject({ ok: false });
    await play(sarah, r.gameId, 1);
    await play(sarah, r.gameId, 2);
    sarahSees = (await loadChat(chatId, sarah))!;
    expect(sarahSees.messages[1]).toMatchObject({ text: "song 2 is so obvious", heldUntil: null, afterSong: 2 });

    // When the game is over, everything shows, with no "after song" tag.
    await play(mike, r.gameId, 3);
    expect(await sendMessage(mike, chatId, "song 3 too")).toEqual({ ok: true });
    expect((await loadChat(chatId, sarah))!.messages[2].text).toBeNull();
    await cancelGame(r.gameId);
    const after = (await loadChat(chatId, sarah))!;
    expect(after.messages.map((m) => m.text)).toEqual(["good luck all", "song 2 is so obvious", "song 3 too"]);
    expect(after.messages.every((m) => m.afterSong === null)).toBe(true);
    expect(after.status).toBeNull();
  });

  it("counts unread messages until you open the chat", async () => {
    const [topher, mike] = [await addUser("Topher"), await addUser("Mike")];
    await addVariedSongs(8);
    const r = await createGame({ ...base, mode: "og", playerIds: [topher, mike], songCount: 5, createdBy: topher });
    if (!r.ok) throw new Error(r.error);
    const chatId = (await chatOf(r.gameId))!;
    await sendMessage(mike, chatId, "you up?");
    await sendMessage(mike, chatId, "rematch tonight");
    expect(await unreadIn(topher, chatId)).toBe(2);
    expect(await unreadIn(mike, chatId)).toBe(0); // your own messages aren't unread
    expect((await chatSummaries(topher))[0]).toMatchObject({ unread: 2, last: { sender: "Mike", text: "rematch tonight" } });
    await markChatRead(topher, chatId);
    expect(await unreadIn(topher, chatId)).toBe(0);
    await sendMessage(topher, chatId, "yes");
    expect(await unreadIn(mike, chatId)).toBe(1);
    expect((await chatSummaries(topher))[0].last).toMatchObject({ sender: "You", mine: true });
  });

  it("reactions: one each, a different one replaces it, the same one again takes it back", async () => {
    const [topher, mike, sarah] = [await addUser("Topher"), await addUser("Mike"), await addUser("Sarah")];
    await addVariedSongs(8);
    const r = await createGame({ ...base, mode: "og", playerIds: [topher, mike, sarah], songCount: 5, createdBy: topher });
    if (!r.ok) throw new Error(r.error);
    const chatId = (await chatOf(r.gameId))!;
    await sendMessage(mike, chatId, "the ABBA stays");
    const [m] = (await loadChat(chatId, topher))!.messages;

    expect(await reactToMessage(topher, m.id, "haha")).toEqual({ ok: true });
    expect(await reactToMessage(sarah, m.id, "haha")).toEqual({ ok: true });
    expect((await loadChat(chatId, topher))!.messages[0].reactions).toEqual([{ kind: "haha", emoji: "😂", count: 2, mine: true }]);
    await reactToMessage(topher, m.id, "love");
    expect((await loadChat(chatId, topher))!.messages[0].reactions).toEqual([
      { kind: "love", emoji: "❤️", count: 1, mine: true },
      { kind: "haha", emoji: "😂", count: 1, mine: false },
    ]);
    await reactToMessage(topher, m.id, "love");
    expect((await loadChat(chatId, topher))!.messages[0].reactions).toEqual([{ kind: "haha", emoji: "😂", count: 1, mine: false }]);
    expect(await reactToMessage(topher, m.id, "poop")).toMatchObject({ ok: false });
  });

  it("only the group can read or write, messages can't be empty, and a removed player's messages keep their name", async () => {
    const [topher, mike, dave] = [await addUser("Topher"), await addUser("Mike"), await addUser("Dave")];
    await addVariedSongs(8);
    const r = await createGame({ ...base, mode: "og", playerIds: [topher, mike], songCount: 5, createdBy: topher });
    if (!r.ok) throw new Error(r.error);
    const chatId = (await chatOf(r.gameId))!;

    expect(await loadChat(chatId, dave)).toBeNull();
    expect(await sendMessage(dave, chatId, "let me in")).toMatchObject({ ok: false });
    expect(await sendMessage(topher, chatId, "   ")).toMatchObject({ ok: false });

    await sendMessage(mike, chatId, "gg");
    await db.delete(users).where(eq(users.id, mike));
    const view = (await loadChat(chatId, topher))!;
    expect(view.messages[0]).toMatchObject({ sender: "Mike", text: "gg", mine: false });
  });
});
