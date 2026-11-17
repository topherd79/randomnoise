import { describe, expect, it } from "vitest";
import { clampStart, pickClipStart, surpriseStart } from "@/lib/clips";
import { chipCounts, decadeOf, filterKey, hasFilters, isPreferred, matchesFilters, NO_FILTERS } from "@/lib/song-filters";
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
    expect(matchesFilters(song, { ...NO_FILTERS, genres: ["rock", "alternative"] })).toBe(true);
  });
  it("picked artists don't narrow the draw; they only come first", () => {
    expect(matchesFilters(song, { ...NO_FILTERS, artists: ["queen"] })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, artists: ["queen"] })).toBe(false);
    expect(isPreferred(song, { artists: ["queen", "THE  killers"] })).toBe(true);
    expect(isPreferred(song, { artists: ["queen"] })).toBe(false);
    expect(isPreferred(song, { artists: [] })).toBe(false);
  });
  it("every filter must match", () => {
    expect(matchesFilters(song, { decades: [2000], genres: ["alternative"], artists: [] })).toBe(true);
    expect(matchesFilters(song, { decades: [2000], genres: ["rock"], artists: [] })).toBe(false);
  });
  it("a song with no year or genre can't match those filters", () => {
    expect(matchesFilters({ ...song, year: null }, { ...NO_FILTERS, decades: [2000] })).toBe(false);
    expect(matchesFilters({ ...song, genre: null }, { ...NO_FILTERS, genres: ["alternative"] })).toBe(false);
  });
  it("a left-out genre is never drawn, and songs with no genre stay in", () => {
    expect(matchesFilters(song, { ...NO_FILTERS, excludeGenres: ["alternative"] })).toBe(false);
    expect(matchesFilters({ ...song, genre: " ALTERNATIVE " }, { ...NO_FILTERS, excludeGenres: ["alternative"] })).toBe(false);
    expect(matchesFilters(song, { ...NO_FILTERS, excludeGenres: ["pop", "christmas"] })).toBe(true);
    expect(matchesFilters({ ...song, genre: null }, { ...NO_FILTERS, excludeGenres: ["alternative"] })).toBe(true);
    // Leaving a genre out works alongside the other filters.
    expect(matchesFilters(song, { ...NO_FILTERS, decades: [2000], excludeGenres: ["pop"] })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, excludeGenres: ["pop"] })).toBe(true);
    expect(hasFilters(NO_FILTERS)).toBe(false);
  });
});

describe("songs with several genres", () => {
  const popRock = { artist: "Someone", year: 1985, genre: "Pop/Rock" };
  const stored = { artist: "Someone", year: 1985, genre: "Pop, Rock" };
  it("match a genre filter when any of their genres is ticked", () => {
    for (const song of [popRock, stored]) {
      expect(matchesFilters(song, { ...NO_FILTERS, genres: ["rock"] })).toBe(true);
      expect(matchesFilters(song, { ...NO_FILTERS, genres: ["pop"] })).toBe(true);
      expect(matchesFilters(song, { ...NO_FILTERS, genres: ["folk"] })).toBe(false);
    }
  });
  it("stay out when any of their genres is left out, even with another ticked (red wins)", () => {
    expect(matchesFilters(popRock, { ...NO_FILTERS, excludeGenres: ["pop"] })).toBe(false);
    expect(matchesFilters(popRock, { ...NO_FILTERS, genres: ["rock"], excludeGenres: ["pop"] })).toBe(false);
  });
  it("keep a name like Hard Rock whole: ticking Rock doesn't pick it", () => {
    expect(matchesFilters({ year: 1980, genre: "Hard Rock" }, { ...NO_FILTERS, genres: ["rock"] })).toBe(false);
    expect(matchesFilters({ year: 1980, genre: "Hard Rock" }, { ...NO_FILTERS, genres: ["hard rock"] })).toBe(true);
  });
  it("count under each of their genres", () => {
    const c = chipCounts([popRock, { year: 1990, genre: "Rock" }, { year: 1977, genre: "Punk - New Wave" }], NO_FILTERS);
    expect(Object.fromEntries(c.genres)).toEqual({ pop: 1, rock: 2, punk: 1, "new wave": 1 });
  });
});

describe("chip counts on the game form", () => {
  const songs = [
    { year: 1975, genre: "Rock" },
    { year: 1977, genre: "Rock" },
    { year: 1981, genre: "Rock" },
    { year: 1984, genre: "Pop" },
    { year: 1997, genre: "Alternative" },
    { year: null, genre: "Pop" },
    { year: 1999, genre: null },
  ];
  const at = (m: Map<number | string, number>, k: number | string) => m.get(k) ?? 0;

  it("with nothing picked, counts every song", () => {
    const c = chipCounts(songs, NO_FILTERS);
    expect([1970, 1980, 1990].map((d) => at(c.decades, d))).toEqual([2, 2, 2]);
    expect(["rock", "pop", "alternative"].map((g) => at(c.genres, g))).toEqual([3, 2, 1]);
  });

  it("decade counts follow the genre chips, genre counts follow the decade chips", () => {
    const rock = chipCounts(songs, { ...NO_FILTERS, genres: ["rock"] });
    expect([1970, 1980, 1990].map((d) => at(rock.decades, d))).toEqual([2, 1, 0]);
    // A genre's own count ignores the genre chips, so you can see what adding another would bring.
    expect(at(rock.genres, "pop")).toBe(2);

    const eighties = chipCounts(songs, { ...NO_FILTERS, decades: [1980] });
    expect(["rock", "pop", "alternative"].map((g) => at(eighties.genres, g))).toEqual([1, 1, 0]);
  });

  it("left-out genres come off the decade counts", () => {
    const noRock = chipCounts(songs, { ...NO_FILTERS, excludeGenres: ["rock"] });
    expect([1970, 1980, 1990].map((d) => at(noRock.decades, d))).toEqual([0, 1, 2]);
  });

  it("picked artists don't change the counts", () => {
    expect(chipCounts(songs, { ...NO_FILTERS, artists: ["queen"] })).toEqual(chipCounts(songs, NO_FILTERS));
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
