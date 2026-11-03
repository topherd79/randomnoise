import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";

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
