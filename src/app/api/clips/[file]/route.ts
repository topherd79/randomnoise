import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { gamePlayers, gameSongs, games } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { filePath, serveFile } from "@/lib/storage";

/**
 * A game clip. Only players in that game can fetch it, and only for songs that
 * have come up (never a later song's clip). The file name is random, so the URL
 * says nothing about the song.
 */
async function handle(request: Request, ctx: RouteContext<"/api/clips/[file]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { file } = await ctx.params;
  if (!/^[0-9a-f]{32}\.mp3$/.test(file)) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({ position: gameSongs.position, current: games.currentPosition, status: games.status })
    .from(gameSongs)
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, user.id)))
    .where(eq(gameSongs.clipFile, file))
    .limit(1);
  if (!row || (row.status === "active" && row.position > row.current)) {
    return new Response("Not found", { status: 404 });
  }
  return serveFile(request, filePath("clips", file), "audio/mpeg", { cacheSeconds: 86400 });
}

export const GET = handle;
export const HEAD = handle;
