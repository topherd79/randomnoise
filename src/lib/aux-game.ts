import "server-only";
import { after } from "next/server";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games, users, type GameStatus } from "@/db/schema";
import { publishGameUpdate } from "./live";
import { removeFile } from "./storage";
import { choiceLabel, scoreAnswer, shuffleFor } from "./rules";
import { listNames } from "./modes";
import { auxTurnOrder, emailPlayers, standings, type AnswerResult } from "./games";
import {
  AUX_COUNTDOWN_MS,
  AUX_EARLY_START_MS,
  AUX_LATE_ANSWER_MS,
  AUX_MIN_PLAYERS,
  AUX_RESULT_MS,
  auxSongCount,
  lapOf,
  lobbyStarter,
  nextTurnPosition,
  startWithoutAt,
  turnIndex,
  turnLengthMs,
} from "./aux";

// Pass the Aux on the server: the lobby, starting the game, and each turn.
// The server keeps the clock for everyone: it sets when each turn starts,
// scores the answer, and ends a turn that runs out (even if the turn player's
// phone has died), so every phone shows the same thing at the same moment.
// The rules and timings are in aux.ts.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export type AuxPlayer = {
  userId: string;
  name: string;
  /** Place in the turn order: 1 = player 1. */
  order: number;
  /** Tapped "I'm in" in the lobby. */
  joined: boolean;
  points: number;
  correct: number;
  played: number;
};

export type AuxChoice = { songId: string; label: string };

/** The song being played now. */
export type AuxTurn = {
  position: number;
  gameSongId: string;
  playerId: string;
  /** Which of the turn player's own songs this is, out of how many. */
  lap: number;
  laps: number;
  /** Server time the clip should start, and when the turn ends. */
  startsAt: number;
  endsAt: number;
  /** Server time the clip really started on the turn player's phone, once it has. */
  startedAt: number | null;
  /** In the turn player's order, the same on every phone. Which one is right isn't sent. */
  choices: AuxChoice[];
  /** Only for the turn player. */
  clipUrl: string | null;
};

/** How the latest finished song went, for everyone (the right answer is safe to show now). */
export type AuxResult = {
  position: number;
  playerId: string;
  completedAt: number;
  song: { title: string; artist: string; album: string | null; year: number | null; artworkUrl: string | null };
  choices: AuxChoice[];
  rightSongId: string;
  /** Null when time ran out. */
  pickSongId: string | null;
  correct: boolean;
  points: number;
  elapsedMs: number | null;
};

export type AuxState = {
  id: string;
  status: GameStatus;
  /** When this was put together (server time), so the phone can line its clock up. */
  serverNow: number;
  me: string;
  songCount: number;
  started: boolean;
  /** In turn order. */
  players: AuxPlayer[];
  /** While the lobby is open: who gets the Start button, and when "Start without …" appears. */
  lobby: { starter: string | null; startWithoutAt: number | null } | null;
  turn: AuxTurn | null;
  last: AuxResult | null;
  /** My next song's clip (the current one when it's my turn), so my phone can load it ahead of time. */
  myNextClip: string | null;
};

type GameRow = typeof games.$inferSelect;
type GameSongRow = typeof gameSongs.$inferSelect;

async function songAt(gameId: string, position: number): Promise<GameSongRow | undefined> {
  const [gs] = await db
    .select()
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, position)))
    .limit(1);
  return gs;
}

const clipUrlOf = (clipFile: string) => `/api/clips/${clipFile}`;

/** The answer choices in the turn player's order (every phone shows that order). */
const choicesFor = (gs: GameSongRow, playerId: string): AuxChoice[] =>
  shuffleFor(
    gs.choices.map((c) => ({ songId: c.songId, label: choiceLabel(c) })),
    `${gs.id}:${playerId}`,
  );

/** When a turn ends: 5 s after the clip ends or the answers finish, whichever is later. */
const turnEndsAt = (game: GameRow, gs: GameSongRow) => game.turnStartsAt!.getTime() + turnLengthMs(gs.clipLengthSec);

// ---------------------------------------------------------------------------
// What every phone shows
// ---------------------------------------------------------------------------

/** Everything a player's phone needs to show the game right now. Null if they aren't in it. */
export async function loadAuxState(gameId: string, userId: string): Promise<AuxState | null> {
  // A turn that ran out is scored before anyone looks at the game.
  await settleAuxTurn(gameId);
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game || game.mode !== "aux") return null;
  const players = await db
    .select({ userId: users.id, name: users.name, joinedAt: gamePlayers.joinedAt })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(gamePlayers.turnOrder), asc(gamePlayers.userId));
  const myIndex = players.findIndex((p) => p.userId === userId);
  if (myIndex < 0) return null;
  const n = players.length;
  const started = game.turnStartsAt !== null;
  const active = game.status === "active";

  const [table, current, [lastRow]] = await Promise.all([
    standings(gameId),
    started && active ? songAt(gameId, game.currentPosition) : Promise.resolve(undefined),
    db
      .select()
      .from(gameSongs)
      .where(and(eq(gameSongs.gameId, gameId), isNotNull(gameSongs.completedAt)))
      .orderBy(desc(gameSongs.position))
      .limit(1),
  ]);
  const songIds = [current?.id, lastRow?.id].filter((id): id is string => Boolean(id));
  const rows = songIds.length ? await db.select().from(answers).where(inArray(answers.gameSongId, songIds)) : [];

  let turn: AuxTurn | null = null;
  if (current && !current.completedAt && game.turnStartsAt) {
    const playerId = players[turnIndex(current.position, n)].userId;
    const a = rows.find((r) => r.gameSongId === current.id && r.userId === playerId);
    turn = {
      position: current.position,
      gameSongId: current.id,
      playerId,
      lap: lapOf(current.position, n),
      laps: Math.ceil(game.songCount / n),
      startsAt: game.turnStartsAt.getTime(),
      endsAt: turnEndsAt(game, current),
      startedAt: a?.startedAt.getTime() ?? null,
      choices: choicesFor(current, playerId),
      clipUrl: playerId === userId ? clipUrlOf(current.clipFile) : null,
    };
  }

  let last: AuxResult | null = null;
  if (lastRow?.completedAt) {
    // Whoever has an answer for it played it (a time-out is saved as an answer too).
    const a = rows.find((r) => r.gameSongId === lastRow.id && r.answeredAt);
    const playerId = a?.userId ?? players[turnIndex(lastRow.position, n)].userId;
    last = {
      position: lastRow.position,
      playerId,
      completedAt: lastRow.completedAt.getTime(),
      song: {
        title: lastRow.song.title,
        artist: lastRow.song.artist,
        album: lastRow.song.album,
        year: lastRow.song.year,
        artworkUrl: lastRow.song.artworkUrl,
      },
      choices: choicesFor(lastRow, playerId),
      rightSongId: lastRow.songId,
      pickSongId: a?.choiceSongId ?? null,
      correct: Boolean(a?.correct),
      points: a?.points ?? 0,
      elapsedMs: a?.elapsedMs ?? null,
    };
  }

  let myNextClip: string | null = null;
  if (active) {
    if (turn?.clipUrl) myNextClip = turn.clipUrl;
    else {
      const next = nextTurnPosition(myIndex, n, started ? game.currentPosition : 1, game.songCount);
      const gs = next === null ? undefined : await songAt(gameId, next);
      myNextClip = gs ? clipUrlOf(gs.clipFile) : null;
    }
  }

  const lobbyPlayers = players.map((p) => ({ userId: p.userId, joinedAt: p.joinedAt?.getTime() ?? null }));
  return {
    id: game.id,
    status: game.status,
    serverNow: Date.now(),
    me: userId,
    songCount: game.songCount,
    started,
    players: players.map((p, i) => {
      const s = table.find((t) => t.userId === p.userId);
      return {
        userId: p.userId,
        name: p.name,
        order: i + 1,
        joined: p.joinedAt !== null,
        points: s?.points ?? 0,
        correct: s?.correct ?? 0,
        played: s?.played ?? 0,
      };
    }),
    lobby: started || !active ? null : { starter: lobbyStarter(lobbyPlayers), startWithoutAt: startWithoutAt(lobbyPlayers) },
    turn,
    last,
    myNextClip,
  };
}

// ---------------------------------------------------------------------------
// The lobby
// ---------------------------------------------------------------------------

/** "I'm in": this player is in the room and ready. */
export async function joinAux(userId: string, gameId: string): Promise<Result> {
  const [row] = await db
    .select({ game: games, joinedAt: gamePlayers.joinedAt })
    .from(games)
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, userId)))
    .where(eq(games.id, gameId))
    .limit(1);
  if (!row || row.game.mode !== "aux") return { ok: false, error: "That isn't your game." };
  if (row.game.status !== "active") return { ok: false, error: "This game is over." };
  if (row.joinedAt || row.game.turnStartsAt) return { ok: true }; // already in, or already started
  await db
    .update(gamePlayers)
    .set({ joinedAt: new Date() })
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId), isNull(gamePlayers.joinedAt)));
  await publishGameUpdate(gameId);
  return { ok: true };
}

/**
 * Start the game: the first player who's in (normally player 1) taps Start
 * once everyone's in. With `without`, 30 seconds after the last "I'm in", the
 * players who still aren't in are dropped: everyone moves up a number and the
 * game shrinks to 5 songs for each player left. The first song starts after a
 * 3-2-1 countdown.
 */
export async function startAux(userId: string, gameId: string, opts: { without?: boolean } = {}): Promise<Result> {
  const droppedClips: string[] = [];
  const r = await db.transaction(async (tx): Promise<Result> => {
    // One start at a time (two taps, or two players at once).
    const [game] = await tx.select().from(games).where(eq(games.id, gameId)).for("update");
    if (!game || game.mode !== "aux") return { ok: false, error: "That isn't a Pass the Aux game." };
    if (game.status !== "active") return { ok: false, error: "This game is over." };
    if (game.turnStartsAt) return { ok: true }; // already started
    const players = await tx
      .select({ userId: gamePlayers.userId, name: users.name, joinedAt: gamePlayers.joinedAt })
      .from(gamePlayers)
      .innerJoin(users, eq(users.id, gamePlayers.userId))
      .where(eq(gamePlayers.gameId, gameId))
      .orderBy(asc(gamePlayers.turnOrder), asc(gamePlayers.userId));
    if (!players.some((p) => p.userId === userId)) return { ok: false, error: "That isn't your game." };
    const lobby = players.map((p) => ({ userId: p.userId, joinedAt: p.joinedAt?.getTime() ?? null }));
    const starter = lobbyStarter(lobby);
    if (starter !== userId) {
      const name = players.find((p) => p.userId === starter)?.name;
      return { ok: false, error: name ? `${name} starts the game.` : "Tap I'm in first." };
    }

    let songCount = game.songCount;
    const missing = players.filter((p) => !p.joinedAt);
    if (missing.length > 0) {
      const who = listNames(missing.map((p) => p.name));
      if (!opts.without) return { ok: false, error: `Waiting on ${who}.` };
      const at = startWithoutAt(lobby);
      if (at === null) return { ok: false, error: `Pass the Aux needs at least ${AUX_MIN_PLAYERS} players.` };
      if (Date.now() < at - 1000) return { ok: false, error: `Give ${who} a few more seconds.` };
      const staying = players.filter((p) => p.joinedAt);
      await tx.delete(gamePlayers).where(
        and(
          eq(gamePlayers.gameId, gameId),
          inArray(
            gamePlayers.userId,
            missing.map((p) => p.userId),
          ),
        ),
      );
      for (const [i, p] of staying.entries()) {
        await tx
          .update(gamePlayers)
          .set({ turnOrder: i + 1 })
          .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, p.userId)));
      }
      songCount = auxSongCount(staying.length);
      const dropped = await tx
        .delete(gameSongs)
        .where(and(eq(gameSongs.gameId, gameId), gt(gameSongs.position, songCount)))
        .returning({ clipFile: gameSongs.clipFile });
      droppedClips.push(...dropped.map((d) => d.clipFile));
    }
    await tx
      .update(games)
      .set({ songCount, turnStartsAt: new Date(Date.now() + AUX_COUNTDOWN_MS) })
      .where(eq(games.id, gameId));
    return { ok: true };
  });
  await Promise.all(droppedClips.map((f) => removeFile("clips", f).catch(() => {})));
  if (r.ok) await publishGameUpdate(gameId);
  return r;
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

/** The song being played now, if it's this player's turn. */
async function myTurn(userId: string, gameSongId: string) {
  const [row] = await db
    .select({ gs: gameSongs, game: games })
    .from(gameSongs)
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, userId)))
    .where(eq(gameSongs.id, gameSongId))
    .limit(1);
  if (!row || row.game.mode !== "aux") return null;
  return row;
}

async function isTurnPlayer(userId: string, game: GameRow, gs: GameSongRow): Promise<boolean> {
  const order = await auxTurnOrder(game.id);
  return order.length > 0 && order[turnIndex(gs.position, order.length)] === userId;
}

function notNow(game: GameRow, gs: GameSongRow): string | null {
  if (game.status !== "active") return "This game is over.";
  if (!game.turnStartsAt || gs.position !== game.currentPosition || gs.completedAt) return "This song isn't being played right now.";
  return null;
}

/**
 * The turn player's clip has started playing: the clock starts now (on the
 * server), and everyone else's screen starts revealing the answers. Calling it
 * again (a replay) keeps the original start.
 */
export async function playAux(userId: string, gameSongId: string): Promise<Result<{ startedAt: number }>> {
  const row = await myTurn(userId, gameSongId);
  if (!row) return { ok: false, error: "That song isn't part of your game." };
  const { gs, game } = row;
  const why = notNow(game, gs);
  if (why) return { ok: false, error: why };
  if (!(await isTurnPlayer(userId, game, gs))) return { ok: false, error: "It isn't your turn." };
  const now = Date.now();
  if (now < game.turnStartsAt!.getTime() - AUX_EARLY_START_MS) return { ok: false, error: "Your song hasn't started yet." };
  if (now >= turnEndsAt(game, gs)) return { ok: false, error: "Time's up." };
  const inserted = await db
    .insert(answers)
    .values({ gameSongId, userId, startedAt: new Date(now) })
    .onConflictDoNothing()
    .returning({ id: answers.id });
  const [a] = await db
    .select({ startedAt: answers.startedAt })
    .from(answers)
    .where(and(eq(answers.gameSongId, gameSongId), eq(answers.userId, userId)))
    .limit(1);
  if (inserted.length) await publishGameUpdate(game.id);
  return { ok: true, startedAt: a.startedAt.getTime() };
}

/** The turn player's pick. Scored like any other mode, from when their clip started. */
export async function answerAux(
  userId: string,
  gameSongId: string,
  choiceSongId: string,
): Promise<Result<{ result: AnswerResult }>> {
  const row = await myTurn(userId, gameSongId);
  if (!row) return { ok: false, error: "That song isn't part of your game." };
  const { gs, game } = row;
  const [existing] = await db
    .select()
    .from(answers)
    .where(and(eq(answers.gameSongId, gameSongId), eq(answers.userId, userId)))
    .limit(1);
  // Already answered (a double tap, a retry, or time ran out): say how it went.
  if (existing?.answeredAt) {
    return {
      ok: true,
      result: {
        correct: Boolean(existing.correct),
        points: existing.points ?? 0,
        elapsedMs: existing.elapsedMs ?? 0,
        rightSongId: gs.songId,
        choiceSongId: existing.choiceSongId ?? "",
      },
    };
  }
  const why = notNow(game, gs);
  if (why) return { ok: false, error: why };
  if (!(await isTurnPlayer(userId, game, gs))) return { ok: false, error: "It isn't your turn." };
  if (!existing) return { ok: false, error: "Tap Play first." };
  if (!gs.choices.some((c) => c.songId === choiceSongId)) return { ok: false, error: "That isn't one of the choices." };

  const now = new Date();
  if (now.getTime() > turnEndsAt(game, gs) + AUX_LATE_ANSWER_MS) {
    await settleAuxTurn(game.id);
    return { ok: false, error: "Time's up." };
  }
  const elapsedMs = Math.max(0, now.getTime() - existing.startedAt.getTime());
  const correct = choiceSongId === gs.songId;
  const points = scoreAnswer(correct, elapsedMs);
  const saved = await db
    .update(answers)
    .set({ answeredAt: now, choiceSongId, correct, elapsedMs, points })
    .where(and(eq(answers.id, existing.id), isNull(answers.answeredAt)))
    .returning({ id: answers.id });
  if (!saved.length) return answerAux(userId, gameSongId, choiceSongId); // a double tap: the first answer stands
  await finishTurn(game.id, gs);
  return { ok: true, result: { correct, points, elapsedMs, rightSongId: gs.songId, choiceSongId } };
}

/**
 * If the current turn has run out without an answer, score it (0 points, saved
 * as an answer with no pick) and move on. Called whenever anyone loads the
 * game, and every phone asks for the game the moment a turn ends, so the game
 * moves on even if the turn player's phone has died. Safe to call any time.
 */
export async function settleAuxTurn(gameId: string): Promise<void> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game || game.mode !== "aux" || game.status !== "active" || !game.turnStartsAt) return;
  const gs = await songAt(gameId, game.currentPosition);
  if (!gs || gs.completedAt) return;
  const endsAt = turnEndsAt(game, gs);
  if (Date.now() <= endsAt + AUX_LATE_ANSWER_MS) return;
  const order = await auxTurnOrder(gameId);
  if (order.length === 0) return;
  const playerId = order[turnIndex(gs.position, order.length)];
  await db.insert(answers).values({ gameSongId: gs.id, userId: playerId, startedAt: game.turnStartsAt }).onConflictDoNothing();
  await db
    .update(answers)
    .set({ answeredAt: new Date(endsAt), choiceSongId: null, correct: false, elapsedMs: null, points: 0 })
    .where(and(eq(answers.gameSongId, gs.id), eq(answers.userId, playerId), isNull(answers.answeredAt)));
  await finishTurn(gameId, gs);
}

/** How long the last song's clip may keep playing after the game ends, before it's deleted. */
const LAST_CLIP_GRACE_MS = 40_000;

/**
 * A turn is over: show the result for 3 s, then count down 3 s to the next
 * player's song, or finish the game after the last one. Only the first caller
 * moves the game on.
 */
async function finishTurn(gameId: string, gs: GameSongRow): Promise<void> {
  const now = new Date();
  const done = await db
    .update(gameSongs)
    .set({ completedAt: now })
    .where(and(eq(gameSongs.id, gs.id), isNull(gameSongs.completedAt)))
    .returning({ id: gameSongs.id });
  if (!done.length) return;
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game) return;
  const last = gs.position >= game.songCount;
  await db
    .update(games)
    .set(
      last
        ? { status: "finished", finishedAt: now }
        : { currentPosition: gs.position + 1, turnStartsAt: new Date(now.getTime() + AUX_RESULT_MS + AUX_COUNTDOWN_MS) },
    )
    .where(and(eq(games.id, gameId), eq(games.status, "active"), eq(games.currentPosition, gs.position)));

  // This song keeps playing on its player's phone until the next one starts,
  // so its clip stays for now. The one before it is done with: free the space.
  const previous = gs.position > 1 ? await songAt(gameId, gs.position - 1) : undefined;
  if (previous) await removeFile("clips", previous.clipFile).catch((err) => console.error("Couldn't delete clip", previous.clipFile, err));
  if (last) {
    setTimeout(() => void removeFile("clips", gs.clipFile).catch(() => {}), LAST_CLIP_GRACE_MS).unref?.();
    after(() => emailPlayers(gameId, { kind: "over" }));
  }
  await publishGameUpdate(gameId);
}

// ---------------------------------------------------------------------------
// Around the game
// ---------------------------------------------------------------------------

/** How long after it opens a lobby sends the home screen straight to it. */
const LOBBY_REDIRECT_MS = 3 * 60 * 60 * 1000;

/**
 * A Pass the Aux lobby this player is in that opened in the last few hours, if
 * any: the home screen goes straight there (everyone's in the room, about to play).
 */
export async function openLobbyFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: games.id })
    .from(games)
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, userId)))
    .where(
      and(
        eq(games.mode, "aux"),
        eq(games.status, "active"),
        isNull(games.turnStartsAt),
        gt(games.createdAt, new Date(Date.now() - LOBBY_REDIRECT_MS)),
      ),
    )
    .orderBy(desc(games.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Whether a game is Pass the Aux (for a friendly page when someone was left out of one). */
export async function isAuxGame(gameId: string): Promise<boolean> {
  const [row] = await db.select({ mode: games.mode }).from(games).where(eq(games.id, gameId)).limit(1);
  return row?.mode === "aux";
}

/** For the home card: the lobby, or whose turn it is. */
export async function auxSummary(gameId: string, userId: string) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  const order = await db
    .select({ userId: users.id, name: users.name, joinedAt: gamePlayers.joinedAt })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(gamePlayers.turnOrder), asc(gamePlayers.userId));
  const myIndex = order.findIndex((p) => p.userId === userId);
  const lobby = !game?.turnStartsAt;
  const turnPlayer = !lobby && order.length ? order[turnIndex(game!.currentPosition, order.length)] : null;
  return {
    lobby,
    myNumber: myIndex + 1,
    joined: order.filter((p) => p.joinedAt).length,
    players: order.length,
    turnName: turnPlayer ? (turnPlayer.userId === userId ? null : turnPlayer.name) : null,
    myTurn: turnPlayer?.userId === userId,
  };
}
