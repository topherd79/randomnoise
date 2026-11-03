import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games, users } from "@/db/schema";
import { standings } from "./games";

// What the admin's Games screens show. The admin also plays, so nothing here
// may reveal the songs of a game in progress: progress and players only.

export type PlayerState = {
  userId: string;
  name: string;
  state: "waiting" | "playing" | "answered";
  startedAt: Date | null;
};

export async function gameSummaries() {
  const rows = await db.select().from(games).orderBy(desc(games.createdAt)).limit(50);
  if (rows.length === 0) return [];
  const ids = rows.map((g) => g.id);
  const players = await db
    .select({ gameId: gamePlayers.gameId, userId: users.id, name: users.name })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(inArray(gamePlayers.gameId, ids))
    .orderBy(asc(users.name));
  const current = await db
    .select({ gameId: gameSongs.gameId, userId: answers.userId, answeredAt: answers.answeredAt })
    .from(gameSongs)
    .innerJoin(games, and(eq(games.id, gameSongs.gameId), eq(games.currentPosition, gameSongs.position)))
    .innerJoin(answers, eq(answers.gameSongId, gameSongs.id))
    .where(inArray(gameSongs.gameId, ids));

  return Promise.all(
    rows.map(async (g) => {
      const ps = players.filter((p) => p.gameId === g.id);
      const answered = new Set(current.filter((c) => c.gameId === g.id && c.answeredAt).map((c) => c.userId));
      const table = g.status === "active" ? [] : await standings(g.id);
      return {
        id: g.id,
        status: g.status,
        createdAt: g.createdAt,
        songCount: g.songCount,
        position: g.currentPosition,
        players: ps.map((p) => p.name),
        waitingOn: ps.filter((p) => !answered.has(p.userId)).map((p) => p.name),
        leader: table[0] ?? null,
      };
    }),
  );
}

/** One game's progress: who has answered the current song, without saying what it is. */
export async function gameProgress(gameId: string) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return null;
  const players = await db
    .select({ userId: users.id, name: users.name })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(users.name));
  const [gs] = await db
    .select({ id: gameSongs.id })
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, game.currentPosition)))
    .limit(1);
  const roundAnswers = gs ? await db.select().from(answers).where(eq(answers.gameSongId, gs.id)) : [];
  const states: PlayerState[] = players.map((p) => {
    const a = roundAnswers.find((r) => r.userId === p.userId);
    return {
      userId: p.userId,
      name: p.name,
      state: a?.answeredAt ? "answered" : a ? "playing" : "waiting",
      startedAt: a?.startedAt ?? null,
    };
  });
  return { game, currentGameSongId: gs?.id ?? null, players: states, standings: await standings(gameId) };
}
