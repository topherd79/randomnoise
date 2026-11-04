import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games, songs, users, type Choice } from "@/db/schema";
import { appleMusicLink, spotifyLink } from "./links";
import { choiceLabel, shuffleFor } from "./rules";
import { standings, type Standing } from "./games";

export type SongInfo = {
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  artworkUrl: string | null;
  appleMusicUrl: string;
  spotifyUrl: string;
  fullUrl: string;
};

export type MyAnswer = {
  startedAt: number | null;
  answeredAt: number | null;
  choiceSongId: string | null;
  correct: boolean | null;
  points: number | null;
  elapsedMs: number | null;
};

export type Pick = {
  userId: string;
  name: string;
  label: string | null;
  correct: boolean | null;
  points: number | null;
  elapsedMs: number | null;
};

export type RoundView = {
  gameSongId: string;
  position: number;
  clipUrl: string;
  choices: { songId: string; label: string }[];
  my: MyAnswer;
  /** Players who still have to answer (never what anyone picked). */
  waitingOn: { userId: string; name: string }[];
  /** Only once I've answered. */
  song: SongInfo | null;
  rightSongId: string | null;
};

export type ResultsView = { position: number; song: SongInfo; picks: Pick[] };

export type GameView = {
  id: string;
  status: "active" | "finished" | "cancelled";
  songCount: number;
  position: number;
  players: { userId: string; name: string }[];
  current: RoundView | null;
  /** Results of the song before the current one (or the last song, once the game is over). */
  last: ResultsView | null;
  /** Every completed song, newest first (for the finished-game page). */
  history: ResultsView[];
  standings: Standing[];
};

function songInfo(
  s: { title: string; artist: string; album: string | null; year: number | null; artworkUrl: string | null; appleMusicUrl: string | null; spotifyUrl: string | null },
  gameSongId: string,
): SongInfo {
  return {
    title: s.title,
    artist: s.artist,
    album: s.album,
    year: s.year,
    artworkUrl: s.artworkUrl,
    appleMusicUrl: appleMusicLink(s),
    spotifyUrl: spotifyLink(s),
    fullUrl: `/api/game-songs/${gameSongId}/full`,
  };
}

/** Everything the game page shows one player. Null if they aren't in the game. */
export async function loadGameView(gameId: string, userId: string): Promise<GameView | null> {
  const [game] = await db
    .select({ game: games })
    .from(games)
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, userId)))
    .where(eq(games.id, gameId))
    .limit(1);
  if (!game) return null;
  const g = game.game;

  const [players, rounds, table] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name })
      .from(gamePlayers)
      .innerJoin(users, eq(users.id, gamePlayers.userId))
      .where(eq(gamePlayers.gameId, gameId))
      .orderBy(asc(users.name)),
    db
      .select({ gs: gameSongs, song: songs })
      .from(gameSongs)
      .innerJoin(songs, eq(songs.id, gameSongs.songId))
      .where(eq(gameSongs.gameId, gameId))
      .orderBy(asc(gameSongs.position)),
    standings(gameId),
  ]);

  const visible = rounds.filter((r) => r.gs.completedAt || r.gs.position === g.currentPosition);
  const allAnswers = visible.length
    ? await db
        .select()
        .from(answers)
        .where(inArray(answers.gameSongId, visible.map((r) => r.gs.id)))
    : [];
  const nameOf = new Map(players.map((p) => [p.userId, p.name]));

  const resultsFor = (r: (typeof rounds)[number]): ResultsView => {
    const labelOf = new Map(r.gs.choices.map((c: Choice) => [c.songId, choiceLabel(c)]));
    const picks: Pick[] = players.map((p) => {
      const a = allAnswers.find((x) => x.gameSongId === r.gs.id && x.userId === p.userId);
      return {
        userId: p.userId,
        name: p.name,
        label: a?.choiceSongId ? (labelOf.get(a.choiceSongId) ?? null) : null,
        correct: a?.correct ?? null,
        points: a?.points ?? null,
        elapsedMs: a?.elapsedMs ?? null,
      };
    });
    picks.sort((x, y) => (y.points ?? -Infinity) - (x.points ?? -Infinity) || x.name.localeCompare(y.name));
    return { position: r.gs.position, song: songInfo(r.song, r.gs.id), picks };
  };

  let current: RoundView | null = null;
  const cur = g.status === "active" ? rounds.find((r) => r.gs.position === g.currentPosition) : undefined;
  if (cur) {
    const mine = allAnswers.find((a) => a.gameSongId === cur.gs.id && a.userId === userId);
    const answered = Boolean(mine?.answeredAt);
    current = {
      gameSongId: cur.gs.id,
      position: cur.gs.position,
      clipUrl: `/api/clips/${cur.gs.clipFile}`,
      choices: shuffleFor(
        cur.gs.choices.map((c) => ({ songId: c.songId, label: choiceLabel(c) })),
        `${cur.gs.id}:${userId}`,
      ),
      my: {
        startedAt: mine?.startedAt.getTime() ?? null,
        answeredAt: mine?.answeredAt?.getTime() ?? null,
        choiceSongId: mine?.choiceSongId ?? null,
        correct: mine?.correct ?? null,
        points: mine?.points ?? null,
        elapsedMs: mine?.elapsedMs ?? null,
      },
      waitingOn: players
        .filter((p) => !allAnswers.some((a) => a.gameSongId === cur.gs.id && a.userId === p.userId && a.answeredAt))
        .map((p) => ({ userId: p.userId, name: nameOf.get(p.userId) ?? p.name })),
      song: answered ? songInfo(cur.song, cur.gs.id) : null,
      rightSongId: answered ? cur.gs.songId : null,
    };
  }

  const completed = rounds.filter((r) => r.gs.completedAt);
  const history = completed.map(resultsFor).reverse();
  return {
    id: g.id,
    status: g.status,
    songCount: g.songCount,
    position: g.currentPosition,
    players,
    current,
    last: history[0] ?? null,
    history,
    standings: table,
  };
}

/** The games a player is in, newest first, with what's waiting for them. */
export async function myGames(userId: string) {
  const rows = await db
    .select({ game: games })
    .from(games)
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, userId)))
    .where(inArray(games.status, ["active", "finished"]))
    .orderBy(desc(games.createdAt))
    .limit(20);
  const active = rows.filter((r) => r.game.status === "active").map((r) => r.game);

  const states = await Promise.all(
    active.map(async (g) => {
      const [gs] = await db
        .select({ id: gameSongs.id })
        .from(gameSongs)
        .where(and(eq(gameSongs.gameId, g.id), eq(gameSongs.position, g.currentPosition)))
        .limit(1);
      const roundAnswers = gs
        ? await db.select({ userId: answers.userId, answeredAt: answers.answeredAt }).from(answers).where(eq(answers.gameSongId, gs.id))
        : [];
      const players = await db
        .select({ userId: users.id, name: users.name })
        .from(gamePlayers)
        .innerJoin(users, eq(users.id, gamePlayers.userId))
        .where(eq(gamePlayers.gameId, g.id));
      const myTurn = !roundAnswers.some((a) => a.userId === userId && a.answeredAt);
      // Other players who still have to answer (by id: two players could share a name).
      const waitingOn = players
        .filter((p) => p.userId !== userId && !roundAnswers.some((a) => a.userId === p.userId && a.answeredAt))
        .map((p) => p.name);
      return {
        id: g.id,
        songCount: g.songCount,
        position: g.currentPosition,
        myTurn,
        waitingOn,
        others: players.filter((p) => p.userId !== userId).map((p) => p.name),
      };
    }),
  );
  const finished = rows.filter((r) => r.game.status === "finished").map((r) => ({ id: r.game.id, songCount: r.game.songCount, finishedAt: r.game.finishedAt }));
  return { active: states, finished };
}

// ---------------------------------------------------------------------------
// Finished-game results (admin history and the game-over email)
// ---------------------------------------------------------------------------

export type SongResult = Omit<SongInfo, "fullUrl"> & { position: number; picks: Pick[] };

export type GameResults = {
  id: string;
  status: "active" | "finished" | "cancelled";
  songCount: number;
  clipLengthSec: number;
  createdAt: Date;
  finishedAt: Date | null;
  /** Best first, like the players' standings. */
  standings: Standing[];
  /** Completed songs only, in play order. */
  songs: SongResult[];
};

/**
 * Song-by-song results for several games at once (a handful of queries in total).
 * Only completed songs are included, so this never reveals a song still to be
 * played. Callers check who may see it: the admin for games that are over, or
 * the game-over email to that game's players.
 */
export async function loadGameResults(gameIds: string[]): Promise<Map<string, GameResults>> {
  const out = new Map<string, GameResults>();
  if (gameIds.length === 0) return out;

  const [gameRows, playerRows, rounds] = await Promise.all([
    db.select().from(games).where(inArray(games.id, gameIds)),
    db
      .select({ gameId: gamePlayers.gameId, userId: users.id, name: users.name })
      .from(gamePlayers)
      .innerJoin(users, eq(users.id, gamePlayers.userId))
      .where(inArray(gamePlayers.gameId, gameIds)),
    db
      .select({ gs: gameSongs, song: songs })
      .from(gameSongs)
      .innerJoin(songs, eq(songs.id, gameSongs.songId))
      .where(and(inArray(gameSongs.gameId, gameIds), isNotNull(gameSongs.completedAt)))
      .orderBy(asc(gameSongs.position)),
  ]);
  const roundAnswers = rounds.length
    ? await db
        .select()
        .from(answers)
        .where(inArray(answers.gameSongId, rounds.map((r) => r.gs.id)))
    : [];

  for (const g of gameRows) {
    const players = playerRows.filter((p) => p.gameId === g.id).sort((a, b) => a.name.localeCompare(b.name));
    const gameRounds = rounds.filter((r) => r.gs.gameId === g.id);
    const totals = new Map(players.map((p) => [p.userId, { points: 0, correct: 0 }]));

    const songResults: SongResult[] = gameRounds.map((r) => {
      const labelOf = new Map(r.gs.choices.map((c: Choice) => [c.songId, choiceLabel(c)]));
      const picks: Pick[] = players.map((p) => {
        const a = roundAnswers.find((x) => x.gameSongId === r.gs.id && x.userId === p.userId);
        const t = totals.get(p.userId)!;
        t.points += a?.points ?? 0;
        if (a?.correct) t.correct += 1;
        return {
          userId: p.userId,
          name: p.name,
          label: a?.choiceSongId ? (labelOf.get(a.choiceSongId) ?? null) : null,
          correct: a?.correct ?? null,
          points: a?.points ?? null,
          elapsedMs: a?.elapsedMs ?? null,
        };
      });
      const { fullUrl: _full, ...info } = songInfo(r.song, r.gs.id);
      void _full;
      return { ...info, position: r.gs.position, picks };
    });

    // Same order as the standings() query: most points, then name.
    const table: Standing[] = players
      .map((p) => ({ userId: p.userId, name: p.name, ...totals.get(p.userId)! }))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    out.set(g.id, {
      id: g.id,
      status: g.status,
      songCount: g.songCount,
      clipLengthSec: g.clipLengthSec,
      createdAt: g.createdAt,
      finishedAt: g.finishedAt,
      standings: table,
      songs: songResults,
    });
  }
  return out;
}
