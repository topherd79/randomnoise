// Filters for choosing which songs a new game draws from. Shared by the game
// form (live counts) and the server (the actual draw), so both agree.
// No server-only imports here.

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

export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/** Whether decades or genres narrow the draw (picked artists only reorder it). */
export function hasFilters(f: SongFilters): boolean {
  return f.decades.length > 0 || f.genres.length > 0 || (f.excludeGenres?.length ?? 0) > 0;
}

/**
 * Any of the ticked options within a filter, and every filter that has
 * something ticked. A song with no year (or genre) can't match a decade (or
 * genre) filter. A left-out genre is never drawn, whatever else is ticked.
 * Picked artists don't narrow anything here: see isPreferred.
 */
export function matchesFilters(song: { year: number | null; genre: string | null }, f: SongFilters): boolean {
  if (f.decades.length && (song.year === null || !f.decades.includes(decadeOf(song.year)))) return false;
  if (f.genres.length && (!song.genre || !f.genres.includes(filterKey(song.genre)))) return false;
  if (f.excludeGenres?.length && song.genre && f.excludeGenres.includes(filterKey(song.genre))) return false;
  return true;
}

/** Whether a song is by one of the picked artists (their songs come first). */
export function isPreferred(song: { artist: string }, f: Pick<SongFilters, "artists">): boolean {
  return f.artists.length > 0 && f.artists.map(filterKey).includes(filterKey(song.artist));
}
