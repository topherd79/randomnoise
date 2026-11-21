// Pass the Aux end to end: the lobby, taking turns, time running out, and the
// end of the game, against the real database and real clips.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(Promise.resolve().then(fn)) }));

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { answers, gamePlayers, gameSongs, games } from "@/db/schema";
import { answerSong, createGame, mayPlayClip, nudge, startSong } from "@/lib/games";
import { answerAux, joinAux, loadAuxState, openLobbyFor, playAux, startAux } from "@/lib/aux-game";
import { loadGameResults, loadGameView, myGames } from "@/lib/game-view";
import { gameProgress } from "@/lib/admin-games";
import { AUX_COUNTDOWN_MS, AUX_LOBBY_WAIT_MS, AUX_RESULT_MS, turnLengthMs } from "@/lib/aux";
import { NO_FILTERS } from "@/lib/song-filters";
import { addUser, addVariedSongs, clipExists, resetAll } from "./helpers";

const base = { clipLengthSec: 20, wrongAnswers: "random" as const, filters: NO_FILTERS, mode: "aux" as const };

/** Move the clock on (only Date: timers and the database driver keep real time). */
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

async function gameRow(gameId: string) {
  const [g] = await db.select().from(games).where(eq(games.id, gameId));
  return g;
}

async function songAt(gameId: string, position: number) {
  const [gs] = await db
    .select()
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, position)));
  return gs;
}

/** The players' ids in turn order. */
async function order(gameId: string) {
  const rows = await db
    .select({ userId: gamePlayers.userId, turnOrder: gamePlayers.turnOrder })
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, gameId))
    .orderBy(asc(gamePlayers.turnOrder));
  return rows;
}

/** Everyone taps I'm in, player 1 starts, and the countdown runs out. */
async function startedGame(names: string[]) {
  const ids: string[] = [];
  for (const n of names) ids.push(await addUser(n));
  await addVariedSongs(30);
  const r = await createGame({ ...base, playerIds: ids, songCount: names.length * 5, createdBy: ids[0] });
  if (!r.ok) throw new Error(r.error);
  const turnOrder = (await order(r.gameId)).map((o) => o.userId);
  for (const id of ids) expect(await joinAux(id, r.gameId)).toEqual({ ok: true });
  expect(await startAux(turnOrder[0], r.gameId)).toEqual({ ok: true });
  advance(AUX_COUNTDOWN_MS);
  return { gameId: r.gameId, turnOrder };
}

/** The turn player's clip starts, and they pick (right or wrong) a few seconds in. */
async function takeTurn(gameId: string, userId: string, right = true, afterMs = 3000) {
  const g = await gameRow(gameId);
  const gs = await songAt(gameId, g.currentPosition);
  const played = await playAux(userId, gs.id);
  if (!played.ok) return played;
  advance(afterMs);
  const wrong = gs.choices.find((c) => c.songId !== gs.songId)!.songId;
  const r = await answerAux(userId, gs.id, right ? gs.songId : wrong);
  advance(AUX_RESULT_MS + AUX_COUNTDOWN_MS);
  return r;
}

let logs: string[] = [];
beforeEach(async () => {
  await resetAll();
  vi.useFakeTimers({ toFake: ["Date"] });
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...args) => void logs.push(args.join(" ")));
});
afterEach(async () => {
  await Promise.all(afterTasks.splice(0));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const emailSubjects = () => logs.filter((l) => l.includes("[email]")).map((l) => l.match(/Subject: (.*)/)?.[1]);

describe("making a Pass the Aux game", () => {
  it("is 5 songs a player, at least 2 players, in a random turn order", async () => {
    const [a, b, c] = [await addUser("Topher"), await addUser("Mike"), await addUser("Sarah")];
    await addVariedSongs(20);
    expect(await createGame({ ...base, playerIds: [a], songCount: 5, createdBy: a })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at least 2 players/),
    });
    expect(await createGame({ ...base, playerIds: [a, b, c], songCount: 10, createdBy: a })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/15 songs for 3 players/),
    });
    const r = await createGame({ ...base, playerIds: [a, b, c], songCount: 15, createdBy: a });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rows = await order(r.gameId);
    expect(rows.map((o) => o.turnOrder)).toEqual([1, 2, 3]);
    expect(new Set(rows.map((o) => o.userId))).toEqual(new Set([a, b, c]));
    const g = await gameRow(r.gameId);
    expect(g.turnStartsAt).toBeNull(); // the lobby is open

    // Each player's email says which player they are and opens the lobby.
    await Promise.all(afterTasks.splice(0));
    expect(emailSubjects()).toEqual(["Game on: Pass the Aux", "Game on: Pass the Aux", "Game on: Pass the Aux"]);
    expect(logs.join("\n")).toMatch(/You're player 1\./);
    expect(logs.join("\n")).toMatch(/You're player 3\./);
  });
});

describe("the lobby", () => {
  it("lets player 1 start once everyone's in", async () => {
    const ids = [await addUser("Topher"), await addUser("Mike"), await addUser("Sarah")];
    await addVariedSongs(20);
    const r = await createGame({ ...base, playerIds: ids, songCount: 15, createdBy: ids[0] });
    if (!r.ok) throw new Error(r.error);
    const [p1, p2, p3] = (await order(r.gameId)).map((o) => o.userId);

    // The home screen goes straight to the lobby.
    expect(await openLobbyFor(p2)).toBe(r.gameId);

    expect(await startAux(p1, r.gameId)).toMatchObject({ ok: false, error: "Tap I'm in first." });
    await joinAux(p1, r.gameId);
    await joinAux(p2, r.gameId);
    let s = (await loadAuxState(r.gameId, p2))!;
    expect(s.lobby).toMatchObject({ starter: p1 });
    expect(s.players.map((p) => p.joined)).toEqual([true, true, false]);
    expect(s.players.map((p) => p.order)).toEqual([1, 2, 3]);

    expect(await startAux(p2, r.gameId)).toMatchObject({ ok: false, error: expect.stringMatching(/starts the game/) });
    expect(await startAux(p1, r.gameId)).toMatchObject({ ok: false, error: expect.stringMatching(/^Waiting on /) });
    expect(await startAux(p1, r.gameId, { without: true })).toMatchObject({ ok: false, error: expect.stringMatching(/few more seconds/) });

    await joinAux(p3, r.gameId);
    const before = Date.now();
    expect(await startAux(p1, r.gameId)).toEqual({ ok: true });
    expect(await startAux(p1, r.gameId)).toEqual({ ok: true }); // a double tap does nothing more
    const g = await gameRow(r.gameId);
    expect(g.turnStartsAt!.getTime()).toBe(before + AUX_COUNTDOWN_MS);
    expect(g.songCount).toBe(15);
    expect(await openLobbyFor(p2)).toBeNull();

    s = (await loadAuxState(r.gameId, p3))!;
    expect(s.started).toBe(true);
    expect(s.lobby).toBeNull();
    expect(s.turn).toMatchObject({ position: 1, playerId: p1, lap: 1, laps: 5, startedAt: null, clipUrl: null });
  });

  it("starts without someone 30 seconds after the last I'm in, and everyone moves up", async () => {
    const ids = [await addUser("Topher"), await addUser("Mike"), await addUser("Sarah"), await addUser("Dave")];
    await addVariedSongs(25);
    const r = await createGame({ ...base, playerIds: ids, songCount: 20, createdBy: ids[0] });
    if (!r.ok) throw new Error(r.error);
    const [p1, p2, p3, p4] = (await order(r.gameId)).map((o) => o.userId);
    const lateClips = (await db.select().from(gameSongs).where(eq(gameSongs.gameId, r.gameId)))
      .filter((gs) => gs.position > 10)
      .map((gs) => gs.clipFile);

    // Player 1 never shows up; players 2 and 4 are in, player 3 isn't.
    await joinAux(p2, r.gameId);
    advance(5000);
    await joinAux(p4, r.gameId);
    const s = (await loadAuxState(r.gameId, p2))!;
    expect(s.lobby?.starter).toBe(p2); // player 2 gets the button
    expect(s.lobby?.startWithoutAt).toBe(Date.now() + AUX_LOBBY_WAIT_MS);
    expect(await startAux(p2, r.gameId, { without: true })).toMatchObject({ ok: false });
    advance(AUX_LOBBY_WAIT_MS);
    expect(await startAux(p2, r.gameId, { without: true })).toEqual({ ok: true });

    const g = await gameRow(r.gameId);
    expect(g.songCount).toBe(10);
    expect(await order(r.gameId)).toEqual([
      { userId: p2, turnOrder: 1 },
      { userId: p4, turnOrder: 2 },
    ]);
    const left = await db.select().from(gameSongs).where(eq(gameSongs.gameId, r.gameId));
    expect(left.map((gs) => gs.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(lateClips.some(clipExists)).toBe(false);

    // The players left out see a friendly page, not the game.
    expect(await loadAuxState(r.gameId, p1)).toBeNull();
    expect(await loadGameView(r.gameId, p3)).toBeNull();
  });
});

describe("taking turns", () => {
  it("only the turn player's phone gets the clip, and only they can answer", async () => {
    const { gameId, turnOrder } = await startedGame(["Topher", "Mike", "Sarah"]);
    const [p1, p2, p3] = turnOrder;
    const gs1 = await songAt(gameId, 1);
    const gs2 = await songAt(gameId, 2);
    const gs4 = await songAt(gameId, 4);

    const mine = (await loadAuxState(gameId, p1))!;
    const theirs = (await loadAuxState(gameId, p2))!;
    expect(mine.turn?.clipUrl).toBe(`/api/clips/${gs1.clipFile}`);
    expect(theirs.turn?.clipUrl).toBeNull();
    // Every phone shows the same choices in the same order, and none says which is right.
    expect(theirs.turn?.choices).toEqual(mine.turn?.choices);
    expect(JSON.stringify(theirs)).not.toContain(`"rightSongId"`);
    // Each phone gets its own next song ready.
    expect(theirs.myNextClip).toBe(`/api/clips/${gs2.clipFile}`);

    expect(await mayPlayClip(p1, gs1.clipFile)).toBe(true);
    expect(await mayPlayClip(p2, gs1.clipFile)).toBe(false);
    expect(await mayPlayClip(p2, gs2.clipFile)).toBe(true);
    expect(await mayPlayClip(p1, gs4.clipFile)).toBe(false); // beyond their next song

    // The other modes' Play and answer don't work here, and nobody can play someone else's turn.
    expect(await startSong(p2, gs1.id)).toMatchObject({ ok: false });
    expect(await answerSong(p1, gs1.id, gs1.songId)).toMatchObject({ ok: false });
    expect(await playAux(p2, gs1.id)).toMatchObject({ ok: false, error: "It isn't your turn." });
    expect(await answerAux(p1, gs1.id, gs1.songId)).toMatchObject({ ok: false, error: "Tap Play first." });
    expect(await playAux(p1, gs2.id)).toMatchObject({ ok: false });
    expect(await nudge(p1, gameId, p3)).toMatchObject({ ok: false });

    // Player 1's clip starts: the clock starts, and everyone sees it.
    const played = await playAux(p1, gs1.id);
    expect(played).toMatchObject({ ok: true, startedAt: Date.now() });
    expect((await loadAuxState(gameId, p3))!.turn?.startedAt).toBe(Date.now());
    advance(4000);
    expect(await answerAux(p2, gs1.id, gs1.songId)).toMatchObject({ ok: false, error: "It isn't your turn." });
    const answered = await answerAux(p1, gs1.id, gs1.songId);
    expect(answered).toMatchObject({ ok: true, result: { correct: true, points: 760, elapsedMs: 4000 } });

    // Everyone sees how it went, then a 3-2-1 to player 2's song.
    const after = (await loadAuxState(gameId, p3))!;
    expect(after.last).toMatchObject({
      position: 1,
      playerId: p1,
      rightSongId: gs1.songId,
      pickSongId: gs1.songId,
      correct: true,
      points: 760,
      completedAt: Date.now(),
    });
    expect(after.turn).toMatchObject({ position: 2, playerId: p2, startsAt: Date.now() + AUX_RESULT_MS + AUX_COUNTDOWN_MS });
    expect(after.players.find((p) => p.userId === p1)).toMatchObject({ points: 760, played: 1 });
    // Player 1's clip keeps playing through the changeover.
    expect(clipExists(gs1.clipFile)).toBe(true);
    expect(await mayPlayClip(p1, gs1.clipFile)).toBe(true);

    // Song 2 ends: song 1's clip has finished playing by now, so it's deleted.
    advance(AUX_RESULT_MS + AUX_COUNTDOWN_MS);
    expect(await takeTurn(gameId, p2, false)).toMatchObject({ ok: true, result: { correct: false } });
    expect(clipExists(gs1.clipFile)).toBe(false);
  });

  it("gives 0 points when time runs out, even if the turn player's phone never answers", async () => {
    const { gameId, turnOrder } = await startedGame(["Topher", "Mike"]);
    const [p1, p2] = turnOrder;
    const gs1 = await songAt(gameId, 1);

    // The cue was missed and nobody tapped Play: still running until the turn ends.
    advance(turnLengthMs(gs1.clipLengthSec) - 1000);
    expect((await loadAuxState(gameId, p2))!.turn?.position).toBe(1);
    // The turn player taps Play late: the clock starts then, but the turn still ends on time.
    expect(await playAux(p1, gs1.id)).toMatchObject({ ok: true });
    advance(2000);
    expect(await answerAux(p1, gs1.id, gs1.songId)).toMatchObject({ ok: false, error: "Time's up." });

    const s = (await loadAuxState(gameId, p2))!;
    expect(s.last).toMatchObject({ position: 1, playerId: p1, pickSongId: null, correct: false, points: 0, elapsedMs: null });
    expect(s.turn).toMatchObject({ position: 2, playerId: p2 });
    const [a] = await db.select().from(answers).where(eq(answers.gameSongId, gs1.id));
    expect(a).toMatchObject({ userId: p1, points: 0, correct: false, choiceSongId: null });
    expect(a.answeredAt).not.toBeNull();

    // A phone that died entirely: the next phone to look moves the game on.
    advance(AUX_RESULT_MS + AUX_COUNTDOWN_MS + turnLengthMs(20) + 1000);
    expect((await loadAuxState(gameId, p1))!.last).toMatchObject({ position: 2, playerId: p2, points: 0 });
  });

  it("plays to the end: 5 songs each, then the results", async () => {
    const { gameId, turnOrder } = await startedGame(["Topher", "Mike"]);
    const [p1, p2] = turnOrder;
    for (let position = 1; position <= 10; position++) {
      const who = position % 2 === 1 ? p1 : p2;
      const r = await takeTurn(gameId, who, position !== 4, 2000);
      expect(r).toMatchObject({ ok: true });
    }
    const g = await gameRow(gameId);
    expect(g.status).toBe("finished");
    await Promise.all(afterTasks.splice(0));
    expect(emailSubjects().filter((s) => s?.startsWith("Game over"))).toHaveLength(2);

    // Each song has one pick: its player's.
    const view = (await loadGameView(gameId, p1))!;
    expect(view.history).toHaveLength(10);
    expect(view.history.every((h) => h.picks.length === 1)).toBe(true);
    expect(view.standings.map((s) => s.played)).toEqual([5, 5]);
    const results = (await loadGameResults([gameId])).get(gameId)!;
    expect(results.songs.find((s) => s.position === 4)!.picks).toMatchObject([{ userId: p2, correct: false }]);
    expect(results.standings.find((s) => s.userId === p1)).toMatchObject({ correct: 5, played: 5 });
  });
});

describe("around the game", () => {
  it("shows the lobby and whose turn it is on the home screen and admin pages, never the song", async () => {
    const ids = [await addUser("Topher"), await addUser("Mike")];
    await addVariedSongs(12);
    const r = await createGame({ ...base, playerIds: ids, songCount: 10, createdBy: ids[0] });
    if (!r.ok) throw new Error(r.error);
    const [p1, p2] = (await order(r.gameId)).map((o) => o.userId);

    let [card] = await myGames(p2);
    expect(card.aux).toMatchObject({ lobby: true, myNumber: 2, joined: 0, players: 2 });
    let progress = (await gameProgress(r.gameId))!;
    expect(progress.label).toBe("Lobby open");
    expect(progress.aux?.lobby).toBe(true);

    await joinAux(p1, r.gameId);
    await joinAux(p2, r.gameId);
    await startAux(p1, r.gameId);
    advance(AUX_COUNTDOWN_MS);
    [card] = await myGames(p2);
    expect(card.aux).toMatchObject({ lobby: false, myTurn: false, turnName: expect.any(String) });
    progress = (await gameProgress(r.gameId))!;
    expect(progress.label).toBe("Song 1 of 10");
    expect(progress.aux?.turnUserId).toBe(p1);
    // Players and turns only: no song titles (the admin plays too).
    expect(JSON.stringify(progress)).not.toMatch(/Artist song/);
    expect(JSON.stringify(await myGames(p1))).not.toMatch(/Artist song/);
  });
});
