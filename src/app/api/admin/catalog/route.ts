import { adminForRoute } from "@/lib/auth";
import { catalogExport } from "@/lib/catalog-queries";
import { toCsv, type Cell } from "@/lib/csv";
import { songKey } from "@/lib/normalize";

const CLIP_MODES: Record<string, string> = { surprise: "Surprise me", start: "Start of song", spots: "Picked spots" };

/** 239.6 s → "4:00" (round first, so it never shows "3:60"). */
const mmss = (sec: number) => {
  const t = Math.round(sec);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};
const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
/** Sort artists the way the catalog page does: "The Killers" under K. */
const artistKey = (a: string) => a.trim().toLowerCase().replace(/^the\s+/, "");

/**
 * The whole catalog as a spreadsheet (admin only). Play counts cover finished
 * and ended games only, so nothing here gives away a game in progress.
 */
export async function GET() {
  const admin = await adminForRoute();
  if (admin instanceof Response) return admin;

  const rows = (await catalogExport()).sort(
    (a, b) =>
      artistKey(a.artist).localeCompare(artistKey(b.artist)) ||
      (a.album ?? "").localeCompare(b.album ?? "") ||
      a.title.localeCompare(b.title),
  );
  // Copies of one song (same title and artist): games treat them as one song.
  const copies = new Map<string, number>();
  for (const r of rows) copies.set(songKey(r.title, r.artist), (copies.get(songKey(r.title, r.artist)) ?? 0) + 1);
  const header: Cell[] = [
    "Title", "Artist", "Album", "Year", "Genre", "Switched on", "Times played (finished games)", "Last played",
    "Details lookup", "Needs review", "Spotify link (exact)", "Apple Music link", "Clip setting", "Clip spots",
    "Own clip length (s)", "Custom clip", "Length", "Added", "File name", "Copies in catalog",
  ];
  const body: Cell[][] = rows.map((r) => [
    r.title,
    r.artist,
    r.album,
    r.year,
    r.genre,
    r.active ? "yes" : "no",
    r.timesPlayed,
    day(r.lastPlayed),
    r.lookupStatus.replace("_", " "),
    r.needsReview ? "yes" : "no",
    r.spotifyUrl,
    r.appleMusicUrl,
    CLIP_MODES[r.clipMode] ?? r.clipMode,
    r.clipMode === "spots" ? r.clipSpots.map(mmss).join("; ") : null,
    r.clipLengthSec,
    r.customClipFile ? "yes" : "no",
    mmss(r.durationSec),
    day(r.createdAt),
    r.originalFileName,
    copies.get(songKey(r.title, r.artist)) ?? 1,
  ]);

  return new Response(toCsv([header, ...body]), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="random-noise-catalog-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
