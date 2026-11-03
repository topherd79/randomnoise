import { defineConfig } from "drizzle-kit";

// `npm run db:generate` turns changes in src/db/schema.ts into a new SQL file in drizzle/.
// Migrations run automatically when the app starts (see scripts/migrate.mjs).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
