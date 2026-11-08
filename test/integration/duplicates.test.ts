// Copies of one song (same title and artist) count as one song, and the
// one-off genre clean-up.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const afterTasks: Promise<unknown>[] = [];
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void afterTasks.push(Promise.resolve().then(fn)) }));

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { gameSongs, games, songs } from "@/db/schema";
import { activeSongMeta, catalogCounts } from "@/lib/catalog-queries";
import { answerSong, createGame, startSong } from "@/lib/games";
import { songKey } from "@/lib/normalize";
import { NO_FILTERS } from "@/lib/song-filters";
import { addSong, addUser, addVariedSongs, resetAll } from "./helpers";

const base = { clipLengthSec: 10, wrongAnswers: "random" as const, filters: NO_FILTERS };

beforeEach(async () => {
  await resetAll();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  await Promise.all(afterTasks.splice(0));
  vi.restoreAllMocks();
});

async function playWholeGame(gameId: string, userId: string) {
  for (let p = 1; ; p++) {
    const [gs] = await db.select().from(gameSongs).where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, p)));
    if (!gs) break;
    await startSong(userId, gs.id);
    await answerSong(userId, gs.id, gs.songId);
  }
}

describe("copies of a song", () => {
  it("a copy of a played song isn't new, and doesn't count as unplayed", async () => {
    const me = await addUser("Topher");
    await addSong({ title: "Wonderwall (Remastered)", artist: "Oasis" });
    await addVariedSongs(4);
    const first = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    if (!first.ok) throw new Error(first.error);
    await playWholeGame(first.gameId, me);
    expect((await db.select().from(games).where(eq(games.id, first.gameId)))[0].status).toBe("finished");

    // The same song uploaded again (say, the MP3 next to the FLAC), plus 5 new ones.
    await addSong({ title: "Wonderwall", artist: "Oasis" });
    await addVariedSongs(5, "Newer");
    expect((await catalogCounts()).unplayed).toBe(5);
    expect((await activeSongMeta()).filter((s) => !s.played)).toHaveLength(5);

    const second = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    if (!second.ok) throw new Error(second.error);
    const drawn = await db.select().from(gameSongs).where(eq(gameSongs.gameId, second.gameId));
    expect(drawn.map((g) => g.song.artist)).not.toContain("Oasis");
  });

  it("a game never draws two copies of one song", async () => {
    const me = await addUser("Topher");
    // 3 songs with 2 copies each, and 2 single songs: only 5 different songs.
    for (const [title, artist] of [["Mr. Jones", "Counting Crows"], ["Basket Case", "Green Day"], ["Everybody Hurts", "R.E.M."]]) {
      await addSong({ title, artist, album: "Original" });
      await addSong({ title: `${title} (Remastered)`, artist, album: "Greatest Hits" });
    }
    await addVariedSongs(2);
    expect((await catalogCounts()).unplayed).toBe(5);
    const r = await createGame({ ...base, playerIds: [me], songCount: 5, createdBy: me });
    if (!r.ok) throw new Error(r.error);
    const drawn = await db.select().from(gameSongs).where(eq(gameSongs.gameId, r.gameId));
    const keys = drawn.map((g) => songKey(g.song.title, g.song.artist));
    expect(new Set(keys).size).toBe(5);
    // And no choice offers a copy of the right answer.
    for (const g of drawn) {
      const choiceKeys = g.choices.map((c) => songKey(c.title, c.artist));
      expect(new Set(choiceKeys).size).toBe(4);
    }
  });
});

describe("genre clean-up migration", () => {
  it("folds the French and variant genre names into one", async () => {
    const ids = {
      fr: await addSong({ title: "A", artist: "X", genre: "Alternatif et Indé" }),
      en: await addSong({ title: "B", artist: "Y", genre: "Alternative & Indie" }),
      el: await addSong({ title: "C", artist: "Z", genre: "Électronique" }),
      keep: await addSong({ title: "D", artist: "W", genre: "Pop/Rock" }),
    };
    const file = readFileSync("drizzle/0007_genre_names.sql", "utf8");
    for (const statement of file.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
    const genreOf = async (id: string) => (await db.select({ g: songs.genre }).from(songs).where(eq(songs.id, id)))[0].g;
    expect(await genreOf(ids.fr)).toBe("Alternative");
    expect(await genreOf(ids.en)).toBe("Alternative");
    expect(await genreOf(ids.el)).toBe("Electronic");
    expect(await genreOf(ids.keep)).toBe("Pop/Rock");
  });
});
