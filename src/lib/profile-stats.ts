// Player profile numbers: best guesses, best and worst genre and decade, and
// where a player finished in each game. Pure logic (no server imports) so it
// can be unit tested; src/lib/profiles.ts loads the rows.

import { genreList } from "./genres";
import { listNames } from "./modes";

/** Top guesses shown on a profile. */
export const TOP_GUESSES = 3;
/** A genre or decade needs at least this many songs to count as a best or worst. */
export const MIN_SONGS_FOR_BEST = 5;

/** One answered song that counts toward a profile. */
export type ScoredSong = {
  points: number;
  correct: boolean;
  elapsedMs: number;
  answeredAt: Date;
  title: string;
  artist: string;
  artworkUrl: string | null;
  genre: string | null;
  year: number | null;
};

/** The highest-scoring right answers; a tie goes to the faster answer, then the earlier one. */
export function bestGuesses<T extends ScoredSong>(rows: T[], n = TOP_GUESSES): T[] {
  return rows
    .filter((r) => r.correct && r.points > 0)
    .sort(
      (a, b) =>
        b.points - a.points || a.elapsedMs - b.elapsedMs || a.answeredAt.getTime() - b.answeredAt.getTime(),
    )
    .slice(0, n);
}

/** "1980s", or null without a believable year. */
export function decadeOf(year: number | null): string | null {
  if (year === null || !Number.isFinite(year) || year < 1900 || year > 2100) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

/**
 * The genres a song counts under (the same names as the catalog and the
 * start-a-game filter): a Pop/Rock song counts under Pop and under Rock.
 * Snapshots keep the genre as it was when the game was made ("Pop/Rock"), which
 * this reads the same way.
 */
export function genresOf(genre: string | null): string[] {
  return genreList(genre);
}

/** The decade a song counts under, as a list like genresOf (empty without a year). */
export function decadesOf(year: number | null): string[] {
  const d = decadeOf(year);
  return d ? [d] : [];
}

export type GroupStat = { name: string; songs: number; total: number; average: number };

/**
 * Best and worst group (genre or decade) by average points a song. A song with
 * several genres counts toward each. Only groups with at least `min` songs
 * count; worst is null unless two groups qualify.
 */
export function bestAndWorst(
  rows: ScoredSong[],
  /** The groups a song counts under (a song with two genres counts in both). */
  keysOf: (r: ScoredSong) => string[],
  min = MIN_SONGS_FOR_BEST,
): { best: GroupStat | null; worst: GroupStat | null } {
  const groups = new Map<string, { songs: number; total: number }>();
  for (const r of rows) {
    for (const key of keysOf(r)) {
      const g = groups.get(key) ?? { songs: 0, total: 0 };
      g.songs += 1;
      g.total += r.points;
      groups.set(key, g);
    }
  }
  const ranked = [...groups.entries()]
    .filter(([, g]) => g.songs >= min)
    .map(([name, g]) => ({ name, songs: g.songs, total: g.total, exact: g.total / g.songs }))
    // Higher average first; on a tie, the group with more songs is the surer pick.
    .sort((a, b) => b.exact - a.exact || b.songs - a.songs || a.name.localeCompare(b.name));
  const out = ({ exact, ...g }: (typeof ranked)[number]): GroupStat => ({ ...g, average: Math.round(exact) });
  if (ranked.length === 0) return { best: null, worst: null };
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null;
  return { best: out(ranked[0]), worst: worst ? out(worst) : null };
}

/** How many songs answered, how many right, and the average answer time. */
export function answerSummary(rows: ScoredSong[]): { answered: number; right: number; averageMs: number | null } {
  const right = rows.filter((r) => r.correct).length;
  const averageMs = rows.length ? rows.reduce((s, r) => s + r.elapsedMs, 0) / rows.length : null;
  return { answered: rows.length, right, averageMs };
}

// ---------------------------------------------------------------------------
// Placings in a game
// ---------------------------------------------------------------------------

export type GameTotal = { userId: string; name: string; points: number };

/** 1-based place with ties sharing a place (two at the top are both 1st, the next is 3rd). */
export function placeOf(table: GameTotal[], userId: string): number {
  const me = table.find((t) => t.userId === userId);
  if (!me) return table.length;
  return 1 + table.filter((t) => t.points > me.points).length;
}

export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

/** Everyone on the top score (more than one on a tie). */
export function leadersOf(table: GameTotal[]): GameTotal[] {
  if (table.length === 0) return [];
  const top = Math.max(...table.map((t) => t.points));
  return table.filter((t) => t.points === top).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Who won (or led, for a game ended early), from one player's point of view:
 * "You won", "Dave won", "You and Dave tied", "Mike led".
 */
export function resultText(table: GameTotal[], userId: string, ended: boolean): string {
  const leaders = leadersOf(table);
  if (leaders.length === 0) return "";
  const names = leaders.map((l) => (l.userId === userId ? "You" : l.name));
  // "You" first: "You and Dave tied".
  names.sort((a, b) => Number(b === "You") - Number(a === "You"));
  if (leaders.length > 1) return `${listNames(names)} ${ended ? "were level" : "tied"}`;
  return `${names[0]} ${ended ? "led" : "won"}`;
}

/** A finished game counts as a win when you're on the top score with at least one other player in it. */
export function isWin(table: GameTotal[], userId: string): boolean {
  return table.length > 1 && leadersOf(table).some((l) => l.userId === userId);
}

/** "with Mike", "with Mike and Sarah", "4 players", or "just you". */
export function companyText(others: string[]): string {
  if (others.length === 0) return "just you";
  if (others.length <= 2) return `with ${listNames([...others].sort((a, b) => a.localeCompare(b)))}`;
  return `${others.length + 1} players`;
}
