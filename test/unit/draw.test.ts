import { describe, expect, it } from "vitest";
import { maxSongsPerArtist, pickSpreadOut, pickWrongAnswers, shuffle, type Candidate } from "@/lib/draw";

const song = (id: string, artist: string, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  title: `Song ${id}`,
  artist,
  year: 2000,
  genre: "Rock",
  ...extra,
});
const countBy = (list: { artist: string }[]) =>
  list.reduce<Record<string, number>>((m, s) => ({ ...m, [s.artist]: (m[s.artist] ?? 0) + 1 }), {});

/** A repeatable "random" so tests don't flake. */
function seeded(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

describe("maxSongsPerArtist", () => {
  it("allows one song per artist for every five in the game", () => {
    expect([5, 10, 15, 20, 25].map(maxSongsPerArtist)).toEqual([1, 2, 3, 4, 5]);
  });
  it("never goes below one", () => {
    expect(maxSongsPerArtist(3)).toBe(1);
  });
});

describe("pickSpreadOut", () => {
  it("keeps to the limit when there are enough artists", () => {
    // 6 Queen songs first in line, plus plenty of others.
    const fresh = [
      ...Array.from({ length: 6 }, (_, i) => song(`q${i}`, "Queen")),
      ...Array.from({ length: 10 }, (_, i) => song(`o${i}`, `Artist ${i}`)),
    ];
    const picked = pickSpreadOut(fresh, [], 10, 2);
    expect(picked).toHaveLength(10);
    expect(countBy(picked).Queen).toBe(2);
    expect(Math.max(...Object.values(countBy(picked)))).toBeLessThanOrEqual(2);
  });

  it("a 5-song game has five different artists when possible", () => {
    const fresh = ["A", "A", "B", "B", "C", "D", "E", "F"].map((a, i) => song(String(i), a));
    const picked = pickSpreadOut(fresh, [], 5, maxSongsPerArtist(5));
    expect(new Set(picked.map((s) => s.artist)).size).toBe(5);
  });

  it("treats artist names case- and spacing-insensitively", () => {
    const fresh = [song("1", "Queen"), song("2", "queen "), song("3", "QUEEN"), song("4", "ABBA"), song("5", "Journey")];
    const picked = pickSpreadOut(fresh, [], 3, 1);
    expect(picked.map((s) => s.id)).toEqual(["1", "4", "5"]);
  });

  it("never blocks a game: fills the rest as evenly as possible when artists run out", () => {
    // Two artists only (e.g. an artist filter), 10-song game, limit 2.
    const fresh = [
      ...Array.from({ length: 8 }, (_, i) => song(`q${i}`, "Queen")),
      ...Array.from({ length: 8 }, (_, i) => song(`k${i}`, "The Killers")),
    ];
    const picked = pickSpreadOut(fresh, [], 10, 2);
    expect(picked).toHaveLength(10);
    expect(countBy(picked)).toEqual({ Queen: 5, "The Killers": 5 });
  });

  it("takes new songs before songs from earlier games", () => {
    const fresh = [song("n1", "A"), song("n2", "B")];
    const earlier = [song("e1", "C"), song("e2", "D"), song("e3", "E")];
    expect(pickSpreadOut(fresh, earlier, 4, 1).map((s) => s.id)).toEqual(["n1", "n2", "e1", "e2"]);
  });

  it("returns fewer songs only when there aren't enough at all", () => {
    expect(pickSpreadOut([song("1", "A"), song("2", "A")], [], 5, 1)).toHaveLength(2);
  });

  it("never picks the same song twice", () => {
    const fresh = Array.from({ length: 30 }, (_, i) => song(String(i), `Artist ${i % 4}`));
    const picked = pickSpreadOut(fresh, [], 25, 5);
    expect(new Set(picked.map((s) => s.id)).size).toBe(picked.length);
  });
});

describe("pickWrongAnswers", () => {
  const pool = [
    song("a", "Queen", { year: 1975 }),
    song("b", "ABBA", { year: 1976, genre: "Pop" }),
    song("c", "Journey", { year: 1981 }),
    song("d", "Radiohead", { year: 1997, genre: "Alternative" }),
    song("e", "Daft Punk", { year: 2001, genre: "Electronic" }),
    song("f", "Beyoncé", { year: 2003, genre: "R&B/Soul" }),
  ];

  it("returns three other songs, never the right answer", () => {
    for (let seed = 1; seed < 20; seed++) {
      const wrong = pickWrongAnswers(pool[0], pool, new Set(), "random", seeded(seed));
      expect(wrong).toHaveLength(3);
      expect(wrong.map((w) => w.id)).not.toContain("a");
      expect(new Set(wrong.map((w) => w.id)).size).toBe(3);
    }
  });

  it("skips duplicates of the right answer (the same song uploaded twice)", () => {
    const withCopy = [...pool, { ...pool[0], id: "a-copy" }];
    for (let seed = 1; seed < 20; seed++) {
      const wrong = pickWrongAnswers(pool[0], withCopy, new Set(), "random", seeded(seed));
      expect(wrong.map((w) => w.id)).not.toContain("a-copy");
    }
  });

  it("avoids songs coming up later in the same game when it can", () => {
    const inGame = new Set(["b", "c"]);
    const wrong = pickWrongAnswers(pool[0], pool, inGame, "random", seeded(3));
    expect(wrong.map((w) => w.id).sort()).toEqual(["d", "e", "f"]);
  });

  it("'similar' prefers songs close in era and genre", () => {
    const answer = song("x", "Led Zeppelin", { year: 1975, genre: "Rock" });
    const wrong = pickWrongAnswers(answer, pool, new Set(), "similar", () => 0);
    expect(wrong.map((w) => w.id)).toEqual(["a", "c", "b"]); // 1975 rock, 1981 rock, 1976 pop
  });
});

describe("shuffle", () => {
  it("keeps every item", () => {
    const list = Array.from({ length: 50 }, (_, i) => i);
    expect([...shuffle(list, seeded(7))].sort((a, b) => a - b)).toEqual(list);
  });
});
