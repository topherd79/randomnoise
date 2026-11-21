CREATE TABLE "play_on_votes" (
	"game_id" uuid NOT NULL,
	"round_start" integer NOT NULL,
	"target_user_id" uuid NOT NULL,
	"voter_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "play_on_votes_game_id_round_start_target_user_id_voter_user_id_pk" PRIMARY KEY("game_id","round_start","target_user_id","voter_user_id")
);
--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "out_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game_players" ADD COLUMN "out_by" text;--> statement-breakpoint
ALTER TABLE "play_on_votes" ADD CONSTRAINT "play_on_votes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_on_votes" ADD CONSTRAINT "play_on_votes_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "play_on_votes" ADD CONSTRAINT "play_on_votes_voter_user_id_users_id_fk" FOREIGN KEY ("voter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;