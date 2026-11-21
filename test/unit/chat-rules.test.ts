import { describe, expect, it } from "vitest";
import {
  chatTitle,
  cleanMessage,
  heldUntil,
  isReactionKind,
  MAX_MESSAGE_LENGTH,
  memberKey,
  reactionCounts,
  sparkleDots,
  sparkleWidth,
  STAMP_GAP_MS,
  stampBefore,
  stampText,
  type ReaderProgress,
} from "@/lib/chat-rules";

const progress = (entries: [string, { active?: boolean; inGame?: boolean; answered?: number[] }][]) =>
  new Map(
    entries.map(([id, p]) => [
      id,
      { active: p.active ?? true, inGame: p.inGame ?? true, answered: new Set(p.answered ?? []) } as ReaderProgress,
    ]),
  );

describe("chat rules", () => {
  it("keys a group by its members, in any order", () => {
    expect(memberKey(["b", "a", "c", "a"])).toBe("a,b,c");
    expect(memberKey(["c", "b", "a"])).toBe(memberKey(["a", "b", "c"]));
  });

  it("trims messages, refuses empty ones and caps the length", () => {
    expect(cleanMessage("  hi  ")).toBe("hi");
    expect(cleanMessage("   \n ")).toBeNull();
    expect(cleanMessage("a\r\nb")).toBe("a\nb");
    expect(cleanMessage("x".repeat(MAX_MESSAGE_LENGTH + 50))).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("holds a message back until the reader has played as far as its writer had", () => {
    const holds = [{ gameId: "g", position: 5 }];
    expect(heldUntil([], progress([]))).toBeNull();
    expect(heldUntil(holds, progress([["g", { answered: [1, 2, 3, 4] }]]))).toBe(5);
    expect(heldUntil(holds, progress([["g", { answered: [1, 2, 3, 4, 5] }]]))).toBeNull();
    // Once the game is over everything shows; someone not in that game can't be spoiled.
    expect(heldUntil(holds, progress([["g", { active: false }]]))).toBeNull();
    expect(heldUntil(holds, progress([["g", { inGame: false }]]))).toBeNull();
    // Two games at once: it waits for both.
    const two = [...holds, { gameId: "h", position: 7 }];
    expect(heldUntil(two, progress([["g", { answered: [5] }], ["h", { answered: [1] }]]))).toBe(7);
    expect(heldUntil(two, progress([["g", { answered: [1] }], ["h", { answered: [7] }]]))).toBe(5);
  });

  it("counts reactions in the picker's order, marking mine", () => {
    const counts = reactionCounts(
      [
        { userId: "me", kind: "haha" },
        { userId: "you", kind: "like" },
        { userId: "them", kind: "haha" },
      ],
      "me",
    );
    expect(counts).toEqual([
      { kind: "like", emoji: "👍", count: 1, mine: false },
      { kind: "haha", emoji: "😂", count: 2, mine: true },
    ]);
    expect(isReactionKind("fire")).toBe(true);
    expect(isReactionKind("poop")).toBe(false);
  });

  it("titles a chat by the other members", () => {
    expect(chatTitle(["Sarah", "Mike"])).toBe("Mike, Sarah and you");
    expect(chatTitle(["Mike"])).toBe("Mike and you");
  });

  it("draws sparkles from the message id, never its words", () => {
    expect(sparkleWidth("abc")).toBe(sparkleWidth("abc"));
    for (const id of ["a", "b", "0f3c", "ffffffff-ffff"]) {
      expect(sparkleWidth(id)).toBeGreaterThanOrEqual(90);
      expect(sparkleWidth(id)).toBeLessThan(200);
    }
    expect(sparkleDots("abc", 100, 20)).toEqual(sparkleDots("abc", 100, 20));
    expect(sparkleDots("abc", 100, 20)).not.toEqual(sparkleDots("abd", 100, 20));
  });

  it("puts a date and time only on the first message and after an hour or more of quiet", () => {
    const at = new Date(2026, 10, 21, 20, 2).getTime();
    expect(stampBefore(at, null)).toBe(true);
    expect(stampBefore(at, at - 59 * 60_000)).toBe(false);
    expect(stampBefore(at, at - STAMP_GAP_MS)).toBe(true);
    expect(stampBefore(at, at - 3 * 86_400_000)).toBe(true);
  });

  it("writes the time as month/day and the clock, with no year", () => {
    expect(stampText(new Date(2026, 10, 21, 20, 2).getTime())).toBe("11/21 · 8:02 PM");
    expect(stampText(new Date(2027, 2, 5, 0, 5).getTime())).toBe("3/5 · 12:05 AM");
    expect(stampText(new Date(2026, 0, 9, 12, 30).getTime())).toBe("1/9 · 12:30 PM");
    expect(stampText(new Date(2026, 6, 4, 9, 0).getTime())).toBe("7/4 · 9:00 AM");
  });
});
