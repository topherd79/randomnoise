// Applies any new SQL migrations in drizzle/ to DATABASE_URL, then exits.
// Runs before the app starts on every deploy (see "start" in package.json).
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set; can't run migrations.");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  console.log("Migrations up to date.");
} finally {
  await pool.end();
}
