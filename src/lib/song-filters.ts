// Filters for choosing which songs a new game draws from. Shared by the game
// form (live counts) and the server (the actual draw), so both agree.
// No server-only imports here.

import { genreList } from "./genres";

export type SongFilters = {
  /** Decade starts, e.g. 1990 for the 1990s. */
  decades: number[];
  /** Normalized genre keys (see filterKey). */
  genres: string[];
  /** Genres to leave out (normalized keys): never drawn. Songs with no genre stay in. */
  excludeGenres?: string[];
  /**
   * Preferred artists (normalized keys). Not a filter: their songs come first,
   * without the per-artist limit, and other songs fill the rest (pickWithPreferred
   * in draw.ts).
   */
  artists: string[];
};

/** What the game form knows about each switched-on song (no titles: the admin plays too). */
export type SongMeta = { artist: string; year: number | null; genre: string | null; played: boolean };

export const NO_FILTERS: SongFilters = { decades: [], genres: [], excludeGenres: [], artists: [] };

/** Case- and spacing-insensitive key, so "R&B/Soul" and "r&b/soul " match. Mirrored in SQL (filterKeySql). */
export function filterKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** A song's genres as filter keys: "Pop/Rock" (or "Pop, Rock") is ["pop", "rock"]. */
export function genreKeys(genre: string | null): string[] {
  return genreList(genre).map(filterKey);
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/** Whether decades or genres narrow the draw (picked artists only reorder it). */
export function hasFilters(f: SongFilters): boolean {
  return f.decades.length > 0 || f.genres.length > 0 || (f.excludeGenres?.length ?? 0) > 0;
}

/**
 * Any of the ticked options within a filter, and every filter that has
 * something ticked. A song with several genres matches a genre filter when any
 * of them is ticked; a song with no year (or genre) can't match a decade (or
 * genre) filter. A left-out genre is never drawn, whatever else is ticked (red
 * wins: a Pop/Rock song stays out when Pop is left out, even with Rock ticked).
 * Picked artists don't narrow anything here: see isPreferred.
 */
export function matchesFilters(song: { year: number | null; genre: string | null }, f: SongFilters): boolean {
  if (f.decades.length && (song.year === null || !f.decades.includes(decadeOf(song.year)))) return false;
  if (!f.genres.length && !f.excludeGenres?.length) return true;
  const keys = genreKeys(song.genre);
  if (f.genres.length && !keys.some((k) => f.genres.includes(k))) return false;
  if (f.excludeGenres?.length && keys.some((k) => f.excludeGenres!.includes(k))) return false;
  return true;
}

/** Whether a song is by one of the picked artists (their songs come first). */
export function isPreferred(song: { artist: string }, f: Pick<SongFilters, "artists">): boolean {
  return f.artists.length > 0 && f.artists.map(filterKey).includes(filterKey(song.artist));
}

/**
 * What each decade and genre chip on the game form would leave you with, given
 * the other picks: a decade's count follows the genre chips (green and red), a
 * genre's count follows the decade chips. Picked artists don't narrow anything,
 * so they don't change the counts.
 */
export function chipCounts(
  songs: { year: number | null; genre: string | null }[],
  f: SongFilters,
): { decades: Map<number, number>; genres: Map<string, number> } {
  const decades = new Map<number, number>();
  const genres = new Map<string, number>();
  const bump = <K,>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const s of songs) {
    if (s.year !== null && matchesFilters(s, { ...f, decades: [] })) bump(decades, decadeOf(s.year));
    // A song counts under each of its genres.
    if (matchesFilters(s, { ...f, genres: [], excludeGenres: [] })) for (const g of genreKeys(s.genre)) bump(genres, g);
  }
  return { decades, genres };
}
