CREATE TABLE "chat_members" (
	"chat_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_members_chat_id_user_id_pk" PRIMARY KEY("chat_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"user_id" uuid,
	"sender_name" text NOT NULL,
	"body" text NOT NULL,
	"holds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_reactions" (
	"message_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_reactions_message_id_user_id_pk" PRIMARY KEY("message_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_message_at" timestamp with time zone,
	CONSTRAINT "chats_member_key_unique" UNIQUE("member_key")
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "chat_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_members_user_idx" ON "chat_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chat_messages_chat_idx" ON "chat_messages" USING btree ("chat_id","created_at");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Every group that has already played a game together (not solo, not Pass the
-- Aux) gets its chat now. Member keys are the user ids in uuid order, which is
-- the same order as sorting their text in the app.
INSERT INTO "chats" ("member_key")
SELECT DISTINCT s.k FROM (
	SELECT string_agg(gp."user_id"::text, ',' ORDER BY gp."user_id") AS k, count(*) AS n
	FROM "game_players" gp JOIN "games" g ON g."id" = gp."game_id"
	WHERE g."mode" <> 'aux'
	GROUP BY gp."game_id"
) s WHERE s.n >= 2
ON CONFLICT ("member_key") DO NOTHING;--> statement-breakpoint
UPDATE "games" g SET "chat_id" = c."id"
FROM (
	SELECT gp."game_id", string_agg(gp."user_id"::text, ',' ORDER BY gp."user_id") AS k, count(*) AS n
	FROM "game_players" gp GROUP BY gp."game_id"
) s JOIN "chats" c ON c."member_key" = s.k
WHERE g."id" = s."game_id" AND g."mode" <> 'aux' AND s.n >= 2;--> statement-breakpoint
INSERT INTO "chat_members" ("chat_id", "user_id")
SELECT c."id", u."id" FROM "chats" c
JOIN "users" u ON u."id"::text = ANY (string_to_array(c."member_key", ','))
ON CONFLICT DO NOTHING;
