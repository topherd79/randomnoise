import "server-only";
import { and, between, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games, playOnVotes, users } from "@/db/schema";
import { afterPlayerRemoved } from "./games";
import { publishGameUpdate } from "./live";
import { inRound, openRound, songsLeft } from "./modes";
import { playOnView, votePasses, type PlayOnView } from "./play-on";

// Playing on without the one player holding a game up: the vote, and taking a
// player out (by vote or by the admin). The rules are in play-on.ts.

type Result = { ok: true } | { ok: false; error: string };
type GameRow = typeof games.$inferSelect;

/** The players still in a game (not out), by name. */
export async function playersIn(gameId: string) {
  return db
    .select({ userId: users.id, name: users.name })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(and(eq(gamePlayers.gameId, gameId), isNull(gamePlayers.outAt)))
    .orderBy(users.name);
}

/**
 * The vote as one player sees it, or null: no vote possible right now, Pass the
 * Aux, a game that's over, or they're the one holding it up (never told).
 */
export async function loadPlayOn(game: GameRow, me: string, now = Date.now()): Promise<PlayOnView | null> {
  if (game.status !== "active" || game.mode === "aux") return null;
  const round = openRound(game.mode, game.songCount, game.currentPosition);
  const [players, rows, votes] = await Promise.all([
    playersIn(game.id),
    db
      .select({ userId: answers.userId, position: gameSongs.position, answeredAt: answers.answeredAt })
      .from(answers)
      .innerJoin(gameSongs, eq(gameSongs.id, answers.gameSongId))
      .where(and(eq(gameSongs.gameId, game.id), isNotNull(answers.answeredAt), between(gameSongs.position, round.start, round.end))),
    db
      .select({ voter: playOnVotes.voterUserId, target: playOnVotes.targetUserId })
      .from(playOnVotes)
      .where(and(eq(playOnVotes.gameId, game.id), eq(playOnVotes.roundStart, round.start))),
  ]);
  const answeredBy = (uid: string) => new Set(rows.filter((r) => r.userId === uid && inRound(round, r.position)).map((r) => r.position));
  const withLeft = players.map((p) => ({ ...p, left: songsLeft(round, answeredBy(p.userId)) }));
  const behind = withLeft.filter((p) => p.left > 0);
  if (behind.length !== 1) return null;
  const target = behind[0].userId;
  // When the last of the others answered their last open song.
  const others = new Set(withLeft.filter((p) => p.userId !== target).map((p) => p.userId));
  const times = rows.filter((r) => others.has(r.userId)).map((r) => r.answeredAt!.getTime());
  return playOnView({
    me,
    players: withLeft,
    othersDoneAt: times.length ? Math.max(...times) : null,
    votes: new Set(votes.filter((v) => v.target === target).map((v) => v.voter)),
    now,
  });
}

/** A vote to play on without `targetId`. When it's the last one needed, they're out and the game moves on. */
export async function voteToPlayOn(voterId: string, gameId: string, targetId: string): Promise<Result> {
  const [row] = await db
    .select({ game: games })
    .from(games)
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, voterId), isNull(gamePlayers.outAt)))
    .where(eq(games.id, gameId))
    .limit(1);
  if (!row) return { ok: false, error: "That isn't your game." };
  const { game } = row;
  const view = await loadPlayOn(game, voterId);
  if (!view || view.target.userId !== targetId) return { ok: false, error: "There's nothing to vote on right now." };
  if (!view.open) return { ok: false, error: "It's too early to vote on that." };
  const round = openRound(game.mode, game.songCount, game.currentPosition);
  await db
    .insert(playOnVotes)
    .values({ gameId, roundStart: round.start, targetUserId: targetId, voterUserId: voterId })
    .onConflictDoNothing();
  await settlePlayOn(gameId);
  await publishGameUpdate(gameId);
  return { ok: true };
}

/** If everyone else has voted to play on without the one player holding the game up, take them out. */
async function settlePlayOn(gameId: string): Promise<void> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game || game.status !== "active" || game.mode === "aux") return;
  // Every voter sees the same vote: look at it as any one of them.
  for (const viewer of await playersIn(gameId)) {
    const view = await loadPlayOn(game, viewer.userId);
    if (!view) continue;
    const votes = new Set(view.voters.filter((v) => v.voted).map((v) => v.userId));
    if (view.open && votePasses(view.voters.map((v) => v.userId), votes)) {
      await takeOutOfGame(gameId, view.target.userId, "vote");
    }
    return;
  }
}

/**
 * Take a player out of a game in progress (everyone else voted, or the admin):
 * it never waits on them again, they can't play any more of it, and they stay
 * in its results, crossed out, with the points they had. Not Pass the Aux.
 */
export async function takeOutOfGame(gameId: string, userId: string, by: "vote" | "admin"): Promise<Result> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return { ok: false, error: "That game doesn't exist." };
  if (game.status !== "active") return { ok: false, error: "This game is over." };
  if (game.mode === "aux") return { ok: false, error: "Nobody can be taken out of a Pass the Aux game." };
  const out = await db
    .update(gamePlayers)
    .set({ outAt: new Date(), outBy: by })
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId), isNull(gamePlayers.outAt)))
    .returning({ userId: gamePlayers.userId });
  if (!out.length) return { ok: false, error: "They aren't in this game any more." };
  // A song they'd tapped Play on but not answered is dropped; their answered songs stay.
  const songIds = db.select({ id: gameSongs.id }).from(gameSongs).where(eq(gameSongs.gameId, gameId));
  await db.delete(answers).where(and(eq(answers.userId, userId), isNull(answers.answeredAt), inArray(answers.gameSongId, songIds)));
  // The songs they were holding up complete and the game moves on (or ends, with nobody left).
  await afterPlayerRemoved([gameId]);
  // Taking out a voter can complete a vote that was waiting on them.
  await settlePlayOn(gameId);
  await publishGameUpdate(gameId);
  return { ok: true };
}
