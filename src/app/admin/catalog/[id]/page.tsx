import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { CLIP_LENGTHS, formatTime } from "@/lib/clips";
import { appleMusicLink, spotifyLink } from "@/lib/links";
import { Artwork } from "../SongTable";
import { DetailsForm } from "./DetailsForm";
import { ClipEditor } from "./ClipEditor";
import { CustomClipPanel } from "./CustomClipPanel";
import { DeleteSong } from "./DeleteSong";
import { ActiveSwitch } from "../ActiveSwitch";

export default async function SongPage(props: PageProps<"/admin/catalog/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [song] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) notFound();

  return (
    <div className="flex flex-col gap-10">
      <Link href="/admin/catalog" className="text-sm text-muted hover:text-ink">
        ← Catalog
      </Link>

      <header className="flex flex-wrap items-center gap-6">
        <Artwork url={song.artworkUrl} size={112} />
        <div className="min-w-0">
          <h1 className="text-3xl font-bold">{song.title}</h1>
          <p className="mt-1 text-lg text-muted">{song.artist}</p>
          <p className="mt-2 text-sm text-muted">
            {[song.album, song.year, song.genre, formatTime(song.durationSec)].filter(Boolean).join(" · ")}
          </p>
          <p className="mt-3 flex flex-wrap gap-3 text-sm">
            <a href={appleMusicLink(song)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Apple Music{song.appleMusicUrl ? "" : " (search)"}
            </a>
            <a href={spotifyLink(song)} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              Spotify{song.spotifyUrl ? "" : " (search)"}
            </a>
            <span className="text-muted">File: {song.originalFileName}</span>
          </p>
          <div className="mt-4">
            <ActiveSwitch id={song.id} active={song.active} title={song.title} withLabel />
          </div>
        </div>
      </header>

      <section className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-10">
          <div>
            <h2 className="text-xl font-bold">Clip</h2>
            <p className="mt-1 text-sm text-muted">
              Which part of the song players hear. The clip length is set when you create a game ({CLIP_LENGTHS.slice(0, -1).join(", ")} or{" "}
              {CLIP_LENGTHS.at(-1)} seconds) unless you override it here.
            </p>
            {song.customClipFile ? (
              <p className="mt-4 rounded-xl bg-surface p-4 text-sm text-muted">
                This song has a custom clip, which games use instead. Remove it to use these settings again.
              </p>
            ) : null}
            <div className={song.customClipFile ? "pointer-events-none mt-4 opacity-40" : "mt-4"}>
              <ClipEditor
                songId={song.id}
                durationSec={song.durationSec}
                waveform={song.waveform}
                initial={{ mode: song.clipMode, spots: song.clipSpots, lengthSec: song.clipLengthSec }}
              />
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold">Custom clip</h2>
            <p className="mt-1 text-sm text-muted">
              For special cases, like a live version: upload your own clip file and games will play it instead
              of cutting one from the song. Up to 30 seconds.
            </p>
            <CustomClipPanel songId={song.id} hasClip={Boolean(song.customClipFile)} version={song.updatedAt.getTime()} />
          </div>
        </div>

        <aside className="flex flex-col gap-8">
          <div>
            <h2 className="text-xl font-bold">Details</h2>
            {song.needsReview && (
              <p className="mt-2 text-sm text-danger">
                {song.lookupStatus === "not_found"
                  ? "The lookup couldn't find this title and artist. Check them, then look up again or fill in what you know."
                  : "This file had no title or artist inside, so they were guessed from the file name. Check them."}
              </p>
            )}
            <DetailsForm song={song} />
          </div>
          <DeleteSong songId={song.id} title={song.title} />
        </aside>
      </section>
    </div>
  );
}
