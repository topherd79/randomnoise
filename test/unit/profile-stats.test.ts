import { describe, expect, it } from "vitest";
import {
  answerSummary,
  bestAndWorst,
  bestGuesses,
  companyText,
  decadeOf,
  genreOf,
  isWin,
  ordinal,
  placeOf,
  resultText,
  type ScoredSong,
} from "@/lib/profile-stats";

let n = 0;
function song(over: Partial<ScoredSong>): ScoredSong {
  n += 1;
  return {
    points: 500,
    correct: true,
    elapsedMs: 5000,
    answeredAt: new Date(Date.UTC(2026, 10, 1, 12, n)),
    title: `Song ${n}`,
    artist: "Someone",
    artworkUrl: null,
    genre: "Rock",
    year: 1995,
    ...over,
  };
}

describe("best guesses", () => {
  it("are the highest-scoring right answers, faster first on a tie, then earlier", () => {
    const early = song({ title: "Early", points: 900, elapsedMs: 1200, answeredAt: new Date("2026-11-01") });
    const late = song({ title: "Late", points: 900, elapsedMs: 1200, answeredAt: new Date("2026-11-09") });
    const rows = [
      song({ title: "Wrong", correct: false, points: -300 }),
      song({ title: "Slow", points: 900, elapsedMs: 1500 }),
      late,
      song({ title: "Low", points: 200 }),
      early,
      song({ title: "Top", points: 976, elapsedMs: 400 }),
    ];
    expect(bestGuesses(rows).map((r) => r.title)).toEqual(["Top", "Early", "Late"]);
  });

  it("can be fewer than three, or none", () => {
    expect(bestGuesses([song({ title: "Only" })]).map((r) => r.title)).toEqual(["Only"]);
    expect(bestGuesses([song({ correct: false, points: -100 })])).toEqual([]);
  });
});

describe("best and worst genre or decade", () => {
  it("ranks by average points a song and ignores groups with fewer than 5 songs", () => {
    const rows = [
      // Electronic: 5 songs, average 700.
      ...[600, 700, 800, 700, 700].map((points) => song({ genre: "Electronic", points })),
      // Pop: 6 songs, average 250 (wrong answers count, negative points included).
      ...[400, 400, 400, 400, 100, -200].map((points) => song({ genre: "Pop", points, correct: points > 0 })),
      // Rock: 5 songs, average 500.
      ...[500, 500, 500, 500, 500].map((points) => song({ genre: "Rock", points })),
      // Jazz: only 4 songs, all perfect. Too few to count.
      ...[1000, 1000, 1000, 1000].map((points) => song({ genre: "Jazz", points })),
      // No genre at all.
      song({ genre: null, points: 1000 }),
    ];
    const { best, worst } = bestAndWorst(rows, (r) => genreOf(r.genre));
    expect(best).toEqual({ name: "Electronic", songs: 5, total: 3500, average: 700 });
    expect(worst).toEqual({ name: "Pop", songs: 6, total: 1500, average: 250 });
  });

  it("merges genre names the same way the catalog does", () => {
    const rows = [
      ...Array.from({ length: 3 }, () => song({ genre: "Alternatif et Indé", points: 800 })),
      ...Array.from({ length: 2 }, () => song({ genre: "Alternative", points: 300 })),
    ];
    expect(bestAndWorst(rows, (r) => genreOf(r.genre)).best).toMatchObject({ name: "Alternative", songs: 5, average: 600 });
  });

  it("has no worst until two groups qualify", () => {
    const rows = Array.from({ length: 5 }, () => song({ year: 1984 }));
    expect(bestAndWorst(rows, (r) => decadeOf(r.year))).toEqual({
      best: { name: "1980s", songs: 5, total: 2500, average: 500 },
      worst: null,
    });
    expect(bestAndWorst(rows.slice(0, 4), (r) => decadeOf(r.year))).toEqual({ best: null, worst: null });
  });

  it("puts years into decades", () => {
    expect(decadeOf(1999)).toBe("1990s");
    expect(decadeOf(2000)).toBe("2000s");
    expect(decadeOf(2026)).toBe("2020s");
    expect(decadeOf(null)).toBeNull();
    expect(decadeOf(0)).toBeNull();
  });
});

describe("answer summary", () => {
  it("counts right answers and averages every answer's time", () => {
    const rows = [song({ elapsedMs: 2000 }), song({ elapsedMs: 4000, correct: false }), song({ elapsedMs: 6000 })];
    expect(answerSummary(rows)).toEqual({ answered: 3, right: 2, averageMs: 4000 });
    expect(answerSummary([])).toEqual({ answered: 0, right: 0, averageMs: null });
  });
});

describe("placings", () => {
  const table = [
    { userId: "t", name: "Topher", points: 5000 },
    { userId: "s", name: "Sarah", points: 5000 },
    { userId: "m", name: "Mike", points: 3000 },
    { userId: "d", name: "Dave", points: -200 },
  ];

  it("shares a place on a tie and skips the next", () => {
    expect(placeOf(table, "t")).toBe(1);
    expect(placeOf(table, "s")).toBe(1);
    expect(placeOf(table, "m")).toBe(3);
    expect(placeOf(table, "d")).toBe(4);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd"]);
  });

  it("says who won from each player's point of view", () => {
    expect(resultText(table, "t", false)).toBe("You and Sarah tied");
    expect(resultText(table, "m", false)).toBe("Sarah and Topher tied");
    const clear = [
      { userId: "d", name: "Dave", points: 6880 },
      { userId: "t", name: "Topher", points: 5310 },
    ];
    expect(resultText(clear, "t", false)).toBe("Dave won");
    expect(resultText(clear, "d", false)).toBe("You won");
    expect(resultText(clear, "t", true)).toBe("Dave led");
  });

  it("counts a tie at the top as a win, but never a game played alone", () => {
    expect(isWin(table, "t")).toBe(true);
    expect(isWin(table, "s")).toBe(true);
    expect(isWin(table, "m")).toBe(false);
    expect(isWin([{ userId: "t", name: "Topher", points: 4000 }], "t")).toBe(false);
  });

  it("describes who else played", () => {
    expect(companyText([])).toBe("just you");
    expect(companyText(["Mike"])).toBe("with Mike");
    expect(companyText(["Sarah", "Mike"])).toBe("with Mike and Sarah");
    expect(companyText(["Sarah", "Mike", "Dave"])).toBe("4 players");
  });
});
