// Loose text matching for titles, artists and genres ("The Beatles", "Beatles";
// "Song (2011 Remaster)", "Song"). Pure: no server-only imports, so it can be
// unit tested and used from anywhere.

/** Lowercase, no accents, no "(Remastered)" / "feat. X" / leading "The", only letters and digits. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]/g, " ")
    .replace(/\s+-\s+.*(remaster|live|version|mix|edit|mono|stereo|single|demo).*$/i, " ")
    .replace(/\b(feat|ft|featuring)\.?\s.*$/, " ")
    .replace(/&/g, " and ")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * One key per song, whichever copy or version of the file it is: "Wonderwall
 * (Remastered) – Oasis" and "Wonderwall – Oasis" are the same song to a player.
 * Games treat copies with the same key as one song.
 */
export function songKey(title: string, artist: string): string {
  return `${normalize(title)}|${normalize(artist)}`;
}

// Labels that say which release a recording comes from, not which song it is.
const RELEASE_NOISE = /\b(re-?master(ed)?|album version|lp version|single version|radio edit|mono|stereo|bonus track|explicit|clean version|feat\.?|ft\.|featuring)\b/i;

/**
 * A title without release labels, for the answer choices: "1979 (Remastered
 * 2012)" → "1979", "Get Lucky (feat. Pharrell Williams)" → "Get Lucky". Labels
 * that matter to the guess stay: "(Live at KCRW)", "(Acoustic)", "(Taylor's Version)".
 */
export function cleanTitle(title: string): string {
  // Innermost brackets first, again until nothing changes: "(Album Version (Explicit))".
  let out = title;
  for (let before = ""; before !== out; ) {
    before = out;
    out = out.replace(/\s*[([]([^()[\]]*)[)\]]/g, (whole, inner: string) => (RELEASE_NOISE.test(inner) ? "" : whole));
  }
  out = out
    .replace(/\s+-\s+(.*)$/, (whole, tail: string) => (RELEASE_NOISE.test(tail) ? "" : whole))
    .replace(/\s{2,}/g, " ")
    .trim();
  return out || title.trim();
}
