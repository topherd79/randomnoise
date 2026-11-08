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
