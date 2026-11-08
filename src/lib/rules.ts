// The game's rules and numbers, in one place so they're easy to tune after test games.
// Shared by the server (scoring) and the play screen (reveal animation, points ticker).

export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 5;

/** All four choices finish appearing at this moment after Play. */
export const REVEAL_MS = 15_000;
/** A right answer scores MIN_POINTS from full reveal until this moment, then 0. */
export const CUTOFF_MS = 60_000;

export const MAX_POINTS = 1000;
export const MIN_POINTS = 100;

/**
 * Wrong answers lose a third of what a right answer would have earned at that
 * moment, which makes random guessing worth zero on average (1 right in 4).
 * Set to false for "wrong = 0".
 */
export const GUESS_PENALTY = true;

/** What a right answer is worth this many milliseconds after Play. */
export function pointsAt(elapsedMs: number): number {
  if (elapsedMs <= 0) return MAX_POINTS;
  if (elapsedMs < REVEAL_MS) {
    return Math.round(MAX_POINTS - (MAX_POINTS - MIN_POINTS) * (elapsedMs / REVEAL_MS));
  }
  if (elapsedMs <= CUTOFF_MS) return MIN_POINTS;
  return 0;
}

/** Points for an answer: positive when right, zero or negative when wrong. */
export function scoreAnswer(correct: boolean, elapsedMs: number): number {
  const worth = pointsAt(elapsedMs);
  if (correct) return worth;
  return GUESS_PENALTY ? -Math.round(worth / 3) : 0;
}

/** How many characters of a choice are showing at this moment (all choices finish together). */
export function revealedChars(length: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  if (elapsedMs >= REVEAL_MS) return length;
  return Math.ceil(length * (elapsedMs / REVEAL_MS));
}

export function choiceLabel(c: { title: string; artist: string }): string {
  return `${c.title} – ${c.artist}`;
}

/**
 * Each player sees the four choices in their own order, the same every time
 * they look (seeded by player and song, no storage needed).
 */
export function shuffleFor<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const next = () => {
    // mulberry32
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** "4.2 s" */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatPoints(points: number): string {
  return points.toLocaleString("en-US");
}
