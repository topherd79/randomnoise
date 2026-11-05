import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { songs, type Song } from "@/db/schema";
import { convertToMp3, keepAsIs, probe, waveform } from "./audio";
import { findSpotifyLink, lookupSong } from "./lookup";
import { ensureFolder, filePath, moveFile } from "./storage";

export type IngestResult =
  | { ok: true; song: Pick<Song, "id" | "title" | "artist" | "needsReview"> }
  | { ok: false; error: string };

/**
 * Guess title and artist from a file name like "03 - The Killers - Mr. Brightside.mp3"
 * when the file has no tags.
 */
export function guessFromFileName(name: string): { title: string; artist?: string } {
  const base = name
    .replace(/\.[^.]+$/, "")
    .replace(/^\s*\d{1,3}\s*[-._)]\s*/, "")
    .replace(/_/g, " ")
    .trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  return { title: base || "Untitled" };
}

/**
 * Turn an uploaded file (already saved at tmpPath) into a catalog song:
 * read its tags, convert it if it isn't MP3/AAC, draw its sound wave and store it.
 * The details lookup (artwork, year, links) runs separately, one song at a time.
 */
export async function ingestUpload(opts: {
  tmpPath: string;
  originalName: string;
  hash: string;
  sizeBytes: number;
}): Promise<IngestResult> {
  const { tmpPath, originalName, hash, sizeBytes } = opts;
  const cleanup: string[] = [tmpPath];
  try {
    const [existing] = await db
      .select({ title: songs.title, artist: songs.artist })
      .from(songs)
      .where(eq(songs.fileHash, hash))
      .limit(1);
    if (existing) return { ok: false, error: `Already in the catalog as “${existing.title}” by ${existing.artist}.` };

    if (/\.m4p$/i.test(originalName)) {
      return { ok: false, error: "This is a copy-protected Apple Music file, which can't be played outside Apple's apps." };
    }
    const info = await probe(tmpPath);
    if (!info) {
      return { ok: false, error: "This doesn't look like an audio file we can read (or it's copy-protected)." };
    }

    const id = randomUUID();
    const keep = keepAsIs(info);
    let fileName: string;
    let mimeType: string;
    await ensureFolder("songs");
    if (keep) {
      fileName = `${id}.${keep.ext}`;
      mimeType = keep.mimeType;
      await moveFile(tmpPath, "songs", fileName);
    } else {
      fileName = `${id}.mp3`;
      mimeType = "audio/mpeg";
      await convertToMp3(tmpPath, filePath("songs", fileName));
    }
    const stored = filePath("songs", fileName);
    cleanup.push(stored);

    const wave = await waveform(stored);
    const guess = guessFromFileName(originalName);
    const title = info.tags.title ?? guess.title;
    const artist = info.tags.artist ?? guess.artist ?? "Unknown artist";

    const [song] = await db
      .insert(songs)
      .values({
        id,
        title,
        artist,
        album: info.tags.album ?? null,
        year: info.tags.year ?? null,
        genre: info.tags.genre ?? null,
        needsReview: !info.tags.title || !info.tags.artist,
        durationSec: info.durationSec,
        fileName,
        mimeType,
        originalFileName: originalName.slice(0, 300),
        fileHash: hash,
        sizeBytes,
        waveform: wave,
      })
      .returning({ id: songs.id, title: songs.title, artist: songs.artist, needsReview: songs.needsReview });

    cleanup.pop(); // keep the stored file
    return { ok: true, song };
  } catch (err) {
    console.error("Song upload failed", originalName, err);
    return { ok: false, error: "Something went wrong reading this file." };
  } finally {
    await Promise.all(cleanup.map((p) => rm(p, { force: true })));
  }
}

/**
 * Run the details lookup for one song and save what it found. Title and artist
 * are never changed.
 * - The automatic lookup after an upload only fills empty fields (so anything
 *   the file or the admin already set stays), except that it replaces the year
 *   with an earlier one: files often carry a remaster's or compilation's year.
 * - "Look up again" (overwrite) replaces everything the lookup found.
 */
export async function runLookup(song: Song, opts: { overwrite?: boolean } = {}): Promise<void> {
  try {
    // Re-read: the admin may have edited the song since this lookup was queued.
    const [current] = await db.select().from(songs).where(eq(songs.id, song.id)).limit(1);
    if (!current) return;
    const r = await lookupSong(current.title, current.artist);
    const pick = <T,>(found: T | undefined, existing: T | null): T | null =>
      opts.overwrite ? (found ?? existing) : (existing ?? found ?? null);
    const year =
      opts.overwrite || current.year === null
        ? (r.year ?? current.year)
        : r.year && r.year < current.year
          ? r.year
          : current.year;
    await db
      .update(songs)
      .set({
        lookupStatus: r.found ? "found" : "not_found",
        needsReview: current.needsReview || !r.found,
        album: current.album ?? r.album ?? null,
        year,
        genre: pick(r.genre, current.genre),
        artworkUrl: pick(r.artworkUrl, current.artworkUrl),
        appleMusicUrl: pick(r.appleMusicUrl, current.appleMusicUrl),
        spotifyUrl: pick(r.spotifyUrl, current.spotifyUrl),
        updatedAt: new Date(),
      })
      .where(eq(songs.id, song.id));
  } catch (err) {
    console.error("Details lookup failed", song.title, err);
    await db.update(songs).set({ lookupStatus: "error", updatedAt: new Date() }).where(eq(songs.id, song.id));
  }
}

/**
 * Fill in the exact Spotify link for a song that only has a search link, and
 * give past games that used the song the same link (only where their copy had
 * none). Never replaces a link that's already exact.
 */
export async function fillSpotifyLinkFor(songId: string): Promise<"found" | "not_found" | "skipped"> {
  const [song] = await db
    .select({ title: songs.title, artist: songs.artist, spotifyUrl: songs.spotifyUrl })
    .from(songs)
    .where(eq(songs.id, songId))
    .limit(1);
  if (!song || song.spotifyUrl) return "skipped";
  const url = await findSpotifyLink(song.title, song.artist);
  if (!url) return "not_found";
  await db
    .update(songs)
    .set({ spotifyUrl: url, updatedAt: new Date() })
    .where(and(eq(songs.id, songId), isNull(songs.spotifyUrl)));
  await db.execute(sql`
    update game_songs set song = jsonb_set(song, '{spotifyUrl}', to_jsonb(${url}::text))
    where song_id = ${songId} and song->>'spotifyUrl' is null`);
  return "found";
}
