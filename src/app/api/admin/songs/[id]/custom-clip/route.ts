import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { adminForRoute } from "@/lib/auth";
import { cutClip, probe } from "@/lib/audio";
import { ensureFolder, filePath, removeFile, serveFile } from "@/lib/storage";
import { receiveUpload } from "@/lib/uploads";

/** Longest custom clip we keep; anything longer is trimmed. */
const MAX_CUSTOM_CLIP_SEC = 30;

async function findSong(ctx: RouteContext<"/api/admin/songs/[id]/custom-clip">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const [song] = await db
    .select({ id: songs.id, customClipFile: songs.customClipFile })
    .from(songs)
    .where(eq(songs.id, id))
    .limit(1);
  return song ?? null;
}

/** Preview the custom clip. */
async function get(request: Request, ctx: RouteContext<"/api/admin/songs/[id]/custom-clip">) {
  const admin = await adminForRoute();
  if (admin instanceof Response) return admin;
  const song = await findSong(ctx);
  if (!song?.customClipFile) return new Response("Not found", { status: 404 });
  return serveFile(request, filePath("custom-clips", song.customClipFile), "audio/mpeg");
}

/**
 * Upload a custom clip for a song (for special cases, like a live version).
 * It's re-encoded with its tags removed, the same way game clips are.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/songs/[id]/custom-clip">) {
  const admin = await adminForRoute();
  if (admin instanceof Response) return admin;
  const song = await findSong(ctx);
  if (!song) return Response.json({ ok: false, error: "That song no longer exists." }, { status: 404 });

  const received = await receiveUpload(request);
  if ("error" in received) return Response.json({ ok: false, error: received.error }, { status: received.status });

  try {
    const info = await probe(received.tmpPath);
    if (!info) return Response.json({ ok: false, error: "That doesn't look like an audio file." }, { status: 422 });

    await ensureFolder("custom-clips");
    const fileName = `${song.id}-${randomBytes(6).toString("hex")}.mp3`;
    await cutClip({
      input: received.tmpPath,
      output: filePath("custom-clips", fileName),
      startSec: 0,
      lengthSec: Math.min(info.durationSec, MAX_CUSTOM_CLIP_SEC),
    });
    await db.update(songs).set({ customClipFile: fileName, updatedAt: new Date() }).where(eq(songs.id, song.id));
    await removeFile("custom-clips", song.customClipFile);
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Custom clip upload failed", err);
    return Response.json({ ok: false, error: "Something went wrong reading this file." }, { status: 500 });
  } finally {
    await rm(received.tmpPath, { force: true });
  }
}

export const GET = get;
export const HEAD = get;
