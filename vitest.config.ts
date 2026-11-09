import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
      // Next.js normally handles this import; outside Next it would throw.
      "server-only": path.join(root, "test/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    // The database tests share one test database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:5432/randomnoise_test",
      DATA_DIR: process.env.TEST_DATA_DIR ?? path.join(os.tmpdir(), "randomnoise-test-data"),
      APP_URL: "http://localhost:3000",
      ADMIN_EMAIL: "admin@example.com",
      // Never send real email from tests (the cloud environment may have a real key).
      RESEND_API_KEY: "",
      // Tests fake Spotify themselves; never call the real one with keys from the environment.
      SPOTIFY_CLIENT_ID: "",
      SPOTIFY_CLIENT_SECRET: "",
    },
  },
});
