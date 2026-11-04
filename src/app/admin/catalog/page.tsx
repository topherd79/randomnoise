import { desc } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { catalogCounts } from "@/lib/catalog-queries";
import { Uploader } from "./Uploader";
import { LookupRunner } from "./LookupRunner";
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
            <span className="text-ink">{counts.unplayed} not played yet</span>. Each new game draws from the
            songs that are switched on and that no game has used.
          </p>
        </div>
        {review > 0 && (
          <p className="rounded-full bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger">
            {review} {review === 1 ? "song needs" : "songs need"} a look
          </p>
        )}
      </section>

      <Uploader />
      <LookupRunner pending={pending} />

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
