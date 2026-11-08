// The clip clean-up that runs on every start, and live updates through Postgres NOTIFY.
import { execFileSync } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void Promise.resolve().then(fn) }));

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { gameSongs } from "@/db/schema";
import { createGame } from "@/lib/games";
import { publishGameUpdate, subscribeToGames } from "@/lib/live";
import { NO_FILTERS } from "@/lib/song-filters";
import { addUser, addVariedSongs, clipExists, clipPath, dataDir, resetAll } from "./helpers";

beforeEach(async () => {
  await resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const strayClip = (hoursOld: number) => {
  const file = `${randomBytes(16).toString("hex")}.mp3`;
  mkdirSync(path.join(dataDir, "clips"), { recursive: true });
  writeFileSync(clipPath(file), "x");
  const when = new Date(Date.now() - hoursOld * 3600_000);
  utimesSync(clipPath(file), when, when);
  return file;
};

describe("cleanup-clips.mjs", () => {
  it("keeps clips still to be played and deletes the rest", async () => {
    const me = await addUser("Topher");
    await addVariedSongs(6);
    const r = await createGame({ clipLengthSec: 10, wrongAnswers: "random", filters: NO_FILTERS, playerIds: [me], songCount: 5, createdBy: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rounds = await db.select().from(gameSongs).where(eq(gameSongs.gameId, r.gameId)).orderBy(gameSongs.position);
    // Song 1 is finished but its clip was left behind (e.g. from before clips were cleaned up).
    await db.update(gameSongs).set({ completedAt: new Date() }).where(eq(gameSongs.id, rounds[0].id));
    const oldStray = strayClip(2);
    const newStray = strayClip(0); // maybe a game being created right now: keep it

    const out = execFileSync("node", ["scripts/cleanup-clips.mjs"], { env: process.env, encoding: "utf8" });
    expect(out).toMatch(/removed 2 no longer needed/);
    expect(clipExists(rounds[0].clipFile)).toBe(false);
    expect(clipExists(oldStray)).toBe(false);
    expect(clipExists(newStray)).toBe(true);
    for (const g of rounds.slice(1)) expect(clipExists(g.clipFile)).toBe(true);
  });

  it("never stops the app from starting", () => {
    const out = execFileSync("node", ["scripts/cleanup-clips.mjs"], {
      env: { ...process.env, DATABASE_URL: "postgres://nobody@127.0.0.1:1/nothing" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toBeDefined(); // exit code 0 (execFileSync throws otherwise)
  });
});

describe("live updates", () => {
  it("delivers a game's update to pages following that game, and only that game", async () => {
    const heard: string[] = [];
    const unsubscribe = await subscribeToGames(["11111111-1111-1111-1111-111111111111"], (id) => heard.push(id));
    await publishGameUpdate("22222222-2222-2222-2222-222222222222");
    await publishGameUpdate("11111111-1111-1111-1111-111111111111");
    await vi.waitFor(() => expect(heard).toEqual(["11111111-1111-1111-1111-111111111111"]), { timeout: 5000 });
    unsubscribe();
  });
});

