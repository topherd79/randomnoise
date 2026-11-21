// Playing on without the one player holding a game up. Pure logic (no server
// imports) so it can be unit tested and shared by the server and the page.
//
// The OG, 3 songs and All songs (never Pass the Aux): when everyone but one
// player has played every open song, a while after the last of them finished,
// the others can vote to play on without that player. It takes everyone else's
// vote, and a vote can't be taken back. In a game of two, the other player
// decides alone, after a longer wait. The player isn't told. Once the last vote
// is in they're out: the game never waits on them again, and they stay in its
// results crossed out, with the points they had. The admin can take anyone out
// of a game at any time.

import { listNames, type Round } from "./modes";

/** Hours after everyone else finished before a vote can start, with 3 or more players in the game. */
export const PLAY_ON_WAIT_HOURS = 4;
/** The same in a game of two, where the other player decides alone. */
export const PLAY_ON_WAIT_HOURS_TWO = 10;

const HOUR = 3_600_000;

/** How long the others wait before they can play on, by how many players are still in the game. */
export function playOnWaitMs(playersIn: number): number {
  return (playersIn <= 2 ? PLAY_ON_WAIT_HOURS_TWO : PLAY_ON_WAIT_HOURS) * HOUR;
}

export type PlayOnPlayer = { userId: string; name: string; left: number };

/** What one player sees of a vote to play on (null when there's nothing to vote on). */
export type PlayOnView = {
  target: { userId: string; name: string };
  /** When the last of the others finished the open songs, and when a vote can start. */
  othersDoneAt: number;
  opensAt: number;
  open: boolean;
  /** Whole hours since the others finished (for "hasn't played for 4 hours"). */
  hoursWaiting: number;
  /** How long until a vote can start (0 once it can), by the server's clock. */
  opensInMs: number;
  /** A game of two: the other player decides alone, and finishes the game alone. */
  alone: boolean;
  /** Everyone who votes (everyone still in but the target), me first, then by name. */
  voters: { userId: string; name: string; voted: boolean; me: boolean }[];
  iVoted: boolean;
};

/**
 * The vote as `me` sees it: only when every player still in but one has played
 * every open song, and `me` isn't that one (they're never told).
 */
export function playOnView(opts: {
  me: string;
  /** The players still in the game, with how many open songs each has left. */
  players: PlayOnPlayer[];
  /** When the last of the others answered their last open song. */
  othersDoneAt: number | null;
  /** Who has voted against the target this round. */
  votes: ReadonlySet<string>;
  now: number;
}): PlayOnView | null {
  const { me, players, othersDoneAt, votes, now } = opts;
  if (players.length < 2 || othersDoneAt === null) return null;
  const behind = players.filter((p) => p.left > 0);
  if (behind.length !== 1) return null;
  const target = behind[0];
  if (target.userId === me || !players.some((p) => p.userId === me)) return null;
  const opensAt = othersDoneAt + playOnWaitMs(players.length);
  const voters = players
    .filter((p) => p.userId !== target.userId)
    .map((p) => ({ userId: p.userId, name: p.name, voted: votes.has(p.userId), me: p.userId === me }))
    .sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
  return {
    target: { userId: target.userId, name: target.name },
    othersDoneAt,
    opensAt,
    open: now >= opensAt,
    opensInMs: Math.max(0, opensAt - now),
    hoursWaiting: Math.max(0, Math.floor((now - othersDoneAt) / HOUR)),
    alone: players.length === 2,
    voters,
    iVoted: votes.has(me),
  };
}

/** Whether everyone who votes has voted. */
export function votePasses(voterIds: string[], votes: ReadonlySet<string>): boolean {
  return voterIds.length > 0 && voterIds.every((id) => votes.has(id));
}

/** What opens once the target is out: "song 5 opens", "songs 7–9 open", or the end of the game. */
export function afterOutText(round: Round, roundSize: number, songCount: number): string {
  if (round.end >= songCount) return "the final results are in";
  const start = round.end + 1;
  const end = Math.min(start + roundSize - 1, songCount);
  return start === end ? `song ${start} opens for the rest of you` : `songs ${start}–${end} open for the rest of you`;
}

/** The confirm sheet's first line: who still has to vote, and what happens then. */
export function playOnConfirmText(view: PlayOnView, after: string): string {
  const name = view.target.name;
  if (view.alone) return `${name} leaves this game and you finish it alone.`;
  const still = view.voters.filter((v) => !v.voted && !v.me).map((v) => v.name);
  return still.length
    ? `Once ${listNames(still)} vote${still.length === 1 ? "s" : ""} too, ${name} leaves this game and ${after}.`
    : `Yours is the last vote: ${name} leaves this game and ${after}.`;
}

/** The home card's line about a vote under way, for someone who votes. Null when there's nothing to say. */
export function playOnHomeText(view: PlayOnView | null): { text: string; mine: boolean } | null {
  if (!view || !view.open) return null;
  const others = view.voters.filter((v) => v.voted && !v.me).map((v) => v.name);
  if (view.iVoted) return { text: `You voted to play on without ${view.target.name}.`, mine: true };
  if (others.length === 0) return null;
  return { text: `${listNames(others)} voted to play on without ${view.target.name}. Your vote?`, mine: false };
}

/** The line the players still in see once someone is out: "You all voted to play on without Dave." */
export function outNotice(out: { name: string; by: "vote" | "admin" }[], playersIn: number): string | null {
  if (out.length === 0) return null;
  const names = listNames(out.map((o) => o.name));
  if (out.every((o) => o.by === "admin")) return `${names} ${out.length === 1 ? "was" : "were"} taken out of this game.`;
  if (playersIn >= 3) return `You all voted to play on without ${names}.`;
  if (playersIn === 2) return `You both voted to play on without ${names}.`;
  return `You played on without ${names}.`;
}

/** What a player who's out sees on the game page while it goes on. */
export function wentOnText(by: "vote" | "admin", stillIn: string[]): string {
  if (by === "admin") return "You were taken out of this game.";
  if (stillIn.length === 1) return `${stillIn[0]} played on without you.`;
  return "Everyone else voted to play on without you.";
}
