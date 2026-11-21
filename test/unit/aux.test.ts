import { describe, expect, it } from "vitest";
import {
  AUX_COUNTDOWN_MS,
  AUX_LOBBY_WAIT_MS,
  AUX_RESULT_MS,
  auxPhase,
  auxSongCount,
  clockStart,
  lapOf,
  lobbyStarter,
  MISSED_CUE_MS,
  nextTurnPosition,
  startWithoutAt,
  turnIndex,
  turnLengthMs,
} from "@/lib/aux";

describe("Pass the Aux turns", () => {
  it("is 5 songs a player", () => {
    expect([2, 3, 4, 5].map(auxSongCount)).toEqual([10, 15, 20, 25]);
  });

  it("ends a turn 5 s after the clip ends or the answers finish, whichever is later", () => {
    expect(turnLengthMs(5)).toBe(20_000); // the answers finish at 15 s
    expect(turnLengthMs(10)).toBe(20_000);
    expect(turnLengthMs(20)).toBe(25_000);
    expect(turnLengthMs(30)).toBe(35_000);
  });

  it("goes round the players in the same order every lap", () => {
    // 3 players: songs 1, 4, 7… are player 1's; 2, 5, 8… player 2's.
    expect([1, 2, 3, 4, 5, 6, 7].map((p) => turnIndex(p, 3))).toEqual([0, 1, 2, 0, 1, 2, 0]);
    expect([1, 3, 4, 6, 13, 15].map((p) => lapOf(p, 3))).toEqual([1, 1, 2, 2, 5, 5]);
  });

  it("finds a player's next song", () => {
    // 4 players, 20 songs. Player 2 (index 1) plays 2, 6, 10, 14, 18.
    expect(nextTurnPosition(1, 4, 1, 20)).toBe(2);
    expect(nextTurnPosition(1, 4, 2, 20)).toBe(2);
    expect(nextTurnPosition(1, 4, 3, 20)).toBe(6);
    expect(nextTurnPosition(1, 4, 18, 20)).toBe(18);
    expect(nextTurnPosition(1, 4, 19, 20)).toBeNull();
    expect(nextTurnPosition(0, 2, 1, 10)).toBe(1);
    expect(nextTurnPosition(0, 2, 10, 10)).toBeNull();
  });
});

describe("the lobby", () => {
  const t = 1_000_000;
  it("gives the Start button to the first player in turn order who's in", () => {
    expect(lobbyStarter([{ userId: "a", joinedAt: t }, { userId: "b", joinedAt: t }])).toBe("a");
    expect(lobbyStarter([{ userId: "a", joinedAt: null }, { userId: "b", joinedAt: t }])).toBe("b");
    expect(lobbyStarter([{ userId: "a", joinedAt: null }])).toBeNull();
  });

  it("offers Start without 30 s after the last I'm in, with at least two in", () => {
    const players = [
      { userId: "a", joinedAt: t },
      { userId: "b", joinedAt: t + 5000 },
      { userId: "c", joinedAt: null },
    ];
    expect(startWithoutAt(players)).toBe(t + 5000 + AUX_LOBBY_WAIT_MS);
    // Everyone's in: nobody to start without.
    expect(startWithoutAt(players.map((p) => ({ ...p, joinedAt: t })))).toBeNull();
    // Only one in: a game needs two.
    expect(startWithoutAt([{ userId: "a", joinedAt: t }, { userId: "b", joinedAt: null }])).toBeNull();
  });
});

describe("what every phone shows", () => {
  const startsAt = 100_000;
  const turn = { startsAt, endsAt: startsAt + 25_000 };
  const base = { status: "active" as const, started: true, turn, last: null };

  it("shows the lobby until the game starts", () => {
    expect(auxPhase({ ...base, started: false, turn: null }, 0).kind).toBe("lobby");
  });

  it("counts down 3-2-1 to the first song", () => {
    expect(auxPhase(base, startsAt - AUX_COUNTDOWN_MS)).toEqual({ kind: "countdown", seconds: 3 });
    expect(auxPhase(base, startsAt - 1500)).toEqual({ kind: "countdown", seconds: 2 });
    expect(auxPhase(base, startsAt - 1)).toEqual({ kind: "countdown", seconds: 1 });
    expect(auxPhase(base, startsAt).kind).toBe("turn");
  });

  it("shows the result for 3 s, then counts down to the next song", () => {
    const completedAt = startsAt - AUX_RESULT_MS - AUX_COUNTDOWN_MS;
    const s = { ...base, last: { completedAt } };
    expect(auxPhase(s, completedAt).kind).toBe("result");
    expect(auxPhase(s, completedAt + AUX_RESULT_MS - 1).kind).toBe("result");
    expect(auxPhase(s, completedAt + AUX_RESULT_MS)).toEqual({ kind: "countdown", seconds: 3 });
  });

  it("says time's up once the turn ends, until the server moves on", () => {
    expect(auxPhase(base, turn.endsAt - 1).kind).toBe("turn");
    expect(auxPhase(base, turn.endsAt).kind).toBe("timeUp");
  });

  it("shows the last result, then the recap, when the game finishes", () => {
    const done = { status: "finished" as const, started: true, turn: null, last: { completedAt: 500 } };
    expect(auxPhase(done, 500 + AUX_RESULT_MS - 1).kind).toBe("result");
    expect(auxPhase(done, 500 + AUX_RESULT_MS).kind).toBe("over");
    expect(auxPhase({ ...done, status: "cancelled" }, 501).kind).toBe("over");
  });

  it("starts everyone's clock on cue, then from the moment the clip really started", () => {
    expect(clockStart({ startsAt, startedAt: null }, startsAt + 100)).toBe(startsAt);
    expect(clockStart({ startsAt, startedAt: startsAt + 400 }, startsAt + 500)).toBe(startsAt + 400);
    // The turn player's phone missed its cue: no clock until it plays.
    expect(clockStart({ startsAt, startedAt: null }, startsAt + MISSED_CUE_MS)).toBeNull();
  });
});
