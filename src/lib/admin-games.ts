import "server-only";
import { and, asc, between, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games, users } from "@/db/schema";
import { roundState, standings } from "./games";
import { nextPosition, openRound, roundLabel, songsLeft } from "./modes";

// What the admin's Games screens show. The admin also plays, so nothing here
// may reveal the songs of a game in progress: progress and players only.

export type PlayerState = {
  userId: string;
  name: string;
  /** answered: done with every open song; playing: tapped Play on their next song; waiting: hasn't started it. */
  state: "waiting" | "playing" | "answered";
  startedAt: Date | null;
  /** Their next song in the open round, and how many open songs they have left. */
  nextPosition: number | null;
  left: number;
  /** The attempt a reset would clear: the song they're on, or else their latest answer still open. */
  resetGameSongId: string | null;
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

  return Promise.all(
    rows.map(async (g) => {
      const ps = players.filter((p) => p.gameId === g.id);
      const active = g.status === "active";
      const { round, answered } = await roundState(g);
      const table = active ? [] : await standings(g.id);
      return {
        id: g.id,
        status: g.status,
        mode: g.mode,
        createdAt: g.createdAt,
        songCount: g.songCount,
        label: roundLabel(g.mode, g.songCount, round),
        roundLength: round.end - round.start + 1,
        players: ps.map((p) => p.name),
        waitingOn: active
          ? ps.map((p) => ({ name: p.name, left: songsLeft(round, answered(p.userId)) })).filter((w) => w.left > 0)
          : [],
        leader: table[0] ?? null,
      };
    }),
  );
}

/** One game's progress: where each player is in the open round, without saying what the songs are. */
export async function gameProgress(gameId: string) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return null;
  const players = await db
    .select({ userId: users.id, name: users.name })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(users.name));
  const round = openRound(game.mode, game.songCount, game.currentPosition);
  const open = await db
    .select({ id: gameSongs.id, position: gameSongs.position, completedAt: gameSongs.completedAt })
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), between(gameSongs.position, round.start, round.end)))
    .orderBy(asc(gameSongs.position));
  const openAnswers = open.length
    ? await db
        .select()
        .from(answers)
        .where(inArray(answers.gameSongId, open.map((o) => o.id)))
    : [];

  const states: PlayerState[] = players.map((p) => {
    const mine = openAnswers.filter((a) => a.userId === p.userId);
    const answeredPositions = new Set(
      open.filter((o) => mine.some((a) => a.gameSongId === o.id && a.answeredAt)).map((o) => o.position),
    );
    const next = nextPosition(round, answeredPositions);
    const nextSong = open.find((o) => o.position === next);
    const started = nextSong ? mine.find((a) => a.gameSongId === nextSong.id && !a.answeredAt) : undefined;
    const lastAnswered = [...open].reverse().find((o) => !o.completedAt && answeredPositions.has(o.position));
    return {
      userId: p.userId,
      name: p.name,
      state: next === null ? "answered" : started ? "playing" : "waiting",
      startedAt: started?.startedAt ?? null,
      nextPosition: next,
      left: songsLeft(round, answeredPositions),
      resetGameSongId: started ? nextSong!.id : (lastAnswered?.id ?? null),
    };
  });
  return {
    game,
    label: roundLabel(game.mode, game.songCount, round),
    roundLength: round.end - round.start + 1,
    players: states,
    standings: await standings(gameId),
  };
}
