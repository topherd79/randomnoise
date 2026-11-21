import { describe, expect, it } from "vitest";
import {
  afterOutText,
  outNotice,
  PLAY_ON_WAIT_HOURS,
  PLAY_ON_WAIT_HOURS_TWO,
  playOnConfirmText,
  playOnHomeText,
  playOnView,
  playOnWaitMs,
  votePasses,
  wentOnText,
} from "@/lib/play-on";

const H = 3_600_000;
const done = Date.UTC(2026, 10, 21, 18, 10);
const four = [
  { userId: "mike", name: "Mike", left: 0 },
  { userId: "sarah", name: "Sarah", left: 0 },
  { userId: "topher", name: "Topher", left: 0 },
  { userId: "dave", name: "Dave", left: 3 },
];
const view = (me: string, votes: string[] = [], now = done + 5 * H, players = four) =>
  playOnView({ me, players, othersDoneAt: done, votes: new Set(votes), now });

describe("playing on without the one player holding a game up", () => {
  it("waits 4 hours with 3 or more players, 10 hours with two", () => {
    expect(PLAY_ON_WAIT_HOURS).toBe(4);
    expect(PLAY_ON_WAIT_HOURS_TWO).toBe(10);
    expect(playOnWaitMs(4)).toBe(4 * H);
    expect(playOnWaitMs(3)).toBe(4 * H);
    expect(playOnWaitMs(2)).toBe(10 * H);
  });

  it("only when exactly one player is left, and never shown to that player", () => {
    expect(view("mike")).toMatchObject({ target: { userId: "dave", name: "Dave" }, open: true, hoursWaiting: 5, alone: false });
    expect(view("dave")).toBeNull(); // never told
    const two = four.map((p) => (p.userId === "sarah" ? { ...p, left: 1 } : p));
    expect(view("mike", [], done + 5 * H, two)).toBeNull(); // two people behind: no vote
    expect(view("mike", [], done + 5 * H, four.map((p) => ({ ...p, left: 0 })))).toBeNull(); // nobody behind
    expect(playOnView({ me: "mike", players: four, othersDoneAt: null, votes: new Set(), now: done })).toBeNull();
    expect(view("zed")).toBeNull(); // not in the game
  });

  it("opens 4 hours after the last of the others finished, and says how long until then", () => {
    const early = view("mike", [], done + 3 * H)!;
    expect(early.open).toBe(false);
    expect(early.opensAt).toBe(done + 4 * H);
    expect(early.opensInMs).toBe(H);
    expect(view("mike", [], done + 4 * H)!.open).toBe(true);
  });

  it("lists the voters, you first, and needs every one of them", () => {
    const v = view("sarah", ["mike"])!;
    expect(v.voters.map((x) => [x.name, x.voted, x.me])).toEqual([
      ["Sarah", false, true],
      ["Mike", true, false],
      ["Topher", false, false],
    ]);
    expect(v.iVoted).toBe(false);
    expect(votePasses(["mike", "sarah", "topher"], new Set(["mike", "sarah"]))).toBe(false);
    expect(votePasses(["mike", "sarah", "topher"], new Set(["mike", "sarah", "topher"]))).toBe(true);
    expect(votePasses([], new Set())).toBe(false);
  });

  it("in a game of two, the other player decides alone after 10 hours", () => {
    const pair = [
      { userId: "sarah", name: "Sarah", left: 0 },
      { userId: "dave", name: "Dave", left: 2 },
    ];
    expect(view("sarah", [], done + 9 * H, pair)!.open).toBe(false);
    const v = view("sarah", [], done + 10 * H, pair)!;
    expect(v).toMatchObject({ open: true, alone: true });
    expect(v.voters.map((x) => x.name)).toEqual(["Sarah"]);
    expect(playOnConfirmText(v, "songs 7–9 open for the rest of you")).toBe("Dave leaves this game and you finish it alone.");
  });

  it("words the confirm sheet, the home card and what opens next", () => {
    expect(afterOutText({ start: 4, end: 6 }, 3, 9)).toBe("songs 7–9 open for the rest of you");
    expect(afterOutText({ start: 4, end: 4 }, 1, 10)).toBe("song 5 opens for the rest of you");
    expect(afterOutText({ start: 7, end: 9 }, 3, 9)).toBe("the final results are in");
    expect(afterOutText({ start: 1, end: 10 }, 10, 10)).toBe("the final results are in");

    const after = "songs 7–9 open for the rest of you";
    expect(playOnConfirmText(view("mike")!, after)).toBe("Once Sarah and Topher vote too, Dave leaves this game and songs 7–9 open for the rest of you.");
    expect(playOnConfirmText(view("mike", ["sarah"])!, after)).toBe("Once Topher votes too, Dave leaves this game and songs 7–9 open for the rest of you.");
    expect(playOnConfirmText(view("mike", ["sarah", "topher"])!, after)).toBe("Yours is the last vote: Dave leaves this game and songs 7–9 open for the rest of you.");

    expect(playOnHomeText(view("sarah"))).toBeNull(); // nobody has voted yet
    expect(playOnHomeText(view("sarah", ["mike"]))).toEqual({ text: "Mike voted to play on without Dave. Your vote?", mine: false });
    expect(playOnHomeText(view("mike", ["mike"]))).toEqual({ text: "You voted to play on without Dave.", mine: true });
    expect(playOnHomeText(view("sarah", ["mike"], done + H))).toBeNull(); // not open yet
    expect(playOnHomeText(null)).toBeNull();
  });

  it("tells the others, and the player who's out, what happened", () => {
    expect(outNotice([], 3)).toBeNull();
    expect(outNotice([{ name: "Dave", by: "vote" }], 3)).toBe("You all voted to play on without Dave.");
    expect(outNotice([{ name: "Dave", by: "vote" }], 2)).toBe("You both voted to play on without Dave.");
    expect(outNotice([{ name: "Dave", by: "vote" }], 1)).toBe("You played on without Dave.");
    expect(outNotice([{ name: "Dave", by: "admin" }], 3)).toBe("Dave was taken out of this game.");
    expect(wentOnText("vote", ["Mike", "Sarah", "Topher"])).toBe("Everyone else voted to play on without you.");
    expect(wentOnText("vote", ["Sarah"])).toBe("Sarah played on without you.");
    expect(wentOnText("admin", ["Sarah"])).toBe("You were taken out of this game.");
  });
});
