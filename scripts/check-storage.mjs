// Logs where song files and clips are stored and whether that folder is writable.
// Runs before the app starts (see "start" in package.json). It only warns:
// the rest of the app works without storage, uploads and games don't.
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const dir =
  process.env.DATA_DIR?.trim() || process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() || path.join(process.cwd(), "data");
const kind = process.env.DATA_DIR?.trim()
  ? "DATA_DIR"
  : process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim()
    ? "Railway volume"
    : "local folder";

try {
  await mkdir(dir, { recursive: true });
  const probe = path.join(dir, `.write-test-${process.pid}`);
  await writeFile(probe, "ok");
  await rm(probe);
  console.log(`Storage: ${dir} (${kind}, writable).`);
} catch (err) {
  console.warn(`Storage: ${dir} (${kind}) is NOT writable; uploads and games will fail.`, err.message);
}
