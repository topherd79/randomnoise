ALTER TABLE "game_players" ADD COLUMN "turn_order" integer;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "joined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "turn_starts_at" timestamp with time zone;