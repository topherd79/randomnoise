// Deletes clip files nobody will play again. Runs before the app starts (see
// "start" in package.json) and never stops the app from starting.
//
// The app deletes each clip as soon as everyone has answered its song, and all
// of a game's clips if it ends early. This sweep catches anything left behind:
// clips from before that existed, or a delete that failed.
//
// A clip is kept only while its game is active and its song isn't finished.
// Files no game refers to are deleted only once they're over an hour old, so a
// game being created right now (e.g. by the old copy of the app mid-deploy,
// which cuts clips before saving the game) never loses its clips.
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const UNREFERENCED_GRACE_MS = 60 * 60 * 1000;
const CLIP_NAME = /^[0-9a-f]{32}\.mp3$/;

const dataDir =
  process.env.DATA_DIR?.trim() || process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || path.join(process.cwd(), "data");
const clipsDir = path.join(dataDir, "clips");

async function main() {
  if (!process.env.DATABASE_URL) return console.log("Clips: no DATABASE_URL, skipping clean-up.");

  let files;
  try {
    files = (await readdir(clipsDir)).filter((f) => CLIP_NAME.test(f));
  } catch {
    return console.log("Clips: nothing to clean up yet.");
  }
  if (files.length === 0) return console.log("Clips: nothing to clean up.");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  let rows;
  try {
    ({ rows } = await pool.query(`
      select gs.clip_file, (g.status = 'active' and gs.completed_at is null) as needed
      from game_songs gs join games g on g.id = gs.game_id`));
  } finally {
    await pool.end();
  }
  const needed = new Map(rows.map((r) => [r.clip_file, r.needed]));

  let removed = 0;
  let bytes = 0;
  for (const file of files) {
    if (needed.get(file) === true) continue;
    const full = path.join(clipsDir, file);
    const info = await stat(full).catch(() => null);
    if (!info) continue;
    if (!needed.has(file) && Date.now() - info.mtimeMs < UNREFERENCED_GRACE_MS) continue;
    await rm(full, { force: true });
    removed += 1;
    bytes += info.size;
  }
  console.log(
    `Clips: removed ${removed} no longer needed (${(bytes / 1024 / 1024).toFixed(1)} MB); ${files.length - removed} kept.`,
  );
}

try {
  await main();
} catch (err) {
  console.warn("Clips: clean-up skipped:", err.message);
}
