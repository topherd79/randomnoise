import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Everyone who can log in. The admin is a regular player too (matched by ADMIN_EMAIL). */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Always stored trimmed and lowercased. */
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Magic-link tokens. Only a SHA-256 hash is stored. Tokens never expire with time;
 * they are used up when the player taps "Log in" on the page the link opens
 * (opening the link alone does nothing, so email scanners and iMessage previews
 * can't burn it).
 */
export const loginTokens = pgTable(
  "login_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [index("login_tokens_user_idx").on(t.userId)],
);

/** Logged-in sessions (cookie holds the raw token, the table holds its hash). */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export type User = typeof users.$inferSelect;

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * How a song's clip is chosen when a game is created:
 * - surprise: a random spot, avoiding the very start, the end and quiet parts (default)
 * - start: from 0:00
 * - spots: one of the spots the admin marked on the sound wave, picked at random
 */
export type ClipMode = "surprise" | "start" | "spots";

/** "pending" until the automatic details lookup has run. */
export type LookupStatus = "pending" | "found" | "not_found" | "error";

/** One row per song file in the running catalog. Files live on the data volume (see src/lib/storage.ts). */
export const songs = pgTable(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    album: text("album"),
    year: integer("year"),
    genre: text("genre"),
    artworkUrl: text("artwork_url"),
    /** Exact links when the lookup found them; pages fall back to a search link otherwise. */
    appleMusicUrl: text("apple_music_url"),
    spotifyUrl: text("spotify_url"),
    lookupStatus: text("lookup_status").$type<LookupStatus>().notNull().default("pending"),
    /** True when the details may be wrong (no tags in the file, or the lookup found nothing). */
    needsReview: boolean("needs_review").notNull().default(false),

    durationSec: real("duration_sec").notNull(),
    /** File name inside the songs folder, e.g. "<uuid>.mp3". */
    fileName: text("file_name").notNull(),
    /** Content-Type the file is served with: audio/mpeg or audio/mp4. */
    mimeType: text("mime_type").notNull(),
    originalFileName: text("original_file_name").notNull(),
    /** SHA-256 of the uploaded file, so the same file can't be added twice. */
    fileHash: text("file_hash").notNull().unique(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Loudness of the song in evenly spaced slices, 0–100, for the sound-wave picture. */
    waveform: jsonb("waveform").$type<number[]>().notNull(),

    clipMode: text("clip_mode").$type<ClipMode>().notNull().default("surprise"),
    /** Start times in seconds, used when clipMode is "spots". */
    clipSpots: jsonb("clip_spots").$type<number[]>().notNull().default([]),
    /** Overrides the game's clip length for this song (seconds). */
    clipLengthSec: integer("clip_length_sec"),
    /** Admin-uploaded clip used instead of cutting one (file name inside the custom-clips folder). */
    customClipFile: text("custom_clip_file"),

    /**
     * Inactive songs stay in the catalog but new games leave them out entirely:
     * they're never drawn and never used as a wrong answer. Games already
     * created keep the songs and choices they were made with.
     */
    active: boolean("active").notNull().default(true),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("songs_lookup_status_idx").on(t.lookupStatus)],
);

export type Song = typeof songs.$inferSelect;

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameStatus = "active" | "finished" | "cancelled";

/** How the three wrong answers for each song are picked. */
export type WrongAnswerMode = "random" | "similar";

/** One answer choice, frozen when the game is created ("Title – Artist" never changes mid-game). */
export type Choice = { songId: string; title: string; artist: string };

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").$type<GameStatus>().notNull().default("active"),
  songCount: integer("song_count").notNull(),
  clipLengthSec: integer("clip_length_sec").notNull(),
  wrongAnswers: text("wrong_answers").$type<WrongAnswerMode>().notNull().default("random"),
  /** The song everyone is on now, 1-based. Moves on when every player has answered it. */
  currentPosition: integer("current_position").notNull().default(1),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const gamePlayers = pgTable(
  "game_players",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.userId] }), index("game_players_user_idx").on(t.userId)],
);

/** The songs drawn for a game, in play order, with the clip cut for each. */
export const gameSongs = pgTable(
  "game_songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    songId: uuid("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "restrict" }),
    /** Random file name in the clips folder, so the URL gives nothing away. */
    clipFile: text("clip_file").notNull(),
    clipStartSec: real("clip_start_sec").notNull(),
    clipLengthSec: real("clip_length_sec").notNull(),
    /** The right answer plus three wrong ones (each player sees them in their own order). */
    choices: jsonb("choices").$type<Choice[]>().notNull(),
    /** Set when the last player answers; then everyone sees the results. */
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("game_songs_game_position_idx").on(t.gameId, t.position),
    uniqueIndex("game_songs_clip_file_idx").on(t.clipFile),
    index("game_songs_song_idx").on(t.songId),
  ],
);

/**
 * One player's go at one song. The server keeps the clock: startedAt is when
 * they tapped Play (the clip started), answeredAt when their pick arrived.
 */
export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameSongId: uuid("game_song_id")
      .notNull()
      .references(() => gameSongs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    choiceSongId: uuid("choice_song_id"),
    correct: boolean("correct"),
    elapsedMs: integer("elapsed_ms"),
    points: integer("points"),
  },
  (t) => [uniqueIndex("answers_game_song_user_idx").on(t.gameSongId, t.userId), index("answers_user_idx").on(t.userId)],
);

/** "Nudge" emails, kept so one player can't flood another. */
export const nudges = pgTable(
  "nudges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameSongId: uuid("game_song_id")
      .notNull()
      .references(() => gameSongs.id, { onDelete: "cascade" }),
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("nudges_game_song_idx").on(t.gameSongId)],
);

export type Game = typeof games.$inferSelect;
export type GameSong = typeof gameSongs.$inferSelect;
export type Answer = typeof answers.$inferSelect;
