// One name per genre, so the start-a-game genre filter doesn't list the same
// genre twice. Files bought or tagged in another language carry their genre in
// that language ("Alternatif et Indé"); this maps the common ones to English.
// Pure, so it can be unit tested.

const key = (g: string) =>
  g
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

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
};

/** The one name a genre goes by in the catalog; unknown genres are kept as they are (trimmed). */
export function canonicalGenre(genre: string | null | undefined): string | null {
  const g = genre?.trim();
  if (!g) return null;
  return SAME_AS[key(g)] ?? g;
}
