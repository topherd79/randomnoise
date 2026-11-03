import { eq } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { adminForRoute } from "@/lib/auth";
import { filePath, serveFile } from "@/lib/storage";

/** The full song, for previewing clip spots on the admin's song page. */
async function handle(request: Request, ctx: RouteContext<"/api/admin/songs/[id]/audio">) {
  const admin = await adminForRoute();
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });

  const [song] = await db
    .select({ fileName: songs.fileName, mimeType: songs.mimeType })
    .from(songs)
    .where(eq(songs.id, id))
    .limit(1);
  if (!song) return new Response("Not found", { status: 404 });
  return serveFile(request, filePath("songs", song.fileName), song.mimeType);
}

export const GET = handle;
export const HEAD = handle;
