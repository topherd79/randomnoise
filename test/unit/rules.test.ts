import { describe, expect, it } from "vitest";
import { CUTOFF_MS, MAX_POINTS, MIN_POINTS, REVEAL_MS, pointsAt, revealedChars, scoreAnswer, shuffleFor } from "@/lib/rules";

describe("pointsAt", () => {
  it("is 1,000 at the start and slides to 100 at full reveal", () => {
    expect(pointsAt(0)).toBe(MAX_POINTS);
    expect(pointsAt(REVEAL_MS / 2)).toBe(Math.round((MAX_POINTS + MIN_POINTS) / 2));
    expect(pointsAt(REVEAL_MS)).toBe(MIN_POINTS);
  });
  it("stays at 100 until the cutoff, then 0", () => {
    expect(pointsAt(CUTOFF_MS)).toBe(MIN_POINTS);
    expect(pointsAt(CUTOFF_MS + 1)).toBe(0);
  });
  it("never goes up as time passes", () => {
    for (let t = 0; t < CUTOFF_MS + 2000; t += 250) expect(pointsAt(t + 250)).toBeLessThanOrEqual(pointsAt(t));
  });
});

describe("scoreAnswer", () => {
  it("a right answer earns what it's worth at that moment", () => {
    expect(scoreAnswer(true, 3000)).toBe(pointsAt(3000));
  });
  it("a wrong answer loses a third of that", () => {
    expect(scoreAnswer(false, 3000)).toBe(-Math.round(pointsAt(3000) / 3));
  });
  it("random guessing is worth about zero on average (1 right in 4)", () => {
    for (const t of [0, 4000, 9000, REVEAL_MS]) {
      const average = (scoreAnswer(true, t) + 3 * scoreAnswer(false, t)) / 4;
      expect(Math.abs(average)).toBeLessThanOrEqual(1);
    }
  });
});

describe("revealedChars", () => {
  it("shows nothing at the start and everything at full reveal, for any length", () => {
    for (const len of [8, 25, 60]) {
      expect(revealedChars(len, 0)).toBe(0);
      expect(revealedChars(len, REVEAL_MS)).toBe(len);
    }
  });
  it("all choices finish together: the same share is showing whatever the length", () => {
    const share = (len: number) => revealedChars(len, REVEAL_MS / 2) / len;
    expect(Math.abs(share(20) - share(60))).toBeLessThan(0.06);
  });
});

describe("shuffleFor", () => {
  const items = ["a", "b", "c", "d"];
  it("gives the same order every time for the same player and song", () => {
    expect(shuffleFor(items, "song1:mike")).toEqual(shuffleFor(items, "song1:mike"));
  });
  it("keeps all four choices", () => {
    expect([...shuffleFor(items, "song1:mike")].sort()).toEqual(items);
  });
  it("differs between players often enough", () => {
    const orders = new Set(["mike", "sarah", "dave", "jen", "topher", "sam"].map((p) => shuffleFor(items, `song1:${p}`).join("")));
    expect(orders.size).toBeGreaterThan(2);
  });
});
