// Creates a fresh test database and applies every migration, once per test run.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/randomnoise_test");
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing to reset "${name}": the test database's name must contain "test".`);
  }

  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: "/postgres" }).toString() });
  await admin.connect();
  await admin.query(`drop database if exists "${name}" with (force)`);
  await admin.query(`create database "${name}"`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await migrate(drizzle({ client: pool }), { migrationsFolder: "./drizzle" });
  await pool.end();
}
