import "server-only";
import { and, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import type { SongMeta } from "./song-filters";

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

/**
 * Artist, year, genre and played-or-not for every switched-on song, for the
 * game form's filters and live counts. Deliberately no titles.
 */
export async function activeSongMeta(): Promise<SongMeta[]> {
  const rows = await db
    .select({
      artist: songs.artist,
      year: songs.year,
      genre: songs.genre,
      played: sql<boolean>`${songs.id} in ${usedSongIdsSql}`,
    })
    .from(songs)
    .where(eq(songs.active, true));
  return rows.map((r) => ({ ...r, played: Boolean(r.played) }));
}

/**
 * Every song with everything the catalog knows about it, for the "Download
 * catalog" spreadsheet. Play counts include finished and ended games only, so
 * the file never shows which songs a game in progress is using (the admin
 * plays too).
 */
export async function catalogExport() {
  return db
    .select({
      title: songs.title,
      artist: songs.artist,
      album: songs.album,
      year: songs.year,
      genre: songs.genre,
      active: songs.active,
      lookupStatus: songs.lookupStatus,
      needsReview: songs.needsReview,
      spotifyUrl: songs.spotifyUrl,
      appleMusicUrl: songs.appleMusicUrl,
      clipMode: songs.clipMode,
      clipSpots: songs.clipSpots,
      clipLengthSec: songs.clipLengthSec,
      customClipFile: songs.customClipFile,
      durationSec: songs.durationSec,
      createdAt: songs.createdAt,
      originalFileName: songs.originalFileName,
      timesPlayed: sql<number>`(
        select count(*)::int from game_songs gs join games g on g.id = gs.game_id
        where gs.song_id = "songs"."id" and g.status <> 'active' and gs.completed_at is not null
      )`,
      lastPlayed: sql<string | null>`(
        select max(gs.completed_at)::text from game_songs gs join games g on g.id = gs.game_id
        where gs.song_id = "songs"."id" and g.status <> 'active' and gs.completed_at is not null
      )`,
    })
    .from(songs);
}
