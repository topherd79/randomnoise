import { describe, expect, it } from "vitest";
import { clampStart, pickClipStart, surpriseStart } from "@/lib/clips";
import { decadeOf, filterKey, matchesFilters, NO_FILTERS } from "@/lib/song-filters";
import { normalize } from "@/lib/normalize";

describe("song filters", () => {
  const song = { artist: "The Killers", year: 2004, genre: "Alternative" };
  it("normalizes keys for case and spacing", () => {
    expect(filterKey("  R&B/Soul ")).toBe("r&b/soul");
    expect(filterKey("The   Killers")).toBe("the killers");
  });
  it("groups years into decades", () => {
    expect([1969, 1970, 1999, 2004].map(decadeOf)).toEqual([1960, 1970, 1990, 2000]);
  });
  it("no filters match everything", () => {
    expect(matchesFilters(song, NO_FILTERS)).toBe(true);
  });
  it("any option within a filter counts", () => {
    expect(matchesFilters(song, { ...NO_FILTERS, decades: [1990, 2000] })).toBe(true);
    expect(matchesFilters(song, { ...NO_FILTERS, artists: ["queen", "the killers"] })).toBe(true);
  });
  it("every filter must match", () => {
    expect(matchesFilters(song, { decades: [2000], genres: ["alternative"], artists: [] })).toBe(true);
    expect(matchesFilters(song, { decades: [2000], genres: ["rock"], artists: [] })).toBe(false);
  });
  it("a song with no year or genre can't match those filters", () => {
    expect(matchesFilters({ ...song, year: null }, { ...NO_FILTERS, decades: [2000] })).toBe(false);
    expect(matchesFilters({ ...song, genre: null }, { ...NO_FILTERS, genres: ["alternative"] })).toBe(false);
  });
});

describe("normalize", () => {
  it("ignores case, accents, 'The', remaster tags and featured artists", () => {
    expect(normalize("The Beatles")).toBe(normalize("beatles"));
    expect(normalize("Beyoncé")).toBe("beyonce");
    expect(normalize("Song (2011 Remaster)")).toBe("song");
    expect(normalize("Track - Live at Wembley")).toBe("track");
    expect(normalize("Hit feat. Someone")).toBe("hit");
  });
});

describe("clips", () => {
  // 60 points over a 200 s song: loud everywhere except a quiet stretch from 100 s to 150 s.
  const waveform = Array.from({ length: 60 }, (_, i) => (i >= 30 && i < 45 ? 2 : 80));
  const song = { durationSec: 200, waveform, clipMode: "surprise" as const, clipSpots: [] };

  it("clampStart keeps the whole clip inside the song", () => {
    expect(clampStart(195, 10, 200)).toBe(190);
    expect(clampStart(-5, 10, 200)).toBe(0);
  });
  it("'surprise me' avoids the very start, the end and mostly-quiet stretches", () => {
    for (let i = 0; i < 200; i++) {
      const start = surpriseStart(song, 10);
      expect(start).toBeGreaterThanOrEqual(20);
      expect(start + 10).toBeLessThanOrEqual(180);
      // It judges a clip by its average loudness, so it may brush the edge of
      // the quiet stretch, but never sits in it.
      const quietSeconds = Math.max(0, Math.min(start + 10, 150) - Math.max(start, 100));
      expect(quietSeconds).toBeLessThanOrEqual(4);
    }
  });
  it("'start of song' always starts at 0:00", () => {
    expect(pickClipStart({ ...song, clipMode: "start" }, 10)).toBe(0);
  });
  it("'pick a spot' uses one of the marked spots (clamped to fit)", () => {
    const spots = [12, 60, 198];
    for (let i = 0; i < 50; i++) {
      expect([12, 60, 190]).toContain(pickClipStart({ ...song, clipMode: "spots", clipSpots: spots }, 10));
    }
  });
});
