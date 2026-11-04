// Filters for choosing which songs a new game draws from. Shared by the game
// form (live counts) and the server (the actual draw), so both agree.
// No server-only imports here.

export type SongFilters = {
  /** Decade starts, e.g. 1990 for the 1990s. */
  decades: number[];
  /** Normalized genre keys (see filterKey). */
  genres: string[];
  /** Normalized artist keys (see filterKey). */
  artists: string[];
};

/** What the game form knows about each switched-on song (no titles: the admin plays too). */
export type SongMeta = { artist: string; year: number | null; genre: string | null; played: boolean };

export const NO_FILTERS: SongFilters = { decades: [], genres: [], artists: [] };

/** Case- and spacing-insensitive key, so "R&B/Soul" and "r&b/soul " match. Mirrored in SQL (filterKeySql). */
export function filterKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

export function hasFilters(f: SongFilters): boolean {
  return f.decades.length > 0 || f.genres.length > 0 || f.artists.length > 0;
}

/**
 * Any of the ticked options within a filter, and every filter that has
 * something ticked. A song with no year (or genre) can't match a decade (or
 * genre) filter.
 */
export function matchesFilters(song: { artist: string; year: number | null; genre: string | null }, f: SongFilters): boolean {
  if (f.decades.length && (song.year === null || !f.decades.includes(decadeOf(song.year)))) return false;
  if (f.genres.length && (!song.genre || !f.genres.includes(filterKey(song.genre)))) return false;
  if (f.artists.length && !f.artists.includes(filterKey(song.artist))) return false;
  return true;
}
