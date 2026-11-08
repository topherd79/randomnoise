import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import type { SongMeta } from "./song-filters";
import { songKey } from "./normalize";

/**
 * Which songs games have used, and when each was last drawn (ms). A song counts
 * as used once it's drawn into any game, except a cancelled game nobody had
 * played it in yet (those go back in the pool). Matched by
 * catalog id and by title + artist, so a second copy of a played song (an MP3
 * next to a FLAC, or the same song on a greatest-hits album) counts as played.
 */
export async function usedSongs() {
  const rows = await db.execute<{ song_id: string; title: string; artist: string; last: string }>(sql`
    select gs.song_id, gs.song->>'title' as title, gs.song->>'artist' as artist,
      (extract(epoch from max(g.created_at)) * 1000)::bigint::text as last
    from game_songs gs join games g on g.id = gs.game_id
    where g.status <> 'cancelled' or gs.completed_at is not null
       or exists (select 1 from answers a where a.game_song_id = gs.id)
    group by 1, 2, 3
  `);
  const byId = new Map<string, number>();
  const byKey = new Map<string, number>();
  for (const r of rows.rows) {
    const t = Number(r.last);
    const k = songKey(r.title, r.artist);
    byId.set(r.song_id, Math.max(byId.get(r.song_id) ?? 0, t));
    byKey.set(k, Math.max(byKey.get(k) ?? 0, t));
  }
  /** When this song (any copy of it) was last drawn into a game, or null if never. */
  const lastUsed = (s: { id: string; title: string; artist: string }): number | null => {
    const t = Math.max(byId.get(s.id) ?? 0, byKey.get(songKey(s.title, s.artist)) ?? 0);
    return t > 0 ? t : null;
  };
  return { lastUsed };
}

/**
 * Songs in the catalog, how many are active (inactive songs are left out of new
 * games), and how many active songs no game has used yet.
 */
export async function catalogCounts(): Promise<{ total: number; active: number; unplayed: number }> {
  const [all, { lastUsed }] = await Promise.all([
    db.select({ id: songs.id, title: songs.title, artist: songs.artist, active: songs.active }).from(songs),
    usedSongs(),
  ]);
  const on = all.filter((s) => s.active);
  // Copies of one song count once: a game can only draw one of them.
  const unplayed = new Set(on.filter((s) => lastUsed(s) === null).map((s) => songKey(s.title, s.artist)));
  return { total: all.length, active: on.length, unplayed: unplayed.size };
}

/**
 * Artist, year, genre and played-or-not for every switched-on song, for the
 * game form's filters and live counts. Deliberately no titles.
 */
export async function activeSongMeta(): Promise<SongMeta[]> {
  const [rows, { lastUsed }] = await Promise.all([
    db
      .select({ id: songs.id, title: songs.title, artist: songs.artist, year: songs.year, genre: songs.genre })
      .from(songs)
      .where(eq(songs.active, true)),
    usedSongs(),
  ]);
  // One entry per song (copies count once), so the form's counts match what a game can draw.
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    const k = songKey(r.title, r.artist);
    if (seen.has(k)) return [];
    seen.add(k);
    return [{ artist: r.artist, year: r.year, genre: r.genre, played: lastUsed(r) !== null }];
  });
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
