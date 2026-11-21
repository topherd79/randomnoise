// Pass the Aux: everyone is in one room and players take turns. Only the
// player whose turn it is hears the song (on their own phone) and answers;
// everyone else watches the same screen live. Pure logic (no server imports),
// shared by the server (turn timing) and the phones (what to show when).
//
// A game is 5 songs a player, in a random turn order that's the same every lap.
// Each turn: the clip and the clock start together, as in the other modes; the
// turn ends 5 seconds after the clip ends or the answers finish (15 s),
// whichever is later (no answer scores 0). Then everyone sees the result for
// 3 seconds, then a 3-2-1 countdown, and the next player's song starts.

import { REVEAL_MS } from "./rules";

export const AUX_SONGS_PER_PLAYER = 5;
export const AUX_MIN_PLAYERS = 2;
/** A turn ends this long after the later of the clip ending and the answers finishing. */
export const AUX_TURN_GRACE_MS = 5_000;
/** How long everyone sees how a turn went before the countdown. */
export const AUX_RESULT_MS = 3_000;
/** The "You're up in 3, 2, 1" before each song (the first one too). */
export const AUX_COUNTDOWN_MS = 3_000;
/** "Start without …" appears this long after the last player tapped I'm in. */
export const AUX_LOBBY_WAIT_MS = 30_000;
/** An answer tapped just before the turn ended still counts if it arrives within this. */
export const AUX_LATE_ANSWER_MS = 750;
/**
 * The phones line their clocks up with the server's, but not perfectly: the
 * turn player's phone may start the clip up to this much before the server's
 * start time and still count.
 */
export const AUX_EARLY_START_MS = 1_500;
/** If the clip hasn't started this long after the turn began, the phone missed its cue. */
export const MISSED_CUE_MS = 2_500;

/** 5 songs a player: 10, 15, 20 or 25. */
export const auxSongCount = (players: number) => players * AUX_SONGS_PER_PLAYER;

/** How long a turn lasts, from the moment the clip should start. */
export function turnLengthMs(clipLengthSec: number): number {
  return Math.max(Math.round(clipLengthSec * 1000), REVEAL_MS) + AUX_TURN_GRACE_MS;
}

/** Whose turn a song is: an index into the players in turn order (0 = player 1). */
export function turnIndex(position: number, players: number): number {
  return (position - 1) % players;
}

/** Which of the player's own turns a song is: 1 for their first, up to 5. */
export function lapOf(position: number, players: number): number {
  return Math.floor((position - 1) / players) + 1;
}

/** A player's next song from `from` on (by their index in the turn order), or null when they have none left. */
export function nextTurnPosition(index: number, players: number, from: number, songCount: number): number | null {
  if (players < 1) return null;
  const start = Math.max(1, from);
  const offset = (((index - turnIndex(start, players)) % players) + players) % players;
  const p = start + offset;
  return p <= songCount ? p : null;
}

export type LobbyPlayer = { userId: string; joinedAt: number | null };

/**
 * Who gets the Start button (players in turn order): the first one who's in.
 * Usually player 1; if player 1 isn't in, player 2, and so on.
 */
export function lobbyStarter(players: LobbyPlayer[]): string | null {
  return players.find((p) => p.joinedAt !== null)?.userId ?? null;
}

/**
 * When "Start without …" becomes available: 30 seconds after the last player
 * tapped I'm in, while someone is still missing and at least two are in.
 * Null when it doesn't apply.
 */
export function startWithoutAt(players: LobbyPlayer[]): number | null {
  const joined = players.filter((p) => p.joinedAt !== null);
  if (joined.length === players.length || joined.length < AUX_MIN_PLAYERS) return null;
  return Math.max(...joined.map((p) => p.joinedAt!)) + AUX_LOBBY_WAIT_MS;
}

export type AuxPhase =
  | { kind: "lobby" }
  /** How the last turn went (3 s). */
  | { kind: "result" }
  /** "You're up in 3", before each song. */
  | { kind: "countdown"; seconds: number }
  | { kind: "turn" }
  /** The turn is over; waiting for the server to say how it went. */
  | { kind: "timeUp" }
  /** The game is over (or ended early): time for the recap. */
  | { kind: "over" };

type PhaseInput = {
  status: "active" | "finished" | "cancelled";
  started: boolean;
  /** The song being played now (not finished yet). */
  turn: { startsAt: number; endsAt: number } | null;
  /** The song finished most recently. */
  last: { completedAt: number } | null;
};

/** What every phone shows at this moment (server time). */
export function auxPhase(s: PhaseInput, now: number): AuxPhase {
  const showingResult = s.last !== null && now < s.last.completedAt + AUX_RESULT_MS;
  if (s.status !== "active") return s.status === "finished" && showingResult ? { kind: "result" } : { kind: "over" };
  if (!s.started) return { kind: "lobby" };
  if (!s.turn) return showingResult ? { kind: "result" } : { kind: "timeUp" };
  if (now < s.turn.startsAt) {
    if (showingResult) return { kind: "result" };
    return { kind: "countdown", seconds: Math.max(1, Math.ceil((s.turn.startsAt - now) / 1000)) };
  }
  return now < s.turn.endsAt ? { kind: "turn" } : { kind: "timeUp" };
}

/**
 * When the clock started, for showing the answers revealing and the points
 * sliding down. The server records the moment the turn player's clip really
 * started; until that arrives, the scheduled start stands in for a moment, so
 * everyone's screens move together. Null: the clip hasn't started (a phone
 * missed its cue).
 */
export function clockStart(turn: { startsAt: number; startedAt: number | null }, now: number): number | null {
  if (turn.startedAt !== null) return turn.startedAt;
  return now - turn.startsAt < MISSED_CUE_MS ? turn.startsAt : null;
}
