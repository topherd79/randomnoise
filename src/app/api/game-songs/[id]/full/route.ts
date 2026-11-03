import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games, songs } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { filePath, serveFile } from "@/lib/storage";

/**
 * The full song, which unlocks for a player once they've answered it (or once
 * everyone has, for a song they somehow skipped). Until then phones only ever
 * get the clip.
 */
async function handle(request: Request, ctx: RouteContext<"/api/game-songs/[id]/full">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({
      fileName: songs.fileName,
      mimeType: songs.mimeType,
      completedAt: gameSongs.completedAt,
      status: games.status,
      answeredAt: answers.answeredAt,
    })
    .from(gameSongs)
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .innerJoin(songs, eq(songs.id, gameSongs.songId))
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, user.id)))
    .leftJoin(answers, and(eq(answers.gameSongId, gameSongs.id), eq(answers.userId, user.id), isNotNull(answers.answeredAt)))
    .where(eq(gameSongs.id, id))
    .limit(1);
  const unlocked = row && (row.answeredAt || row.completedAt || row.status === "finished");
  if (!unlocked) return new Response("Not found", { status: 404 });
  return serveFile(request, filePath("songs", row.fileName), row.mimeType, { cacheSeconds: 86400 });
}

export const GET = handle;
export const HEAD = handle;
