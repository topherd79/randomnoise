// Genres: a song can have several ("Pop/Rock" is Pop and Rock), stored as one
// line, "Pop, Rock". One name per genre, so the start-a-game filter doesn't list
// the same genre twice: files bought or tagged in another language carry their
// genre in that language ("Alternatif et Indé"), mapped here to English.
// Pure, so it can be unit tested.

const key = (g: string) =>
  g
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Whole genre names in another language or spelling, matched before splitting. */
const SAME_AS: Record<string, string> = {
  // French iTunes genre names
  "alternatif et inde": "Alternative",
  electronique: "Electronic",
  "variete internationale": "Pop",
  "variete francaise": "French Pop",
  "musique de film": "Soundtrack",
  "bandes originales de films": "Soundtrack",
  "hip hop rap": "Hip-Hop/Rap",
  "r and b soul": "R&B/Soul",
  "chanson francaise": "French Pop",
  "musique classique": "Classical",
  classique: "Classical",
  "auteur compositeur": "Singer/Songwriter",
  // English spellings of the same genres
  "alternative and indie": "Alternative",
  alternative: "Alternative",
  electronica: "Electronic",
  electronic: "Electronic",
  "hip hop": "Hip-Hop",
  "r and b": "R&B",
  rnb: "R&B",
};

/** Genre names that contain a separator but are one genre. */
const KEEP_WHOLE = ["Singer/Songwriter"];

/**
 * What separates genres in one name: a slash, comma, semicolon or bar, or a dash
 * with spaces around it ("Punk - New Wave"). Never a plain space ("Hard Rock",
 * "New Wave"), "&" ("R&B", "Drum & Bass") or a dash without spaces ("Hip-Hop",
 * "Synth-pop", "Post-punk").
 */
const SEPARATOR = /\s*[/,;|]\s*|\s+[-–—]\s+/;

const one = (g: string) => SAME_AS[key(g)] ?? g;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const KEEP = KEEP_WHOLE.map((name, i) => ({ name, re: new RegExp(escape(name).replace("/", "\\s*/\\s*"), "gi"), token: `\u0000${i}\u0000` }));

/** Every genre in a genre name, each by its one name, in order, without repeats. */
export function genreList(genre: string | null | undefined): string[] {
  const whole = genre?.trim();
  if (!whole) return [];
  // Hide names that are one genre despite a separator, split, then put them back.
  let text = one(whole);
  for (const k of KEEP) text = text.replace(k.re, k.token);
  const parts = text
    .split(SEPARATOR)
    .map((p) => KEEP.reduce((t, k) => t.replace(k.token, k.name), p).trim())
    .filter(Boolean)
    .map(one);
  const seen = new Set<string>();
  return parts.filter((p) => {
    const k = key(p);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** How a genre name is stored: its genres joined with ", " ("Pop, Rock"), or null for none. */
export function canonicalGenres(genre: string | null | undefined): string | null {
  const list = genreList(genre);
  return list.length ? list.join(", ") : null;
}
