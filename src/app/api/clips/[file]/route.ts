import { getCurrentUser } from "@/lib/auth";
import { mayPlayClip } from "@/lib/games";
import { filePath, serveFile } from "@/lib/storage";

/**
 * A game clip. Only players in that game can fetch it, and only for songs they
 * have reached (never a later song's clip, even when several songs are open).
 * The file name is random, so the URL says nothing about the song.
 */
async function handle(request: Request, ctx: RouteContext<"/api/clips/[file]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { file } = await ctx.params;
  if (!/^[0-9a-f]{32}\.mp3$/.test(file)) return new Response("Not found", { status: 404 });
  if (!(await mayPlayClip(user.id, file))) return new Response("Not found", { status: 404 });
  return serveFile(request, filePath("clips", file), "audio/mpeg", { cacheSeconds: 86400 });
}

export const GET = handle;
export const HEAD = handle;
