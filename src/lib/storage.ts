import "server-only";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";

/**
 * Where song files and clips live. On Railway this is the service's volume
 * (RAILWAY_VOLUME_MOUNT_PATH, set automatically when a volume is attached);
 * locally it's ./data. DATA_DIR overrides both.
 */
export function dataDir(): string {
  return (
    process.env.DATA_DIR?.trim() ||
    process.env.RAILWAY_VOLUME_MOUNT_PATH?.trim() ||
    path.join(process.cwd(), "data")
  );
}

export type Folder = "songs" | "clips" | "custom-clips" | "tmp";

/** Absolute path of a file in one of the data folders. Rejects anything that isn't a plain file name. */
export function filePath(folder: Folder, fileName: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName) || fileName.startsWith(".")) {
    throw new Error(`Bad file name: ${fileName}`);
  }
  // Runtime data folder, not part of the build: tell Turbopack not to trace it.
  return path.join(/*turbopackIgnore: true*/ dataDir(), folder, fileName);
}

export async function ensureFolder(folder: Folder): Promise<string> {
  const dir = path.join(/*turbopackIgnore: true*/ dataDir(), folder);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function moveFile(from: string, toFolder: Folder, toName: string): Promise<string> {
  await ensureFolder(toFolder);
  const to = filePath(toFolder, toName);
  await rename(from, to);
  return to;
}

export async function removeFile(folder: Folder, fileName: string | null | undefined): Promise<void> {
  if (!fileName) return;
  await rm(filePath(folder, fileName), { force: true });
}

/**
 * Serve an audio file with HTTP range support. iPhone Safari won't play
 * <audio> from a server that ignores Range requests.
 */
export async function serveFile(
  request: Request,
  absPath: string,
  contentType: string,
  opts: { cacheSeconds?: number; downloadName?: string } = {},
): Promise<Response> {
  let size: number;
  try {
    size = (await stat(absPath)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    // Private: these files are only for the logged-in player who asked.
    "Cache-Control": `private, max-age=${opts.cacheSeconds ?? 0}`,
  });
  if (opts.downloadName) {
    headers.set("Content-Disposition", `inline; filename="${opts.downloadName.replace(/"/g, "")}"`);
  }

  const range = request.headers.get("range");
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    let start: number;
    let end: number;
    if (match[1] === "") {
      // "bytes=-500": the last 500 bytes
      start = Math.max(0, size - Number(match[2]));
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    }
    if (start >= size || start > end) {
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    if (request.method === "HEAD") return new Response(null, { status: 206, headers });
    const stream = Readable.toWeb(createReadStream(absPath, { start, end })) as ReadableStream;
    return new Response(stream, { status: 206, headers });
  }

  headers.set("Content-Length", String(size));
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  const stream = Readable.toWeb(createReadStream(absPath)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
