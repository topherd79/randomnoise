-- Game history becomes a true snapshot: each game song keeps a copy of the
-- song's details, and the catalog song can be deleted without breaking it.
ALTER TABLE "game_songs" DROP CONSTRAINT "game_songs_song_id_songs_id_fk";
--> statement-breakpoint
ALTER TABLE "game_songs" ADD COLUMN "song" jsonb;
--> statement-breakpoint
-- Fill the snapshot for games that already exist (every song still exists:
-- until now the foreign key stopped them being deleted).
UPDATE "game_songs" AS gs SET "song" = jsonb_build_object(
  'title', s."title",
  'artist', s."artist",
  'album', s."album",
  'year', s."year",
  'genre', s."genre",
  'artworkUrl', s."artwork_url",
  'appleMusicUrl', s."apple_music_url",
  'spotifyUrl', s."spotify_url"
) FROM "songs" AS s WHERE s."id" = gs."song_id";
--> statement-breakpoint
ALTER TABLE "game_songs" ALTER COLUMN "song" SET NOT NULL;
