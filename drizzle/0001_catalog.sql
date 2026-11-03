CREATE TABLE "songs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"artist" text NOT NULL,
	"album" text,
	"year" integer,
	"genre" text,
	"artwork_url" text,
	"apple_music_url" text,
	"spotify_url" text,
	"lookup_status" text DEFAULT 'pending' NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"duration_sec" real NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"original_file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"waveform" jsonb NOT NULL,
	"clip_mode" text DEFAULT 'surprise' NOT NULL,
	"clip_spots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"clip_length_sec" integer,
	"custom_clip_file" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "songs_file_hash_unique" UNIQUE("file_hash")
);
--> statement-breakpoint
CREATE INDEX "songs_lookup_status_idx" ON "songs" USING btree ("lookup_status");