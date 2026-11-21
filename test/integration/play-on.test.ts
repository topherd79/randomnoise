// Playing on without the one player holding a game up: the vote, the 2-player
// case, the admin taking someone out, and how the game reads afterwards.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(Promise.resolve().then(fn)) }));

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games } from "@/db/schema";
import { answerSong, createGame, nudge, startSong } from "@/lib/games";
import { loadGameResults, loadGameView, myGames } from "@/lib/game-view";
import { loadPlayOn, takeOutOfGame, voteToPlayOn } from "@/lib/play-on-game";
import { loadProfile, pastGames } from "@/lib/profiles";
import { NO_FILTERS } from "@/lib/song-filters";
import { addUser, addVariedSongs, resetAll } from "./helpers";

const base = { clipLengthSec: 10, wrongAnswers: "random" as const, filters: NO_FILTERS };

async function songAt(gameId: string, position: number) {
  const [gs] = await db.select().from(gameSongs).where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, position)));
  return gs;
}

/** One player plays the song at this position (Play, then the right answer). */
async function play(userId: string, gameId: string, position: number) {
  const gs = await songAt(gameId, position);
  expect((await startSong(userId, gs.id)).ok).toBe(true);
  expect((await answerSong(userId, gs.id, gs.songId)).ok).toBe(true);
}

/** Pretend every answer in this game was given `hours` earlier. */
async function backdate(gameId: string, hours: number) {
  const ids = db.select({ id: gameSongs.id }).from(gameSongs).where(eq(gameSongs.gameId, gameId));
  await db
    .update(answers)
    .set({ answeredAt: sql`${answers.answeredAt} - make_interval(hours => ${hours})` })
    .where(inArray(answers.gameSongId, ids));
}

async function gameRow(gameId: string) {
  const [g] = await db.select().from(games).where(eq(games.id, gameId));
  return g;
}

async function outOf(gameId: string, userId: string) {
  const [p] = await db
    .select({ outAt: gamePlayers.outAt, outBy: gamePlayers.outBy })
    .from(gamePlayers)
    .where(and(eq(gamePlayers.gameId, gameId), eq(gamePlayers.userId, userId)));
  return p;
}

beforeEach(async () => {
  await resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(afterTasks.splice(0));
  vi.restoreAllMocks();
});

describe("playing on without a player", () => {
  it("everyone else votes, 4 hours after they finished: the player is out, crossed out, and the game goes on", async () => {
    const [mike, sarah, topher, dave] = [await addUser("Mike"), await addUser("Sarah"), await addUser("Topher"), await addUser("Dave")];
    await addVariedSongs(24);
    const r = await createGame({ ...base, mode: "three", songCount: 9, playerIds: [mike, sarah, topher, dave], createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    const g = r.gameId;
    for (const p of [1, 2, 3]) for (const u of [mike, sarah, topher, dave]) await play(u, g, p);
    for (const p of [4, 5, 6]) for (const u of [mike, sarah, topher]) await play(u, g, p);

    // Too early: the others only just finished.
    let view = (await loadPlayOn(await gameRow(g), mike))!;
    expect(view).toMatchObject({ target: { name: "Dave" }, open: false, alone: false });
    expect(await voteToPlayOn(mike, g, dave)).toMatchObject({ ok: false });
    // Dave is never told.
    expect(await loadPlayOn(await gameRow(g), dave)).toBeNull();

    await backdate(g, 5);
    expect(await voteToPlayOn(mike, g, dave)).toEqual({ ok: true });
    expect(await voteToPlayOn(mike, g, dave)).toEqual({ ok: true }); // the same vote again changes nothing
    view = (await loadPlayOn(await gameRow(g), sarah))!;
    expect(view.voters.map((v) => [v.name, v.voted])).toEqual([["Sarah", false], ["Mike", true], ["Topher", false]]);
    expect((await myGames(sarah))[0].playOn).toEqual({ text: "Mike voted to play on without Dave. Your vote?", mine: false });
    // Nobody votes against someone who isn't the one holding the game up.
    expect(await voteToPlayOn(sarah, g, topher)).toMatchObject({ ok: false });

    await voteToPlayOn(sarah, g, dave);
    expect((await outOf(g, dave)).outAt).toBeNull();
    await voteToPlayOn(topher, g, dave);
    expect(await outOf(g, dave)).toMatchObject({ outBy: "vote" });
    expect((await gameRow(g)).currentPosition).toBe(7); // songs 7–9 are open

    // Dave can't play on, isn't nudged, and the game is off his home screen.
    const s7 = await songAt(g, 7);
    expect(await startSong(dave, s7.id)).toMatchObject({ ok: false });
    expect(await nudge(mike, g, dave)).toMatchObject({ ok: false });
    expect(await myGames(dave)).toEqual([]);
    const daves = (await loadGameView(g, dave))!;
    expect(daves).toMatchObject({ iAmOut: true, next: null });

    // The others: Dave at the bottom, crossed out, his picks on songs 1–3, blank on 4–6.
    const mikes = (await loadGameView(g, mike))!;
    expect(mikes.out).toEqual([{ userId: dave, name: "Dave", by: "vote" }]);
    expect(mikes.standings.at(-1)).toMatchObject({ name: "Dave", out: true, played: 3 });
    expect(mikes.waitingOn.map((w) => w.name).sort()).toEqual(["Mike", "Sarah", "Topher"]);
    const song = (pos: number) => mikes.songs.find((s) => s.position === pos)!;
    expect(song(2).picks.at(-1)).toMatchObject({ name: "Dave", out: true, correct: true });
    expect(song(5).picks.at(-1)).toMatchObject({ name: "Dave", out: true, label: null, pending: false });

    // The rest of the game is played without him.
    for (const p of [7, 8, 9]) for (const u of [mike, sarah, topher]) await play(u, g, p);
    expect((await gameRow(g)).status).toBe("finished");
    const results = (await loadGameResults([g])).get(g)!;
    expect(results.standings.map((s) => [s.name, s.out])).toEqual(
      expect.arrayContaining([["Dave", true]]),
    );
    expect(results.standings.at(-1)!.name).toBe("Dave");
    const final = (await loadGameView(g, dave))!;
    expect(final.status).toBe("finished");
    expect(final.history.find((h) => h.position === 9)!.picks.at(-1)).toMatchObject({ name: "Dave", out: true, label: null });

    // Dave's past games: Out, after 3 songs; they count toward his numbers, not as a game played.
    const [davePast] = await pastGames(dave);
    expect(davePast).toMatchObject({ out: true, played: 3, won: false, players: 4, playersIn: 3, result: expect.stringMatching(/won|tied/) });
    expect(await loadProfile(dave)).toMatchObject({ games: 0, wins: 0, answered: 3, right: 3 });
    // The others: still a 4-player game, places among the three who stayed in.
    const [mikePast] = await pastGames(mike);
    expect(mikePast).toMatchObject({ out: false, players: 4, playersIn: 3 });
    expect(mikePast.place).toBeLessThanOrEqual(3);
    expect((await loadProfile(mike))!.games).toBe(1);
  });

  it("in a game of two, the other player decides alone after 10 hours, and finishing alone isn't a win", async () => {
    const [sarah, dave] = [await addUser("Sarah"), await addUser("Dave")];
    await addVariedSongs(12);
    const r = await createGame({ ...base, mode: "og", songCount: 5, playerIds: [sarah, dave], createdBy: sarah });
    if (!r.ok) throw new Error(r.error);
    const g = r.gameId;
    await play(sarah, g, 1);
    await backdate(g, 9);
    expect((await loadPlayOn(await gameRow(g), sarah))!.open).toBe(false);
    await backdate(g, 1);
    expect(await loadPlayOn(await gameRow(g), sarah)).toMatchObject({ open: true, alone: true });
    expect(await voteToPlayOn(sarah, g, dave)).toEqual({ ok: true });
    expect(await outOf(g, dave)).toMatchObject({ outBy: "vote" });
    expect((await gameRow(g)).currentPosition).toBe(2);
    for (const p of [2, 3, 4, 5]) await play(sarah, g, p);
    expect((await gameRow(g)).status).toBe("finished");
    const [past] = await pastGames(sarah);
    expect(past).toMatchObject({ playersIn: 1, won: false, place: 1, players: 2, result: "" });
    expect((await loadProfile(sarah))!.wins).toBe(0);
    expect((await pastGames(dave))[0]).toMatchObject({ out: true, played: 0, result: "Sarah won" });
  });

  it("a vote lapses if the player catches up, and starts over in the next round", async () => {
    const [mike, sarah, dave] = [await addUser("Mike"), await addUser("Sarah"), await addUser("Dave")];
    await addVariedSongs(12);
    const r = await createGame({ ...base, mode: "og", songCount: 5, playerIds: [mike, sarah, dave], createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    const g = r.gameId;
    await play(mike, g, 1);
    await play(sarah, g, 1);
    await backdate(g, 5);
    await voteToPlayOn(mike, g, dave);
    await play(dave, g, 1); // he catches up before Sarah votes
    expect((await outOf(g, dave)).outAt).toBeNull();
    expect((await gameRow(g)).currentPosition).toBe(2);
    await play(mike, g, 2);
    await play(sarah, g, 2);
    await backdate(g, 5);
    // A new round: Mike's vote from song 1 doesn't carry over.
    expect((await loadPlayOn(await gameRow(g), sarah))!.voters.map((v) => v.voted)).toEqual([false, false]);
  });

  it("the admin can take anyone out at any time; taking out a voter can finish a vote", async () => {
    const [mike, sarah, topher, dave] = [await addUser("Mike"), await addUser("Sarah"), await addUser("Topher"), await addUser("Dave")];
    await addVariedSongs(12);
    const r = await createGame({ ...base, mode: "og", songCount: 5, playerIds: [mike, sarah, topher, dave], createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    const g = r.gameId;
    for (const u of [mike, sarah, topher]) await play(u, g, 1);
    // Dave taps Play but never answers: taking him out drops that attempt.
    const s1 = await songAt(g, 1);
    await startSong(dave, s1.id);
    await backdate(g, 5);
    await voteToPlayOn(mike, g, dave);
    await voteToPlayOn(sarah, g, dave);
    // Topher hasn't voted; the admin takes Topher out instead, which leaves Mike and Sarah's votes complete.
    expect(await takeOutOfGame(g, topher, "admin")).toEqual({ ok: true });
    expect(await outOf(g, topher)).toMatchObject({ outBy: "admin" });
    expect(await outOf(g, dave)).toMatchObject({ outBy: "vote" });
    const daveAnswers = await db.select().from(answers).where(and(eq(answers.userId, dave), eq(answers.gameSongId, s1.id)));
    expect(daveAnswers).toEqual([]);
    expect((await gameRow(g)).currentPosition).toBe(2);
    expect(await takeOutOfGame(g, topher, "admin")).toMatchObject({ ok: false }); // already out
    expect((await loadGameView(g, mike))!.out.map((o) => [o.name, o.by]).sort()).toEqual([["Dave", "vote"], ["Topher", "admin"]]);

    // Taking out everyone left ends the game.
    await takeOutOfGame(g, mike, "admin");
    await takeOutOfGame(g, sarah, "admin");
    expect((await gameRow(g)).status).toBe("cancelled");
  });

  it("never in Pass the Aux", async () => {
    const [mike, dave] = [await addUser("Mike"), await addUser("Dave")];
    await addVariedSongs(14);
    const r = await createGame({ ...base, mode: "aux", songCount: 10, playerIds: [mike, dave], createdBy: mike });
    if (!r.ok) throw new Error(r.error);
    expect(await loadPlayOn(await gameRow(r.gameId), mike)).toBeNull();
    expect(await takeOutOfGame(r.gameId, dave, "admin")).toMatchObject({ ok: false });
  });
});
