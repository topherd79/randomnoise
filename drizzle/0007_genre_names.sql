-- One name per genre (see src/lib/genres.ts, which does the same for new uploads
-- and lookups). Files tagged in French carried "Alternatif et Indé" and
-- "Électronique", so the start-a-game genre filter listed those genres twice.
-- Game history keeps the genre each song had when it was played.
UPDATE "songs" SET "genre" = 'Alternative', "updated_at" = now()
  WHERE lower("genre") IN ('alternatif et indé', 'alternative & indie', 'alternative and indie', 'alternative')
    AND "genre" <> 'Alternative';
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'Electronic', "updated_at" = now()
  WHERE lower("genre") IN ('électronique', 'electronica', 'electronic') AND "genre" <> 'Electronic';
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'Pop', "updated_at" = now() WHERE lower("genre") = 'variété internationale';
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'French Pop', "updated_at" = now() WHERE lower("genre") IN ('variété française', 'chanson française');
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'Soundtrack', "updated_at" = now() WHERE lower("genre") IN ('musique de film', 'bandes originales de films');
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'Hip-Hop/Rap', "updated_at" = now() WHERE lower("genre") = 'hip-hop/rap' AND "genre" <> 'Hip-Hop/Rap';
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'R&B/Soul', "updated_at" = now() WHERE lower("genre") = 'r&b/soul' AND "genre" <> 'R&B/Soul';
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'Classical', "updated_at" = now() WHERE lower("genre") IN ('musique classique', 'classique');
--> statement-breakpoint
UPDATE "songs" SET "genre" = 'Singer/Songwriter', "updated_at" = now() WHERE lower("genre") = 'auteur-compositeur';
