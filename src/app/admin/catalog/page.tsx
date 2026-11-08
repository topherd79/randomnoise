import { desc } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { catalogCounts } from "@/lib/catalog-queries";
import { Uploader } from "./Uploader";
import { LookupRunner } from "./LookupRunner";
import { SpotifyLinksRunner } from "./SpotifyLinksRunner";
import { spotifyConfigured } from "@/lib/lookup";
import { SongTable, type SongRow } from "./SongTable";

export default async function CatalogPage() {
  await requireAdmin();

  const [rows, counts] = await Promise.all([
    db
      .select({
        id: songs.id,
        title: songs.title,
        artist: songs.artist,
        album: songs.album,
        year: songs.year,
        genre: songs.genre,
        artworkUrl: songs.artworkUrl,
        durationSec: songs.durationSec,
        clipMode: songs.clipMode,
        clipSpots: songs.clipSpots,
        clipLengthSec: songs.clipLengthSec,
        customClipFile: songs.customClipFile,
        lookupStatus: songs.lookupStatus,
        needsReview: songs.needsReview,
        active: songs.active,
        spotifyUrl: songs.spotifyUrl,
      })
      .from(songs)
      .orderBy(desc(songs.createdAt)),
    catalogCounts(),
  ]);

  const tableRows: SongRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
    album: r.album,
    year: r.year,
    genre: r.genre,
    artworkUrl: r.artworkUrl,
    durationSec: r.durationSec,
    clip:
      r.customClipFile
        ? "Custom clip"
        : r.clipMode === "start"
          ? "Start of song"
          : r.clipMode === "spots"
            ? `${r.clipSpots.length} ${r.clipSpots.length === 1 ? "spot" : "spots"}`
            : "Surprise me",
    clipLengthSec: r.clipLengthSec,
    lookupStatus: r.lookupStatus,
    needsReview: r.needsReview,
    active: r.active,
  }));
  const pending = rows.filter((r) => r.lookupStatus === "pending").length;
  const review = rows.filter((r) => r.needsReview).length;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Catalog</h1>
          <p className="mt-1 text-muted">
            {counts.total} {counts.total === 1 ? "song" : "songs"}
            {counts.total > counts.active && ` (${counts.total - counts.active} left out of games)`} ·{" "}
            <span className="text-ink">{counts.unplayed} not played yet</span>. New games draw from the
            switched-on songs no game has used, unless you choose to include songs from earlier games.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {review > 0 && (
            <p className="rounded-full bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger">
              {review} {review === 1 ? "song needs" : "songs need"} a look
            </p>
          )}
          {counts.total > 0 && (
            <a
              href="/api/admin/catalog"
              download
              title="Every song and its details, as a spreadsheet. Play counts include finished games only, never one in progress."
              className="rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-line"
            >
              Download catalog (CSV)
            </a>
          )}
        </div>
      </section>

      <Uploader />
      <LookupRunner pending={pending} />
      <SpotifyLinksRunner
        configured={spotifyConfigured()}
        // Only songs whose details lookup is done: the lookup itself finds Spotify links for new ones.
        ids={rows.filter((r) => !r.spotifyUrl && r.lookupStatus !== "pending").map((r) => r.id)}
      />

      {rows.length > 0 ? (
        <SongTable rows={tableRows} />
      ) : (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">
          No songs yet. Drop a folder of mp3s above to get started.
        </p>
      )}
    </div>
  );
}
