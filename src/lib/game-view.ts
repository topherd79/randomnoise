import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games, songs, users, type Choice, type GameMode, type SongSnapshot } from "@/db/schema";
import { appleMusicLink, spotifyLink } from "./links";
import { choiceLabel, shuffleFor } from "./rules";
import { roundState, standings, type Standing } from "./games";
import { inRound, nextPosition, openRound, roundLabel, songsLeft, waitingNote } from "./modes";

export type SongInfo = {
  title: string;
  artist: string;
  album: string | null;
  year: number | null;
  artworkUrl: string | null;
  appleMusicUrl: string;
  spotifyUrl: string;
  /** Null once the song has been deleted from the catalog (its file is gone). */
  fullUrl: string | null;
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
  /** Hasn't answered this song yet (the game is still on): shown as "not played yet". */
  pending?: boolean;
};

/** A song the player can play now: their next one in the open round. */
export type RoundView = {
  gameSongId: string;
  position: number;
  clipUrl: string;
  choices: { songId: string; label: string }[];
  my: MyAnswer;
};

export type ResultsView = { position: number; song: SongInfo; picks: Pick[] };

/** A song the player has answered: how they did, plus everyone's picks so far. */
export type AnsweredView = ResultsView & {
  my: { correct: boolean; points: number; elapsedMs: number; pickLabel: string | null };
};

export type Waiter = { userId: string; name: string; left: number };

export type GameView = {
  id: string;
  status: "active" | "finished" | "cancelled";
  mode: GameMode;
  songCount: number;
  /** "Song 4 of 10", "Songs 4–6 of 9" or "All 10 songs" (active games). */
  label: string;
  /** First song of the open round, and how many songs are open at once (1, 3 or all of them). */
  roundStart: number;
  roundLength: number;
  players: { userId: string; name: string }[];
  /** My next song to play, or null once I've played every open song. */
  next: RoundView | null;
  /** The song I answered most recently, with everyone's picks so far. */
  latest: AnsweredView | null;
  /**
   * Every song whose picks I may see, newest first: the ones I've answered while
   * the game is on, every completed song once it's over. Feeds each player's
   * history in the standings.
   */
  songs: ResultsView[];
  /** Players (me included) with songs left in the open round. */
  waitingOn: Waiter[];
  /** What happens once they're done, in plain words. */
  waitingNote: string;
  /** Every completed song, newest first (for the finished-game page). */
  history: ResultsView[];
  /** Each player's points for every song they've answered so far, and how many they've played. */
  standings: Standing[];
  /** How many songs every player has answered. */
  completedCount: number;
};

/** What players see about a song, from the game's snapshot (not the live catalog). */
function songInfo(s: SongSnapshot, gameSongId: string, stillInCatalog: boolean): SongInfo {
  return {
    title: s.title,
    artist: s.artist,
    album: s.album,
    year: s.year,
    artworkUrl: s.artworkUrl,
    appleMusicUrl: appleMusicLink(s),
    spotifyUrl: spotifyLink(s),
    fullUrl: stillInCatalog ? `/api/game-songs/${gameSongId}/full` : null,
  };
}

/**
 * Everything the game page shows one player. Null if they aren't in the game.
 *
 * What anyone picked for a song is only shown to players who have answered it
 * themselves (or once everyone has), so nothing gives an answer away.
 */
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
      // Song details come from the snapshot; the join only tells us whether the
      // catalog song (and so its full-length file) still exists.
      .select({ gs: gameSongs, inCatalog: songs.id })
      .from(gameSongs)
      .leftJoin(songs, eq(songs.id, gameSongs.songId))
      .where(eq(gameSongs.gameId, gameId))
      .orderBy(asc(gameSongs.position)),
    standings(gameId),
  ]);
  const allAnswers = rounds.length
    ? await db
        .select()
        .from(answers)
        .where(inArray(answers.gameSongId, rounds.map((r) => r.gs.id)))
    : [];
  const answerOf = (gameSongId: string, uid: string) => allAnswers.find((a) => a.gameSongId === gameSongId && a.userId === uid);
  const answeredBy = (gameSongId: string, uid: string) => Boolean(answerOf(gameSongId, uid)?.answeredAt);
  const active = g.status === "active";

  // Callers only pass songs this player may see the picks for.
  const resultsFor = (r: (typeof rounds)[number]): ResultsView => {
    const labelOf = new Map(r.gs.choices.map((c: Choice) => [c.songId, choiceLabel(c)]));
    const picks: Pick[] = players.map((p) => {
      const a = answerOf(r.gs.id, p.userId);
      if (!a?.answeredAt) {
        const pending = active && !r.gs.completedAt;
        return { userId: p.userId, name: p.name, label: null, correct: null, points: null, elapsedMs: null, pending };
      }
      return {
        userId: p.userId,
        name: p.name,
        label: a.choiceSongId ? (labelOf.get(a.choiceSongId) ?? null) : null,
        correct: a.correct,
        points: a.points,
        elapsedMs: a.elapsedMs,
      };
    });
    picks.sort(
      (x, y) =>
        Number(Boolean(x.pending)) - Number(Boolean(y.pending)) ||
        (y.points ?? -Infinity) - (x.points ?? -Infinity) ||
        x.name.localeCompare(y.name),
    );
    return { position: r.gs.position, song: songInfo(r.gs.song, r.gs.id, Boolean(r.inCatalog)), picks };
  };

  const round = openRound(g.mode, g.songCount, g.currentPosition);
  const answeredInRound = (uid: string) =>
    new Set(rounds.filter((r) => inRound(round, r.gs.position) && answeredBy(r.gs.id, uid)).map((r) => r.gs.position));

  let next: RoundView | null = null;
  let latest: AnsweredView | null = null;
  let mySongs: ResultsView[] = [];
  let waitingOn: Waiter[] = [];
  if (active) {
    const nextPos = nextPosition(round, answeredInRound(userId));
    const nextRow = nextPos === null ? undefined : rounds.find((r) => r.gs.position === nextPos);
    if (nextRow) {
      const mine = answerOf(nextRow.gs.id, userId);
      next = {
        gameSongId: nextRow.gs.id,
        position: nextRow.gs.position,
        clipUrl: `/api/clips/${nextRow.gs.clipFile}`,
        choices: shuffleFor(
          nextRow.gs.choices.map((c) => ({ songId: c.songId, label: choiceLabel(c) })),
          `${nextRow.gs.id}:${userId}`,
        ),
        my: {
          startedAt: mine?.startedAt.getTime() ?? null,
          answeredAt: null,
          choiceSongId: null,
          correct: null,
          points: null,
          elapsedMs: null,
        },
      };
    }
    // Songs I've answered, newest first: the latest gets the full "how you did" treatment.
    const mineDone = rounds.filter((r) => answeredBy(r.gs.id, userId)).reverse();
    if (mineDone[0]) {
      const r = mineDone[0];
      const a = answerOf(r.gs.id, userId)!;
      const labelOf = new Map(r.gs.choices.map((c: Choice) => [c.songId, choiceLabel(c)]));
      latest = {
        ...resultsFor(r),
        my: {
          correct: Boolean(a.correct),
          points: a.points ?? 0,
          elapsedMs: a.elapsedMs ?? 0,
          pickLabel: a.choiceSongId ? (labelOf.get(a.choiceSongId) ?? null) : null,
        },
      };
    }
    mySongs = mineDone.map(resultsFor);
    waitingOn = players
      .map((p) => ({ userId: p.userId, name: p.name, left: songsLeft(round, answeredInRound(p.userId)) }))
      .filter((w) => w.left > 0);
  }

  const completed = rounds.filter((r) => r.gs.completedAt);
  const history = completed.map(resultsFor).reverse();
  return {
    id: g.id,
    status: g.status,
    mode: g.mode,
    songCount: g.songCount,
    label: roundLabel(g.mode, g.songCount, round),
    roundStart: round.start,
    roundLength: round.end - round.start + 1,
    players,
    next,
    latest,
    songs: active ? mySongs : history,
    waitingOn,
    waitingNote: waitingNote(g.mode, round, g.songCount),
    history,
    standings: table,
    completedCount: completed.length,
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
      const [{ round, answered }, players] = await Promise.all([
        roundState(g),
        db
          .select({ userId: users.id, name: users.name })
          .from(gamePlayers)
          .innerJoin(users, eq(users.id, gamePlayers.userId))
          .where(eq(gamePlayers.gameId, g.id))
          .orderBy(asc(users.name)),
      ]);
      const next = nextPosition(round, answered(userId));
      // Other players with songs left (by id: two players could share a name).
      const waitingOn = players
        .filter((p) => p.userId !== userId)
        .map((p) => ({ name: p.name, left: songsLeft(round, answered(p.userId)) }))
        .filter((w) => w.left > 0);
      return {
        id: g.id,
        songCount: g.songCount,
        label: roundLabel(g.mode, g.songCount, round),
        roundLength: round.end - round.start + 1,
        nextPosition: next,
        myTurn: next !== null,
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
      .select({ gs: gameSongs })
      .from(gameSongs)
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
    const totals = new Map(players.map((p) => [p.userId, { points: 0, correct: 0, played: 0 }]));

    const songResults: SongResult[] = gameRounds.map((r) => {
      const labelOf = new Map(r.gs.choices.map((c: Choice) => [c.songId, choiceLabel(c)]));
      const picks: Pick[] = players.map((p) => {
        const a = roundAnswers.find((x) => x.gameSongId === r.gs.id && x.userId === p.userId);
        const t = totals.get(p.userId)!;
        t.points += a?.points ?? 0;
        if (a?.correct) t.correct += 1;
        if (a?.answeredAt) t.played += 1;
        return {
          userId: p.userId,
          name: p.name,
          label: a?.choiceSongId ? (labelOf.get(a.choiceSongId) ?? null) : null,
          correct: a?.correct ?? null,
          points: a?.points ?? null,
          elapsedMs: a?.elapsedMs ?? null,
        };
      });
      const { fullUrl: _full, ...info } = songInfo(r.gs.song, r.gs.id, false);
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
