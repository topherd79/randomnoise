// Chat rules. Pure logic (no server imports) so it can be unit tested and
// shared by the server and the chat panel.
//
// One chat per exact group of players, kept across games. A message is held
// back (shown as sparkles) from anyone who hasn't played as far as its writer
// had, so chat never gives an answer away.

export const MAX_MESSAGE_LENGTH = 500;
/** How many of a chat's latest messages the panel loads. */
export const CHAT_PAGE = 200;

/** The reactions, in the order the picker shows them. */
export const REACTIONS = [
  { kind: "like", emoji: "👍" },
  { kind: "love", emoji: "❤️" },
  { kind: "haha", emoji: "😂" },
  { kind: "fire", emoji: "🔥" },
  { kind: "wow", emoji: "😮" },
  { kind: "music", emoji: "🎵" },
] as const;
export type ReactionKind = (typeof REACTIONS)[number]["kind"];

export const isReactionKind = (s: unknown): s is ReactionKind =>
  typeof s === "string" && REACTIONS.some((r) => r.kind === s);

export const reactionEmoji = (kind: string) => REACTIONS.find((r) => r.kind === kind)?.emoji ?? "";

/** A group's key: its members' ids, sorted, joined with commas (the database's uuid order is the same). */
export function memberKey(userIds: string[]): string {
  return [...new Set(userIds)].sort().join(",");
}

/** What's left to send of a typed message, or null if there's nothing to send. */
export function cleanMessage(text: string): string | null {
  const t = text.replace(/\r\n?/g, "\n").trim();
  if (!t) return null;
  return t.slice(0, MAX_MESSAGE_LENGTH);
}

export type ChatHold = { gameId: string; position: number };

/** How far a reader has got in one game. */
export type ReaderProgress = {
  /** Still being played (once a game is over, everything shows). */
  active: boolean;
  /** The reader plays in this game (anyone else can't spoil it). */
  inGame: boolean;
  /** The songs the reader has answered. */
  answered: ReadonlySet<number>;
};

/**
 * Null if the reader may see the message; otherwise the song they need to
 * play first (the furthest one, when several games hold it back).
 */
export function heldUntil(holds: ChatHold[], progress: ReadonlyMap<string, ReaderProgress>): number | null {
  let until: number | null = null;
  for (const h of holds) {
    const p = progress.get(h.gameId);
    if (!p || !p.active || !p.inGame) continue;
    if (!p.answered.has(h.position)) until = Math.max(until ?? 0, h.position);
  }
  return until;
}

/**
 * Each reaction kind on a message, how many, and whether one is mine, in the
 * picker's order.
 */
export function reactionCounts(reactions: { userId: string; kind: string }[], me: string) {
  return REACTIONS.flatMap((r) => {
    const of = reactions.filter((x) => x.kind === r.kind);
    return of.length ? [{ kind: r.kind, emoji: r.emoji, count: of.length, mine: of.some((x) => x.userId === me) }] : [];
  });
}

/** This much quiet between two messages puts a date and time between them. */
export const STAMP_GAP_MS = 60 * 60 * 1000;

/**
 * Whether a message gets a date and time above it: the first message, and any
 * message an hour or more after the one before. No time on every bubble.
 */
export function stampBefore(at: number, previousAt: number | null): boolean {
  return previousAt === null || at - previousAt >= STAMP_GAP_MS;
}

/** "11/21 · 8:02 PM", in the phone's own time; no year. */
export function stampText(at: number): string {
  const d = new Date(at);
  const h = d.getHours();
  return `${d.getMonth() + 1}/${d.getDate()} · ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Mike, Sarah and you", for a chat's title (the other members by name, then you). */
export function chatTitle(otherNames: string[]): string {
  const names = [...otherNames].sort((a, b) => a.localeCompare(b));
  if (names.length === 0) return "Just you";
  if (names.length === 1) return `${names[0]} and you`;
  return `${names.join(", ")} and you`;
}

/**
 * A sparkle bubble's width for a held-back message: varied from message to
 * message, but from its id, never its length (which would hint at the words).
 */
export function sparkleWidth(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return 90 + (Math.abs(h) % 110);
}

/** The specks of a sparkle bubble: always the same for the same message, never from its words. */
export function sparkleDots(id: string, width: number, height: number) {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) | 0;
  const next = () => {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: Math.round((width * height) / 15) }, (_, i) => ({
    x: 1 + next() * (width - 2),
    y: 1 + next() * (height - 2),
    r: [0.55, 0.7, 0.85, 1.1][Math.floor(next() * 4)],
    o: [0.35, 0.55, 0.75, 1][Math.floor(next() * 4)],
    light: next() < 0.7,
    /** Which of three twinkle rhythms it follows. */
    group: i % 3,
  }));
}
