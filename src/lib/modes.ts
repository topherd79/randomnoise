// Game modes: how many songs are open at a time. Pure logic (no server
// imports) so it can be unit tested and used by the start-a-game form.
//
// The first three modes work the same way: songs open in rounds, and the next
// round opens once every player has answered every song in the current one.
// Pass the Aux ("aux") is different: everyone is in one room and players take
// turns, one song each (see src/lib/aux.ts). Its songs still go one at a time,
// so the round helpers below treat it like The OG.

export const GAME_MODES = ["og", "three", "all", "aux"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const MODES: Record<GameMode, { name: string; description: string; lengths: readonly number[]; defaultLength: number }> = {
  og: {
    name: "The OG",
    description: "One song at a time. The next song opens once everyone has answered.",
    lengths: [5, 10, 15, 20, 25],
    defaultLength: 10,
  },
  three: {
    name: "3 songs",
    description: "Three songs at a time. The next three open once everyone has played all three.",
    lengths: [6, 9, 15, 18],
    defaultLength: 9,
  },
  all: {
    name: "All songs",
    description: "Every song is open from the start. Play at your own pace; the game ends when everyone is done.",
    lengths: [5, 10, 15, 20, 25],
    defaultLength: 10,
  },
  aux: {
    name: "Pass the Aux",
    description:
      "Everyone in one room. Players take turns: only the player whose turn it is hears the song and answers; everyone else watches live. 2 to 5 players.",
    // 5 songs a player (see AUX_SONGS_PER_PLAYER in aux.ts): set by the number of players.
    lengths: [10, 15, 20, 25],
    defaultLength: 10,
  },
};

export function isGameMode(s: unknown): s is GameMode {
  return typeof s === "string" && (GAME_MODES as readonly string[]).includes(s);
}

/** Every game length any mode allows, shortest first. */
export const ALL_LENGTHS = [...new Set(GAME_MODES.flatMap((m) => MODES[m].lengths))].sort((a, b) => a - b);

/** How many songs open at once. */
export function roundSize(mode: GameMode, songCount: number): number {
  return mode === "three" ? 3 : mode === "all" ? songCount : 1;
}

export type Round = { start: number; end: number };

/** The open round: from the game's current position to the end of its round. */
export function openRound(mode: GameMode, songCount: number, currentPosition: number): Round {
  return { start: currentPosition, end: Math.min(currentPosition + roundSize(mode, songCount) - 1, songCount) };
}

export const inRound = (round: Round, position: number) => position >= round.start && position <= round.end;

/** The song a player plays next in the open round (the lowest one they haven't answered), or null if they're done. */
export function nextPosition(round: Round, answered: ReadonlySet<number>): number | null {
  for (let p = round.start; p <= round.end; p++) if (!answered.has(p)) return p;
  return null;
}

/** How many songs in the open round a player still has to answer. */
export function songsLeft(round: Round, answered: ReadonlySet<number>): number {
  let n = 0;
  for (let p = round.start; p <= round.end; p++) if (!answered.has(p)) n++;
  return n;
}

/** "Song 4", "Songs 4–6" or "All 10 songs", for headers. */
export function roundLabel(mode: GameMode, songCount: number, round: Round): string {
  if (mode === "all") return `All ${songCount} songs`;
  return round.start === round.end ? `Song ${round.start} of ${songCount}` : `Songs ${round.start}–${round.end} of ${songCount}`;
}

/** What the group is waiting for, in plain words. */
export function waitingNote(mode: GameMode, round: Round, songCount: number): string {
  if (mode === "all") return "The final results are in once everyone has played every song.";
  const last = round.end >= songCount;
  if (round.start === round.end) return last ? "The final results are in once everyone has answered." : "The next song opens once everyone has answered.";
  return last ? "The final results are in once everyone has played these songs." : "The next songs open once everyone has played these.";
}

/** "Dave", "Dave and Mike", "Dave, Mike and Sarah". */
export function listNames(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** "Dave and Mike", or with several songs open, "Dave (2 songs left) and Mike (1 song left)". */
export function waitingOnText(waiters: { name: string; left: number }[], roundLength: number): string {
  if (roundLength <= 1) return listNames(waiters.map((w) => w.name));
  return listNames(waiters.map((w) => `${w.name} (${w.left} ${w.left === 1 ? "song" : "songs"} left)`));
}

/**
 * For the one player holding up the open round, once everyone else is done:
 * "Sarah and Topher are waiting on you." or, with several songs left, "…waiting
 * on your last 4 songs." Null while anyone else still has songs to play, or
 * when nobody else is in the game.
 */
export function waitingOnYouText(others: { name: string; left: number }[], myLeft: number): string | null {
  if (others.length === 0 || myLeft === 0 || others.some((o) => o.left > 0)) return null;
  const who = `${listNames(others.map((o) => o.name))} ${others.length === 1 ? "is" : "are"} waiting on`;
  return myLeft === 1 ? `${who} you.` : `${who} your last ${myLeft} songs.`;
}
