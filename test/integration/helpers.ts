// Shared setup for tests that use the real database and real audio files.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { songs, users } from "@/db/schema";

export const dataDir = process.env.DATA_DIR!;
export const clipPath = (file: string) => path.join(dataDir, "clips", file);
export const clipExists = (file: string) => existsSync(clipPath(file));

/** One real 60-second mp3, generated once and copied for every test song. */
function templateMp3(): string {
  const file = path.join(dataDir, "template.mp3");
  if (!existsSync(file) || statSync(file).size === 0) {
    mkdirSync(dataDir, { recursive: true });
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=60",
      "-c:a", "libmp3lame", "-b:a", "96k", file,
    ]);
  }
  return file;
}

/** Empty every table and the clip/song folders. */
export async function resetAll(): Promise<void> {
  await db.execute(
    sql`truncate table answers, nudges, game_songs, game_players, games, sessions, login_tokens, songs, users restart identity cascade`,
  );
  for (const folder of ["clips", "songs", "custom-clips"]) rmSync(path.join(dataDir, folder), { recursive: true, force: true });
}

export async function addUser(name: string): Promise<string> {
  const [u] = await db.insert(users).values({ name, email: `${name.toLowerCase()}@example.com` }).returning({ id: users.id });
  return u.id;
}

type SongInput = { title: string; artist: string; year?: number | null; genre?: string | null; album?: string | null; active?: boolean };

/** A catalog song with a real audio file on disk. */
export async function addSong(input: SongInput): Promise<string> {
  const id = randomUUID();
  const fileName = `${id}.mp3`;
  mkdirSync(path.join(dataDir, "songs"), { recursive: true });
  copyFileSync(templateMp3(), path.join(dataDir, "songs", fileName));
  await db.insert(songs).values({
    id,
    title: input.title,
    artist: input.artist,
    album: input.album ?? null,
    year: input.year ?? 2000,
    genre: input.genre ?? "Rock",
    artworkUrl: null,
    appleMusicUrl: null,
    spotifyUrl: null,
    lookupStatus: "found",
    durationSec: 60,
    fileName,
    mimeType: "audio/mpeg",
    originalFileName: `${input.artist} - ${input.title}.mp3`,
    fileHash: id,
    sizeBytes: 1,
    waveform: Array.from({ length: 600 }, () => 50),
    active: input.active ?? true,
  });
  return id;
}

/** n songs by n different artists. */
export async function addVariedSongs(n: number, prefix = "Artist"): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await addSong({ title: `${prefix} song ${i}`, artist: `${prefix} ${i}` }));
  return ids;
}
