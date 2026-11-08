import { describe, expect, it } from "vitest";
import {
  ALL_LENGTHS,
  MODES,
  nextPosition,
  openRound,
  roundLabel,
  roundSize,
  songsLeft,
  waitingNote,
  waitingOnText,
} from "@/lib/modes";

describe("game modes", () => {
  it("has the agreed game lengths", () => {
    expect(MODES.og.lengths).toEqual([5, 10, 15, 20, 25]);
    expect(MODES.three.lengths).toEqual([6, 9, 15, 18]);
    expect(MODES.all.lengths).toEqual([5, 10, 15, 20, 25]);
    expect(ALL_LENGTHS).toEqual([5, 6, 9, 10, 15, 18, 20, 25]);
    for (const m of Object.values(MODES)) expect(m.lengths).toContain(m.defaultLength);
  });

  it("3 songs mode lengths are whole rounds", () => {
    for (const n of MODES.three.lengths) expect(n % 3).toBe(0);
  });

  it("opens 1, 3 or every song at a time", () => {
    expect(roundSize("og", 10)).toBe(1);
    expect(roundSize("three", 9)).toBe(3);
    expect(roundSize("all", 10)).toBe(10);
    expect(openRound("og", 10, 4)).toEqual({ start: 4, end: 4 });
    expect(openRound("three", 9, 4)).toEqual({ start: 4, end: 6 });
    expect(openRound("all", 10, 1)).toEqual({ start: 1, end: 10 });
    // Never past the last song.
    expect(openRound("three", 9, 7)).toEqual({ start: 7, end: 9 });
  });

  it("a player's next song is the lowest open one they haven't answered", () => {
    const round = { start: 4, end: 6 };
    expect(nextPosition(round, new Set())).toBe(4);
    expect(nextPosition(round, new Set([4]))).toBe(5);
    expect(nextPosition(round, new Set([4, 6]))).toBe(5);
    expect(nextPosition(round, new Set([4, 5, 6]))).toBeNull();
    expect(songsLeft(round, new Set([4]))).toBe(2);
    expect(songsLeft(round, new Set([4, 5, 6]))).toBe(0);
  });

  it("describes the round and who it's waiting on", () => {
    expect(roundLabel("og", 10, { start: 4, end: 4 })).toBe("Song 4 of 10");
    expect(roundLabel("three", 9, { start: 4, end: 6 })).toBe("Songs 4–6 of 9");
    expect(roundLabel("all", 10, { start: 1, end: 10 })).toBe("All 10 songs");
    expect(waitingOnText([{ name: "Dave", left: 1 }, { name: "Mike", left: 1 }], 1)).toBe("Dave and Mike");
    expect(waitingOnText([{ name: "Dave", left: 2 }, { name: "Mike", left: 1 }], 3)).toBe("Dave (2 songs left) and Mike (1 song left)");
    expect(waitingNote("og", { start: 4, end: 4 }, 10)).toMatch(/next song opens/);
    expect(waitingNote("og", { start: 10, end: 10 }, 10)).toMatch(/final results/);
    expect(waitingNote("three", { start: 4, end: 6 }, 9)).toMatch(/next songs open/);
    expect(waitingNote("all", { start: 1, end: 10 }, 10)).toMatch(/every song/);
  });
});
