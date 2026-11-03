import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ensureFolder, filePath } from "./storage";

export const MAX_UPLOAD_BYTES = 400 * 1024 * 1024; // a 20-minute WAV

export type Received = { tmpPath: string; hash: string; sizeBytes: number; originalName: string };

/**
 * Stream a raw upload (the request body is the file itself; its name is in the
 * X-File-Name header) to a temp file, hashing it on the way.
 */
export async function receiveUpload(request: Request): Promise<Received | { error: string; status: number }> {
  if (!request.body) return { error: "No file was sent.", status: 400 };
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_UPLOAD_BYTES) return { error: "That file is too big (over 400 MB).", status: 413 };

  let originalName = "upload";
  try {
    originalName = decodeURIComponent(request.headers.get("x-file-name") ?? "upload") || "upload";
  } catch {}

  await ensureFolder("tmp");
  const tmpPath = filePath("tmp", `${randomUUID()}.upload`);
  const hash = createHash("sha256");
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) return cb(new Error("too big"));
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(
      Readable.fromWeb(request.body as import("node:stream/web").ReadableStream),
      meter,
      createWriteStream(tmpPath),
    );
  } catch (err) {
    await rm(tmpPath, { force: true });
    if (size > MAX_UPLOAD_BYTES) return { error: "That file is too big (over 400 MB).", status: 413 };
    console.error("Upload interrupted", err);
    return { error: "The upload was interrupted.", status: 400 };
  }
  if (size === 0) {
    await rm(tmpPath, { force: true });
    return { error: "The file is empty.", status: 400 };
  }
  return { tmpPath, hash: hash.digest("hex"), sizeBytes: size, originalName };
}
