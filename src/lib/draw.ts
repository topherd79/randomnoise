// How a new game picks its songs and wrong answers. Pure (no database, no
// server-only imports) so every rule here is covered by unit tests.

import type { WrongAnswerMode } from "@/db/schema";
import { normalize } from "./normalize";
import { filterKey } from "./song-filters";

export type Candidate = { id: string; title: string; artist: string; year: number | null; genre: string | null };

export function shuffle<T>(list: T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Which songs: the per-artist limit
// ---------------------------------------------------------------------------

/**
 * The most songs by one artist in a game: one per five songs
 * (5 songs: 1, 10: 2, 15: 3, 20: 4, 25: 5).
 */
export function maxSongsPerArtist(songCount: number): number {
  return Math.max(1, Math.floor(songCount / 5));
}

/**
 * Picks `songCount` songs, taking new songs before songs from earlier games
 * (each list already in the order it should be tried: new ones shuffled,
 * earlier ones played-longest-ago first), while keeping to `maxPerArtist`
 * songs per artist.
 *
 * The limit never stops a game from being made: if there aren't enough
 * different artists to fill it within the limit (a small catalog, or a filter
 * on one or two artists), the rest is filled spreading the artists as evenly
 * as possible.
 */
export function pickSpreadOut<T extends { id: string; artist: string }>(
  fresh: T[],
  earlier: T[],
  songCount: number,
  maxPerArtist: number,
): T[] {
  const key = (c: T) => filterKey(c.artist);
  const picked: T[] = [];
  const passedOver: T[] = [];
  const counts = new Map<string, number>();
  const count = (c: T) => counts.get(key(c)) ?? 0;
  const take = (c: T) => {
    picked.push(c);
    counts.set(key(c), count(c) + 1);
  };

  for (const c of [...fresh, ...earlier]) {
    if (picked.length === songCount) break;
    if (count(c) < maxPerArtist) take(c);
    else passedOver.push(c);
  }

  // Not enough artists to stay within the limit: add the artist with the fewest
  // songs so far each time (ties keep the original order, so new songs first).
  while (picked.length < songCount && passedOver.length > 0) {
    let best = 0;
    for (let i = 1; i < passedOver.length; i++) if (count(passedOver[i]) < count(passedOver[best])) best = i;
    take(passedOver.splice(best, 1)[0]);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// Wrong answers
// ---------------------------------------------------------------------------

/** How unlike two songs are in era and genre (0 = same genre, same year). */
function distance(a: Candidate, b: Candidate): number {
  const ga = a.genre ? normalize(a.genre) : "";
  const gb = b.genre ? normalize(b.genre) : "";
  const genre = !ga || !gb ? 1 : ga === gb ? 0 : 2;
  const year = a.year && b.year ? Math.min(Math.abs(a.year - b.year) / 4, 3) : 1.5;
  return genre + year;
}

/**
 * Three wrong answers for a song: other catalog songs, at random or (for
 * "similar") from the closest era and genre, with a little randomness so it
 * isn't always the same three. Songs coming up later in the same game are
 * avoided where possible, since seeing one as a wrong answer would be a hint.
 */
export function pickWrongAnswers(
  answer: Candidate,
  pool: Candidate[],
  inThisGame: Set<string>,
  mode: WrongAnswerMode,
  random: () => number = Math.random,
): Candidate[] {
  const label = (c: Candidate) => `${normalize(c.title)}|${normalize(c.artist)}`;
  const order = (list: Candidate[]) =>
    mode === "similar"
      ? list
          .map((c) => ({ c, d: distance(answer, c) + random() * 0.75 }))
          .sort((x, y) => x.d - y.d)
          .map((x) => x.c)
      : shuffle(list, random);

  const others = pool.filter((c) => c.id !== answer.id);
  const preferred = others.filter((c) => !inThisGame.has(c.id));
  const fallback = others.filter((c) => inThisGame.has(c.id));
  const seen = new Set([label(answer)]);
  const out: Candidate[] = [];
  for (const c of [...order(preferred), ...order(fallback)]) {
    const l = label(c);
    if (seen.has(l)) continue; // the same song uploaded twice would look like two right answers
    seen.add(l);
    out.push(c);
    if (out.length === 3) break;
  }
  return out;
}
