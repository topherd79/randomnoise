import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { gameSongs, songs } from "@/db/schema";

/**
 * Songs that count as used: drawn into any game, except songs from a
 * cancelled game that nobody had played yet (those go back in the pool).
 */
export const usedSongIdsSql = sql`(
  select gs.song_id from game_songs gs
  join games g on g.id = gs.game_id
  where g.status <> 'cancelled'
     or gs.completed_at is not null
     or exists (select 1 from answers a where a.game_song_id = gs.id)
)`;

/** Whether a song has been drawn into any game (such songs can't be deleted). */
export async function songDrawnIntoGame(songId: string): Promise<boolean> {
  const [row] = await db.select({ id: gameSongs.id }).from(gameSongs).where(eq(gameSongs.songId, songId)).limit(1);
  return Boolean(row);
}

/**
 * Songs in the catalog, how many are active (inactive songs are left out of new
 * games), and how many active songs no game has used yet.
 */
export async function catalogCounts(): Promise<{ total: number; active: number; unplayed: number }> {
  const [[{ total }], [{ active }], [{ unplayed }]] = await Promise.all([
    db.select({ total: count() }).from(songs),
    db.select({ active: count() }).from(songs).where(eq(songs.active, true)),
    db
      .select({ unplayed: count() })
      .from(songs)
      .where(and(eq(songs.active, true), sql`${songs.id} not in ${usedSongIdsSql}`)),
  ]);
  return { total, active, unplayed };
}
