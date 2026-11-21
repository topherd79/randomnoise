// Player profiles, past games and the admin's All games list, against a real database.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(Promise.resolve().then(fn)) }));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { gameSongs, games } from "@/db/schema";
import { answerSong, cancelGame, createGame, startSong } from "@/lib/games";
import { loadProfile, maySeeProfile, pastGames, profileCard } from "@/lib/profiles";
import { overGameView } from "@/lib/game-view";
import { countGames, gameSummaries } from "@/lib/admin-games";
import { NO_FILTERS } from "@/lib/song-filters";
import { addUser, addVariedSongs, resetAll } from "./helpers";

const base = { clipLengthSec: 10, wrongAnswers: "random" as const, filters: NO_FILTERS, songCount: 5 };

async function play(userId: string, gameId: string, position: number, right = true) {
  const [gs] = await db
    .select()
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, position)));
  expect((await startSong(userId, gs.id)).ok).toBe(true);
  const wrong = gs.choices.find((c) => c.songId !== gs.songId)!.songId;
  expect((await answerSong(userId, gs.id, right ? gs.songId : wrong)).ok).toBe(true);
}

async function newGame(playerIds: string[], createdBy: string, mode: "og" | "all" = "og") {
  const r = await createGame({ ...base, playerIds, createdBy, mode });
  expect(r.ok).toBe(true);
  return r.ok ? r.gameId : "";
}

beforeEach(async () => {
  await resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(afterTasks.splice(0));
  vi.restoreAllMocks();
});

describe("profiles", () => {
  it("count finished games and the finished songs of games ended early, never a game in progress", async () => {
    const topher = await addUser("Topher");
    const mike = await addUser("Mike");
    const zed = await addUser("Zed");
    await addVariedSongs(24);

    // 1. Finished: Topher gets every song right, Mike every song wrong.
    const finished = await newGame([topher, mike], topher);
    for (let p = 1; p <= 5; p++) {
      await play(topher, finished, p, true);
      await play(mike, finished, p, false);
    }
    expect((await db.select().from(games).where(eq(games.id, finished)))[0].status).toBe("finished");

    // 2. Ended early after two songs; Topher had also answered song 3, which Mike never did.
    const ended = await newGame([topher, mike], topher);
    for (let p = 1; p <= 2; p++) {
      await play(topher, ended, p, true);
      await play(mike, ended, p, true);
    }
    await play(topher, ended, 3, true);
    await cancelGame(ended);

    // 3. Still being played (every song open): Topher's answer here must not count anywhere yet.
    const running = await newGame([topher, mike], topher, "all");
    await play(topher, running, 1, true);

    const t = (await loadProfile(topher))!;
    expect(t).toMatchObject({ name: "Topher", games: 1, wins: 1, answered: 7, right: 7 });
    expect(t.bestGuesses).toHaveLength(3);
    expect(t.bestGuesses.every((g) => g.points > 0)).toBe(true);
    // Every test song is Rock from 2000: one group, so a best and no worst.
    expect(t.genres.best).toMatchObject({ name: "Rock", songs: 7 });
    expect(t.genres.worst).toBeNull();
    expect(t.decades.best).toMatchObject({ name: "2000s", songs: 7 });

    // Past games: newest first, the game in progress left out.
    expect(t.past.map((g) => g.id)).toEqual([ended, finished]);
    expect(t.past[0]).toMatchObject({ status: "cancelled", completed: 2, songCount: 5, place: 1, won: false, result: "You led" });
    expect(t.past[1]).toMatchObject({ status: "finished", place: 1, won: true, result: "You won", others: ["Mike"] });

    const m = (await loadProfile(mike))!;
    expect(m).toMatchObject({ games: 1, wins: 0, answered: 7, right: 2 });
    expect(m.past[1]).toMatchObject({ place: 2, result: "Topher won" });
    expect(m.past[1].points).toBeLessThan(0);

    // Who may look: yourself, anyone you've played with, the admin. Not a stranger.
    expect(await maySeeProfile({ id: mike, isAdmin: false }, topher)).toBe(true);
    expect(await maySeeProfile({ id: topher, isAdmin: false }, topher)).toBe(true);
    expect(await maySeeProfile({ id: zed, isAdmin: false }, topher)).toBe(false);
    expect(await maySeeProfile({ id: zed, isAdmin: true }, topher)).toBe(true);
    expect(await pastGames(zed)).toEqual([]);
    expect(await loadProfile(zed)).toMatchObject({ games: 0, wins: 0, answered: 0, averageMs: null, bestGuesses: [] });
  });

  it("a game played alone is never a win", async () => {
    const topher = await addUser("Topher");
    await addVariedSongs(10);
    const solo = await newGame([topher], topher);
    for (let p = 1; p <= 5; p++) await play(topher, solo, p, true);
    const t = (await loadProfile(topher))!;
    expect(t).toMatchObject({ games: 1, wins: 0 });
    expect(t.past[0]).toMatchObject({ players: 1, result: "", won: false, others: [] });
  });
});

describe("inside a side panel", () => {
  it("opens a game only once it's over, and only for its players", async () => {
    const [topher, mike, zed] = [await addUser("Topher"), await addUser("Mike"), await addUser("Zed")];
    await addVariedSongs(12);
    const game = await newGame([topher, mike], topher);
    await play(topher, game, 1);
    await play(mike, game, 1, false);
    // Still being played: the panel never opens it (the game page is where it's played).
    expect(await overGameView(game, topher)).toBeNull();
    for (let p = 2; p <= 5; p++) {
      await play(topher, game, p);
      await play(mike, game, p, false);
    }
    const view = (await overGameView(game, topher))!;
    expect(view).toMatchObject({ status: "finished", songCount: 5 });
    expect(view.history.map((r) => r.position)).toEqual([5, 4, 3, 2, 1]);
    expect(view.standings.map((s) => s.name)).toEqual(["Topher", "Mike"]);
    // It travels as JSON: nothing in it that JSON would change.
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(await overGameView(game, zed)).toBeNull();
  });

  it("shows a short profile to yourself, anyone you've played with and the admin, without the list of games", async () => {
    const [topher, mike, zed] = [await addUser("Topher"), await addUser("Mike"), await addUser("Zed")];
    await addVariedSongs(12);
    const game = await newGame([topher, mike], topher);
    for (let p = 1; p <= 5; p++) {
      await play(topher, game, p);
      await play(mike, game, p, false);
    }
    const card = (await profileCard({ id: mike, isAdmin: false }, topher))!;
    expect(card).toMatchObject({ userId: topher, name: "Topher", games: 1, wins: 1, answered: 5, right: 5 });
    expect(card.bestGuesses).toHaveLength(3);
    expect(card).not.toHaveProperty("past");
    expect(await profileCard({ id: topher, isAdmin: false }, topher)).toMatchObject({ name: "Topher" });
    expect(await profileCard({ id: zed, isAdmin: false }, topher)).toBeNull();
    expect(await profileCard({ id: zed, isAdmin: true }, topher)).toMatchObject({ name: "Topher" });
  });
});

describe("admin: all games", () => {
  it("filters by status, mode and player, and pages through", async () => {
    const topher = await addUser("Topher");
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(20);

    const a = await newGame([topher, mike], topher);
    await cancelGame(a);
    const b = await newGame([topher, sarah], topher, "all");
    const c = await newGame([topher], topher);

    expect(await countGames()).toEqual({ all: 3, active: 2, finished: 0, cancelled: 1 });
    expect(await countGames({ playerId: sarah })).toEqual({ all: 1, active: 1, finished: 0, cancelled: 0 });
    expect(await countGames({ mode: "og" })).toMatchObject({ all: 2 });

    // Newest first.
    expect((await gameSummaries({ limit: 5 })).map((g) => g.id)).toEqual([c, b, a]);
    expect((await gameSummaries({ limit: 5, status: "cancelled" })).map((g) => g.id)).toEqual([a]);
    expect((await gameSummaries({ limit: 5, mode: "all" })).map((g) => g.id)).toEqual([b]);
    expect((await gameSummaries({ limit: 5, playerId: mike })).map((g) => g.id)).toEqual([a]);
    expect((await gameSummaries({ limit: 5, playerId: topher, status: "active" })).map((g) => g.id)).toEqual([c, b]);
    // Paging.
    expect((await gameSummaries({ limit: 2 })).map((g) => g.id)).toEqual([c, b]);
    expect((await gameSummaries({ limit: 2, offset: 2 })).map((g) => g.id)).toEqual([a]);
  });
});
