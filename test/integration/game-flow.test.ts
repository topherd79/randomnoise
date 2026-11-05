// The game loop end to end against a real database, with real clip cutting (ffmpeg).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Outside a Next.js request, after() has nowhere to run: run the callback straight away.
const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(Promise.resolve().then(fn)) }));

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { answers, gameSongs, games, songs } from "@/db/schema";
import { answerSong, cancelGame, createGame, startSong } from "@/lib/games";
import { loadGameResults, loadGameView } from "@/lib/game-view";
import { NO_FILTERS } from "@/lib/song-filters";
import { addSong, addUser, addVariedSongs, clipExists, resetAll } from "./helpers";

async function roundsOf(gameId: string) {
  return db.select().from(gameSongs).where(eq(gameSongs.gameId, gameId)).orderBy(gameSongs.position);
}

/** Every player plays the current song; `right` decides who picks the right answer. */
async function playCurrent(gameId: string, players: string[], right: (userId: string) => boolean) {
  const [game] = await db.select().from(games).where(eq(games.id, gameId));
  const [gs] = await db
    .select()
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, game.currentPosition)));
  for (const p of players) {
    expect((await startSong(p, gs.id)).ok).toBe(true);
    const wrongChoice = gs.choices.find((c) => c.songId !== gs.songId)!.songId;
    const r = await answerSong(p, gs.id, right(p) ? gs.songId : wrongChoice);
    expect(r.ok).toBe(true);
  }
  return gs;
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

const base = { clipLengthSec: 10, wrongAnswers: "random" as const, filters: NO_FILTERS };

describe("creating a game", () => {
  it("draws switched-on, unplayed songs, snapshots them and cuts their clips", async () => {
    const me = await addUser("Topher");
    await addVariedSongs(8);
    const off = await addSong({ title: "Switched off", artist: "Nobody", active: false });

    const r = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rounds = await roundsOf(r.gameId);
    expect(rounds).toHaveLength(5);
    expect(new Set(rounds.map((g) => g.songId)).size).toBe(5);
    expect(rounds.map((g) => g.songId)).not.toContain(off);
    for (const g of rounds) {
      expect(clipExists(g.clipFile)).toBe(true);
      const [s] = await db.select().from(songs).where(eq(songs.id, g.songId));
      expect(g.song).toMatchObject({ title: s.title, artist: s.artist, year: s.year, genre: s.genre });
      expect(g.choices).toHaveLength(4);
      expect(g.choices.map((c) => c.songId)).not.toContain(off); // never a wrong answer either
    }
  });

  it("keeps to the artist limit: at most 2 songs by one artist in a 10-song game", async () => {
    const me = await addUser("Topher");
    for (let i = 0; i < 8; i++) await addSong({ title: `Queen song ${i}`, artist: "Queen" });
    await addVariedSongs(12);
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await createGame({ ...base, playerIds: [me], songCount: 10, songPool: "mix", createdBy: me });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const queen = (await roundsOf(r.gameId)).filter((g) => g.song.artist === "Queen");
      expect(queen.length).toBeLessThanOrEqual(2);
      await cancelGame(r.gameId);
    }
  });

  it("an artist filter still fills the game, spreading the artists evenly", async () => {
    const me = await addUser("Topher");
    for (let i = 0; i < 6; i++) await addSong({ title: `Q${i}`, artist: "Queen" });
    for (let i = 0; i < 6; i++) await addSong({ title: `K${i}`, artist: "The Killers" });
    await addVariedSongs(5);
    const r = await createGame({
      ...base,
      playerIds: [me],
      songCount: 10,
      filters: { decades: [], genres: [], artists: ["queen", "the killers"] },
      createdBy: me,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const artists = (await roundsOf(r.gameId)).map((g) => g.song.artist);
    expect(artists.filter((a) => a === "Queen")).toHaveLength(5);
    expect(artists.filter((a) => a === "The Killers")).toHaveLength(5);
  });

  it("'new songs only' refuses when there aren't enough; 'include earlier' tops up", async () => {
    const me = await addUser("Topher");
    await addVariedSongs(7);
    const first = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const strict = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    expect(strict).toMatchObject({ ok: false });
    if (!strict.ok) expect(strict.error).toMatch(/only 2 new songs/);

    const mixed = await createGame({ ...base, playerIds: [me], songCount: 5, songPool: "mix", createdBy: me });
    expect(mixed.ok).toBe(true);
    if (!mixed.ok) return;
    const firstIds = new Set((await roundsOf(first.gameId)).map((g) => g.songId));
    const reused = (await roundsOf(mixed.gameId)).filter((g) => firstIds.has(g.songId));
    expect(reused).toHaveLength(3); // the 2 new songs, then 3 from the earlier game
  });
});

describe("playing a game", () => {
  it("scores answers, deletes each clip once everyone has answered, and finishes with one results email", async () => {
    const mike = await addUser("Mike");
    const sarah = await addUser("Sarah");
    await addVariedSongs(9);
    const r = await createGame({ ...base, playerIds: [mike, sarah], songCount: 5, createdBy: mike });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await Promise.all(afterTasks.splice(0)); // the "Game on" emails
    logs = [];

    for (let position = 1; position <= 5; position++) {
      const gs = await playCurrent(r.gameId, [mike, sarah], (p) => p === mike);
      expect(clipExists(gs.clipFile)).toBe(false);
      const scored = await db.select().from(answers).where(eq(answers.gameSongId, gs.id));
      expect(scored.find((a) => a.userId === mike)?.points).toBeGreaterThan(0);
      expect(scored.find((a) => a.userId === sarah)?.points).toBeLessThan(0);
    }

    const [game] = await db.select().from(games).where(eq(games.id, r.gameId));
    expect(game.status).toBe("finished");
    await Promise.all(afterTasks.splice(0));
    const subjects = logs.filter((l) => l.includes("[email]")).map((l) => l.match(/Subject: (.*)/)?.[1]);
    expect(subjects).toEqual(["Game over: Mike wins", "Game over: Mike wins"]); // no email per song
  });

  it("ending a game early deletes all its clips", async () => {
    const me = await addUser("Topher");
    await addVariedSongs(6);
    const r = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const clips = (await roundsOf(r.gameId)).map((g) => g.clipFile);
    expect(clips.every(clipExists)).toBe(true);
    await cancelGame(r.gameId);
    expect(clips.some(clipExists)).toBe(false);
  });
});

describe("game history", () => {
  it("keeps a deleted song in past results, without its full-song player", async () => {
    const me = await addUser("Topher");
    await addVariedSongs(6);
    const r = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (let i = 0; i < 5; i++) await playCurrent(r.gameId, [me], () => true);

    const [first] = await roundsOf(r.gameId);
    await db.delete(songs).where(eq(songs.id, first.songId));

    const results = (await loadGameResults([r.gameId])).get(r.gameId)!;
    expect(results.songs).toHaveLength(5);
    expect(results.songs[0]).toMatchObject({ title: first.song.title, artist: first.song.artist });
    expect(results.standings[0].correct).toBe(5);

    const view = await loadGameView(r.gameId, me);
    const deleted = view!.history.find((h) => h.position === 1)!;
    const kept = view!.history.find((h) => h.position === 2)!;
    expect(deleted.song.title).toBe(first.song.title);
    expect(deleted.song.fullUrl).toBeNull();
    expect(kept.song.fullUrl).toMatch(/^\/api\/game-songs\//);
  });

  it("a running game carries on after one of its upcoming songs is deleted", async () => {
    const me = await addUser("Topher");
    await addVariedSongs(6);
    const r = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const rounds = await roundsOf(r.gameId);
    await db.delete(songs).where(eq(songs.id, rounds[4].songId));
    for (let i = 0; i < 5; i++) await playCurrent(r.gameId, [me], () => true);
    const [game] = await db.select().from(games).where(eq(games.id, r.gameId));
    expect(game.status).toBe("finished");
    const last = await db.select().from(answers).where(eq(answers.gameSongId, rounds[4].id));
    expect(last[0].correct).toBe(true);
  });
});
