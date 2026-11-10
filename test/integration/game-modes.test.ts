// The three game modes end to end: The OG (one song at a time), 3 songs (three
// at a time) and All songs (every song open from the start).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(Promise.resolve().then(fn)) }));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { answers, gameSongs, games, users } from "@/db/schema";
import { afterPlayerRemoved, answerSong, cancelGame, createGame, mayPlayClip, nudge, resetAttempt, startSong } from "@/lib/games";
import { loadGameView, myGames } from "@/lib/game-view";
import { gameProgress } from "@/lib/admin-games";
import { catalogExport } from "@/lib/catalog-queries";
import { NO_FILTERS } from "@/lib/song-filters";
import { addUser, addVariedSongs, clipExists, resetAll } from "./helpers";

const base = { clipLengthSec: 10, wrongAnswers: "random" as const, filters: NO_FILTERS };

async function songAt(gameId: string, position: number) {
  const [gs] = await db
    .select()
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, position)));
  return gs;
}

/** One player plays one song: Play, then a right or wrong pick. */
async function play(userId: string, gameId: string, position: number, right = true) {
  const gs = await songAt(gameId, position);
  const started = await startSong(userId, gs.id);
  if (!started.ok) return started;
  const wrong = gs.choices.find((c) => c.songId !== gs.songId)!.songId;
  return answerSong(userId, gs.id, right ? gs.songId : wrong);
}

async function gameRow(gameId: string) {
  const [g] = await db.select().from(games).where(eq(games.id, gameId));
  return g;
}

let logs: string[] = [];
beforeEach(async () => {
  await resetAll();
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args) => void logs.push(args.join(" ")));
});
afterEach(async () => {
  await Promise.all(afterTasks.splice(0));
  vi.restoreAllMocks();
});

const emailSubjects = () => logs.filter((l) => l.includes("[email]")).map((l) => l.match(/Subject: (.*)/)?.[1]);

describe("3 songs mode", () => {
  it("only offers 6, 9, 15 or 18 songs", async () => {
    const me = await addUser("Topher");
    await addVariedSongs(12);
    const r = await createGame({ ...base, mode: "three", playerIds: [me], songCount: 5, createdBy: me });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/6, 9, 15, 18/) });
  });

  it("plays three songs at a time, shows picks to players who've answered, and moves on when everyone's done", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(10);
    const r = await createGame({ ...base, mode: "three", playerIds: [mike, sarah], songCount: 6, createdBy: mike });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await Promise.all(afterTasks.splice(0));
    expect(emailSubjects()).toEqual(["Game on: 6 songs, three at a time", "Game on: 6 songs, three at a time"]);
    logs = [];

    // Mike plays songs 1–3 without waiting for Sarah...
    for (const p of [1, 2, 3]) expect((await play(mike, r.gameId, p)).ok).toBe(true);
    // ...but song 4 stays shut until she's played them too.
    expect(await play(mike, r.gameId, 4)).toMatchObject({ ok: false });

    const mikeView = (await loadGameView(r.gameId, mike))!;
    expect(mikeView.label).toBe("Songs 1–3 of 6");
    expect(mikeView.next).toBeNull();
    expect(mikeView.waitingOn).toEqual([{ userId: sarah, name: "Sarah", left: 3 }]);
    expect(mikeView.latest?.position).toBe(3);
    expect(mikeView.latest?.picks.find((p) => p.userId === sarah)).toMatchObject({ pending: true, label: null });
    expect(mikeView.songs.map((e) => e.position)).toEqual([3, 2, 1]);
    expect(mikeView.completedCount).toBe(0);

    // Sarah sees nothing about songs she hasn't answered, and plays in order.
    let sarahView = (await loadGameView(r.gameId, sarah))!;
    expect(sarahView.next?.position).toBe(1);
    expect(sarahView.latest).toBeNull();
    expect(sarahView.songs).toEqual([]);
    expect(JSON.stringify(sarahView)).not.toContain(mikeView.latest!.song.title);
    expect(await play(sarah, r.gameId, 2)).toMatchObject({ ok: false });

    // Once she answers song 1, it's complete: its clip goes, and Mike sees her pick.
    const song1 = await songAt(r.gameId, 1);
    expect((await play(sarah, r.gameId, 1, false)).ok).toBe(true);
    expect(clipExists(song1.clipFile)).toBe(false);
    const mikeAgain = (await loadGameView(r.gameId, mike))!;
    const sarahOnSong1 = mikeAgain.songs.find((e) => e.position === 1)!.picks.find((p) => p.userId === sarah)!;
    expect(sarahOnSong1.pending).toBeFalsy();
    expect(sarahOnSong1.correct).toBe(false);
    expect(mikeAgain.completedCount).toBe(1);
    expect(mikeAgain.standings[0]).toMatchObject({ name: "Mike", played: 3 });
    expect(mikeAgain.standings[1]).toMatchObject({ name: "Sarah", played: 1 });

    sarahView = (await loadGameView(r.gameId, sarah))!;
    expect(sarahView.next?.position).toBe(2);
    expect(sarahView.latest?.picks.find((p) => p.userId === mike)?.correct).toBe(true);

    // Sarah finishes the round: songs 4–6 open for both.
    for (const p of [2, 3]) expect((await play(sarah, r.gameId, p)).ok).toBe(true);
    expect((await gameRow(r.gameId)).currentPosition).toBe(4);
    expect((await loadGameView(r.gameId, mike))!.next?.position).toBe(4);
    expect((await loadGameView(r.gameId, sarah))!.next?.position).toBe(4);
    expect((await loadGameView(r.gameId, sarah))!.label).toBe("Songs 4–6 of 6");

    for (const p of [4, 5, 6]) {
      expect((await play(sarah, r.gameId, p)).ok).toBe(true);
      expect((await play(mike, r.gameId, p)).ok).toBe(true);
    }
    expect((await gameRow(r.gameId)).status).toBe("finished");
    await Promise.all(afterTasks.splice(0));
    expect(emailSubjects()).toEqual(["Game over: Mike wins", "Game over: Mike wins"]);
  });

  it("only serves clips for songs a player has reached", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(10);
    const r = await createGame({ ...base, mode: "three", playerIds: [mike, sarah], songCount: 6, createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    const clip = async (p: number) => (await songAt(r.gameId, p)).clipFile;

    expect(await mayPlayClip(sarah, await clip(1))).toBe(true);
    expect(await mayPlayClip(sarah, await clip(2))).toBe(false); // open, but not her turn yet
    for (const p of [1, 2]) await play(mike, r.gameId, p);
    expect(await mayPlayClip(mike, await clip(2))).toBe(true);
    expect(await mayPlayClip(mike, await clip(3))).toBe(true);
    expect(await mayPlayClip(mike, await clip(4))).toBe(false); // next round
    const outsider = await addUser("Outsider");
    expect(await mayPlayClip(outsider, await clip(1))).toBe(false);
  });

  it("nudges count the songs left, once per round every few hours", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(10);
    const r = await createGame({ ...base, mode: "three", playerIds: [mike, sarah], songCount: 6, createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    await Promise.all(afterTasks.splice(0));
    logs = [];
    for (const p of [1, 2, 3]) await play(mike, r.gameId, p);

    expect(await nudge(mike, r.gameId, sarah)).toMatchObject({ ok: true });
    await Promise.all(afterTasks.splice(0));
    expect(logs.join("\n")).toMatch(/once you've played 3 more songs, starting with song 1/);
    expect(await nudge(mike, r.gameId, sarah)).toMatchObject({ ok: false, error: expect.stringMatching(/recently/) });
    expect(await nudge(sarah, r.gameId, mike)).toMatchObject({ ok: false, error: expect.stringMatching(/already played/) });
  });

  it("a reset sends the player back to that song, and clears a later song they'd started", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(10);
    const r = await createGame({ ...base, mode: "three", playerIds: [mike, sarah], songCount: 6, createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    for (const p of [1, 2]) await play(mike, r.gameId, p);
    const song3 = await songAt(r.gameId, 3);
    expect((await startSong(mike, song3.id)).ok).toBe(true); // tapped Play on song 3, then the phone rang

    let progress = (await gameProgress(r.gameId))!;
    const mikeState = progress.players.find((p) => p.userId === mike)!;
    expect(mikeState).toMatchObject({ state: "playing", nextPosition: 3, left: 1, resetGameSongId: song3.id });
    expect(progress.label).toBe("Songs 1–3 of 6");

    const song2 = await songAt(r.gameId, 2);
    expect((await resetAttempt(song2.id, mike)).ok).toBe(true);
    progress = (await gameProgress(r.gameId))!;
    expect(progress.players.find((p) => p.userId === mike)).toMatchObject({ state: "waiting", nextPosition: 2, left: 2 });
    // Song 3's clock was cleared too: playing it later starts fresh.
    expect((await play(mike, r.gameId, 2)).ok).toBe(true);
    const again = await startSong(mike, song3.id);
    expect(again.ok && Date.now() - again.startedAt < 5000).toBe(true);
  });
});

describe("All songs mode", () => {
  it("every song is open from the start; the game ends when the last player finishes", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(8);
    const r = await createGame({ ...base, mode: "all", playerIds: [mike, sarah], songCount: 5, createdBy: mike });
    if (!r.ok) throw new Error(r.error);

    for (let p = 1; p <= 5; p++) expect((await play(mike, r.gameId, p)).ok).toBe(true);
    expect((await gameRow(r.gameId)).status).toBe("active");
    const mikeView = (await loadGameView(r.gameId, mike))!;
    expect(mikeView.label).toBe("All 5 songs");
    expect(mikeView.next).toBeNull();
    expect(mikeView.waitingOn).toEqual([{ userId: sarah, name: "Sarah", left: 5 }]);
    expect(mikeView.waitingNote).toMatch(/every song/);
    // Mike's full score shows while Sarah is still playing: every song he's answered counts.
    const mikePoints = (await db.select({ points: answers.points }).from(answers).where(eq(answers.userId, mike))).reduce(
      (sum, a) => sum + (a.points ?? 0),
      0,
    );
    expect(mikePoints).toBeGreaterThan(0);
    expect(mikeView.standings.find((s) => s.userId === mike)).toMatchObject({ points: mikePoints, played: 5, correct: 5 });
    expect(mikeView.standings.find((s) => s.userId === sarah)).toMatchObject({ points: 0, played: 0 });

    const home = await myGames(sarah);
    expect(home.active[0]).toMatchObject({ myTurn: true, nextPosition: 1, label: "All 5 songs", waitingOn: [] });
    const mikeHome = await myGames(mike);
    expect(mikeHome.active[0]).toMatchObject({ myTurn: false, waitingOn: [{ name: "Sarah", left: 5 }] });

    for (let p = 1; p <= 4; p++) await play(sarah, r.gameId, p);
    expect((await gameRow(r.gameId)).status).toBe("active");
    await play(sarah, r.gameId, 5);
    expect((await gameRow(r.gameId)).status).toBe("finished");
  });

  it("removing the player everyone's waiting on finishes the game", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(8);
    const r = await createGame({ ...base, mode: "all", playerIds: [mike, sarah], songCount: 5, createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    for (let p = 1; p <= 5; p++) await play(mike, r.gameId, p);
    await play(sarah, r.gameId, 1);

    await db.delete(users).where(eq(users.id, sarah));
    await afterPlayerRemoved([r.gameId]);
    expect((await gameRow(r.gameId)).status).toBe("finished");
  });
});

describe("The OG", () => {
  it("is the default, and stays one song at a time", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(8);
    const r = await createGame({ ...base, playerIds: [mike, sarah], songCount: 5, createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    expect((await gameRow(r.gameId)).mode).toBe("og");

    expect((await play(mike, r.gameId, 1)).ok).toBe(true);
    expect(await play(mike, r.gameId, 2)).toMatchObject({ ok: false });
    // Mike sees his result for song 1 straight away, with Sarah still to play.
    const view = (await loadGameView(r.gameId, mike))!;
    expect(view.label).toBe("Song 1 of 5");
    expect(view.latest?.picks.find((p) => p.userId === sarah)?.pending).toBe(true);
    expect(view.waitingOn.map((w) => w.name)).toEqual(["Sarah"]);
  });
});

describe("catalog download", () => {
  it("counts plays from finished and ended games only, never a game in progress", async () => {
    const mike = await addUser("Mike");
    await addVariedSongs(8);
    const r = await createGame({ ...base, playerIds: [mike], songCount: 5, createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    await play(mike, r.gameId, 1); // song 1 is complete, but the game is still on
    const song1 = await songAt(r.gameId, 1);
    const titleOf = async () => (await catalogExport()).find((s) => s.title === song1.song.title)!;
    expect(await titleOf()).toMatchObject({ timesPlayed: 0, lastPlayed: null });
    expect((await catalogExport()).every((s) => s.timesPlayed === 0)).toBe(true);

    await cancelGame(r.gameId); // ended early: song 1 was heard, songs 2–5 weren't
    expect((await titleOf()).timesPlayed).toBe(1);
    expect((await titleOf()).lastPlayed).not.toBeNull();
    expect((await catalogExport()).filter((s) => s.timesPlayed > 0)).toHaveLength(1);
  });
});
