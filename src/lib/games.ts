import "server-only";
import { randomBytes } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { after } from "next/server";
import { and, count, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  answers,
  gamePlayers,
  gameSongs,
  games,
  nudges,
  songs,
  users,
  type Choice,
  type WrongAnswerMode,
} from "@/db/schema";
import { cutClip, probe } from "./audio";
import { publishGameUpdate } from "./live";
import { createLoginUrl } from "./auth";
import { usedSongIdsSql } from "./catalog-queries";
import { pickClipStart } from "./clips";
import { gameOnEmail, gameOverEmail, nudgeEmail, sendEmail } from "./email";
import { normalize } from "./lookup";
import { scoreAnswer } from "./rules";
import { ensureFolder, filePath, removeFile } from "./storage";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Creating a game
// ---------------------------------------------------------------------------

type Candidate = { id: string; title: string; artist: string; year: number | null; genre: string | null };

/** How unlike two songs are in era and genre (0 = same genre, same year). */
function distance(a: Candidate, b: Candidate): number {
  const ga = a.genre ? normalize(a.genre) : "";
  const gb = b.genre ? normalize(b.genre) : "";
  const genre = !ga || !gb ? 1 : ga === gb ? 0 : 2;
  const year = a.year && b.year ? Math.min(Math.abs(a.year - b.year) / 4, 3) : 1.5;
  return genre + year;
}

function shuffle<T>(list: T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Three wrong answers for a song: other catalog songs, at random or (for
 * "similar") from the closest era and genre, with a little randomness so it
 * isn't always the same three. Songs coming up later in the same game are
 * avoided where possible, since seeing one as a wrong answer would be a hint.
 */
export function pickWrongAnswers(
  answer: Candidate,
  pool: Candidate[],
  inThisGame: Set<string>,
  mode: WrongAnswerMode,
  random: () => number = Math.random,
): Candidate[] {
  const label = (c: Candidate) => `${normalize(c.title)}|${normalize(c.artist)}`;
  const order = (list: Candidate[]) =>
    mode === "similar"
      ? list
          .map((c) => ({ c, d: distance(answer, c) + random() * 0.75 }))
          .sort((x, y) => x.d - y.d)
          .map((x) => x.c)
      : shuffle(list, random);

  const others = pool.filter((c) => c.id !== answer.id);
  const preferred = others.filter((c) => !inThisGame.has(c.id));
  const fallback = others.filter((c) => inThisGame.has(c.id));
  const seen = new Set([label(answer)]);
  const out: Candidate[] = [];
  for (const c of [...order(preferred), ...order(fallback)]) {
    const l = label(c);
    if (seen.has(l)) continue; // the same song uploaded twice would look like two right answers
    seen.add(l);
    out.push(c);
    if (out.length === 3) break;
  }
  return out;
}

/**
 * Which songs a new game may use:
 * - new: only songs no earlier game has used (the default)
 * - mix: new songs first, then songs from earlier games, the ones played longest ago first
 */
export type SongPool = "new" | "mix";

export async function createGame(opts: {
  playerIds: string[];
  songCount: number;
  clipLengthSec: number;
  wrongAnswers: WrongAnswerMode;
  songPool?: SongPool;
  createdBy: string;
}): Promise<Result<{ gameId: string }>> {
  const { playerIds, songCount, clipLengthSec, wrongAnswers, songPool = "new", createdBy } = opts;

  const players = await db.select({ id: users.id }).from(users).where(inArray(users.id, playerIds));
  if (players.length !== playerIds.length) return { ok: false, error: "One of those players no longer exists." };

  // Inactive songs are left out entirely: never drawn, never a wrong answer.
  const fresh = await db
    .select()
    .from(songs)
    .where(and(eq(songs.active, true), sql`${songs.id} not in ${usedSongIdsSql}`))
    .orderBy(sql`random()`)
    .limit(songCount);
  let drawn = fresh;
  if (fresh.length < songCount && songPool === "mix") {
    // Top up with songs from earlier games, the ones played longest ago first,
    // then shuffle so the repeats aren't all bunched at the end of the game.
    const repeats = await db
      .select()
      .from(songs)
      .where(and(eq(songs.active, true), sql`${songs.id} in ${usedSongIdsSql}`))
      .orderBy(
        sql`(select max(g.created_at) from game_songs gs join games g on g.id = gs.game_id where gs.song_id = ${songs.id}) asc nulls first`,
        sql`random()`,
      )
      .limit(songCount - fresh.length);
    drawn = shuffle([...fresh, ...repeats], Math.random);
  }
  if (drawn.length < songCount) {
    return {
      ok: false,
      error:
        songPool === "mix"
          ? `There are only ${drawn.length} switched-on songs in the catalog. Add or turn on ${songCount - drawn.length} more, or pick a shorter game.`
          : `There are only ${drawn.length} new songs (switched on, not played yet). Include songs from earlier games, add or turn on ${songCount - drawn.length} more, or pick a shorter game.`,
    };
  }
  const pool = await db
    .select({ id: songs.id, title: songs.title, artist: songs.artist, year: songs.year, genre: songs.genre })
    .from(songs)
    .where(eq(songs.active, true));
  const inThisGame = new Set(drawn.map((s) => s.id));

  await ensureFolder("clips");
  const made: string[] = [];
  try {
    const rows: (typeof gameSongs.$inferInsert)[] = [];
    for (const [i, song] of drawn.entries()) {
      const wrong = pickWrongAnswers(song, pool, inThisGame, wrongAnswers);
      if (wrong.length < 3) {
        return { ok: false, error: "The catalog needs at least 4 different songs to make wrong answers." };
      }

      const clipFile = `${randomBytes(16).toString("hex")}.mp3`;
      let start = 0;
      let length: number;
      if (song.customClipFile) {
        // Already trimmed, faded and stripped of tags when it was uploaded.
        const src = filePath("custom-clips", song.customClipFile);
        length = (await probe(src))?.durationSec ?? 0;
        await copyFile(src, filePath("clips", clipFile));
      } else {
        length = Math.min(song.clipLengthSec ?? clipLengthSec, song.durationSec);
        start = pickClipStart(song, length);
        await cutClip({ input: filePath("songs", song.fileName), output: filePath("clips", clipFile), startSec: start, lengthSec: length });
      }
      made.push(clipFile);

      const choices: Choice[] = [song, ...wrong].map((c) => ({ songId: c.id, title: c.title, artist: c.artist }));
      rows.push({ gameId: "", position: i + 1, songId: song.id, clipFile, clipStartSec: start, clipLengthSec: length, choices });
    }

    const gameId = await db.transaction(async (tx) => {
      const [game] = await tx
        .insert(games)
        .values({ songCount, clipLengthSec, wrongAnswers, createdBy })
        .returning({ id: games.id });
      await tx.insert(gamePlayers).values(playerIds.map((userId) => ({ gameId: game.id, userId })));
      await tx.insert(gameSongs).values(rows.map((r) => ({ ...r, gameId: game.id })));
      return game.id;
    });
    made.length = 0; // keep the clips
    after(() => emailPlayers(gameId, { kind: "start" }));
    return { ok: true, gameId };
  } catch (err) {
    console.error("Creating a game failed", err);
    return { ok: false, error: "Something went wrong cutting the clips. Nothing was created; try again." };
  } finally {
    await Promise.all(made.map((f) => removeFile("clips", f)));
  }
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/** The round a player may act on right now: they're in the game and it's the current song. */
async function playableRound(userId: string, gameSongId: string) {
  const [row] = await db
    .select({ gs: gameSongs, game: games })
    .from(gameSongs)
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, userId)))
    .where(eq(gameSongs.id, gameSongId))
    .limit(1);
  if (!row) return null;
  return row;
}

/** Tapping Play: the server's clock starts now. Calling it again keeps the original start. */
export async function startSong(userId: string, gameSongId: string): Promise<Result<{ startedAt: number }>> {
  const round = await playableRound(userId, gameSongId);
  if (!round) return { ok: false, error: "That song isn't part of your game." };
  const { gs, game } = round;
  if (game.status !== "active" || gs.position !== game.currentPosition || gs.completedAt) {
    return { ok: false, error: "This song isn't being played right now." };
  }
  await db.insert(answers).values({ gameSongId, userId }).onConflictDoNothing();
  const [a] = await db
    .select({ startedAt: answers.startedAt })
    .from(answers)
    .where(and(eq(answers.gameSongId, gameSongId), eq(answers.userId, userId)))
    .limit(1);
  return { ok: true, startedAt: a.startedAt.getTime() };
}

export type AnswerResult = {
  correct: boolean;
  points: number;
  elapsedMs: number;
  rightSongId: string;
  choiceSongId: string;
};

/** A player's pick. The server decides whether it's right and how many points it's worth. */
export async function answerSong(
  userId: string,
  gameSongId: string,
  choiceSongId: string,
): Promise<Result<{ result: AnswerResult }>> {
  const round = await playableRound(userId, gameSongId);
  if (!round) return { ok: false, error: "That song isn't part of your game." };
  const { gs, game } = round;

  const [existing] = await db
    .select()
    .from(answers)
    .where(and(eq(answers.gameSongId, gameSongId), eq(answers.userId, userId)))
    .limit(1);
  if (existing?.answeredAt) {
    return {
      ok: true,
      result: {
        correct: Boolean(existing.correct),
        points: existing.points ?? 0,
        elapsedMs: existing.elapsedMs ?? 0,
        rightSongId: gs.songId,
        choiceSongId: existing.choiceSongId ?? "",
      },
    };
  }
  if (game.status !== "active" || gs.position !== game.currentPosition || gs.completedAt) {
    return { ok: false, error: "This song isn't being played right now." };
  }
  if (!existing) return { ok: false, error: "Tap Play first." };
  if (!gs.choices.some((c) => c.songId === choiceSongId)) return { ok: false, error: "That isn't one of the choices." };

  const now = new Date();
  const elapsedMs = Math.max(0, now.getTime() - existing.startedAt.getTime());
  const correct = choiceSongId === gs.songId;
  const points = scoreAnswer(correct, elapsedMs);
  const saved = await db
    .update(answers)
    .set({ answeredAt: now, choiceSongId, correct, elapsedMs, points })
    .where(and(eq(answers.id, existing.id), isNull(answers.answeredAt)))
    .returning({ id: answers.id });
  if (!saved.length) return answerSong(userId, gameSongId, choiceSongId); // a double tap: return the first answer

  await completeRoundIfDone(gs.id);
  // Others waiting on this song see "waiting on" shrink (or the results) without refreshing.
  await publishGameUpdate(game.id);
  return { ok: true, result: { correct, points, elapsedMs, rightSongId: gs.songId, choiceSongId } };
}

/**
 * When every player has answered the current song: mark it complete (once,
 * even if two answers land together), move the game on or finish it, and
 * email everyone.
 */
export async function completeRoundIfDone(gameSongId: string): Promise<void> {
  const [row] = await db
    .select({ gs: gameSongs, game: games })
    .from(gameSongs)
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .where(eq(gameSongs.id, gameSongId))
    .limit(1);
  if (!row || row.gs.completedAt || row.game.status !== "active") return;
  const { gs, game } = row;

  const [[{ players }], [{ answered }]] = await Promise.all([
    db.select({ players: count() }).from(gamePlayers).where(eq(gamePlayers.gameId, game.id)),
    db
      .select({ answered: count() })
      .from(answers)
      .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, game.id), eq(gamePlayers.userId, answers.userId)))
      .where(and(eq(answers.gameSongId, gs.id), isNotNull(answers.answeredAt))),
  ]);
  if (players === 0 || answered < players) return;

  const done = await db
    .update(gameSongs)
    .set({ completedAt: new Date() })
    .where(and(eq(gameSongs.id, gs.id), isNull(gameSongs.completedAt)))
    .returning({ id: gameSongs.id });
  if (!done.length) return;

  const last = gs.position >= game.songCount;
  await db
    .update(games)
    .set(last ? { status: "finished", finishedAt: new Date() } : { currentPosition: gs.position + 1 })
    .where(and(eq(games.id, game.id), eq(games.status, "active")));
  await publishGameUpdate(game.id);
  // One email at the end with the full results (no email after every song;
  // the waiting screens update live instead).
  if (last) after(() => emailPlayers(game.id, { kind: "over" }));
}

/** Total points from completed songs, best first. */
export async function standings(gameId: string) {
  const rows = await db.execute<{ user_id: string; name: string; points: string; correct: string }>(sql`
    select u.id as user_id, u.name,
      coalesce(sum(a.points) filter (where gs.completed_at is not null), 0) as points,
      count(a.id) filter (where gs.completed_at is not null and a.correct) as correct
    from game_players gp
    join users u on u.id = gp.user_id
    left join game_songs gs on gs.game_id = gp.game_id
    left join answers a on a.game_song_id = gs.id and a.user_id = gp.user_id
    where gp.game_id = ${gameId}
    group by u.id, u.name
    order by points desc, u.name asc
  `);
  return rows.rows.map((r) => ({ userId: r.user_id, name: r.name, points: Number(r.points), correct: Number(r.correct) }));
}

export type Standing = Awaited<ReturnType<typeof standings>>[number];

// ---------------------------------------------------------------------------
// Nudges, resets, ending a game
// ---------------------------------------------------------------------------

const NUDGE_EVERY_HOURS = 6;

export async function nudge(fromUserId: string, gameSongId: string, toUserId: string): Promise<Result<{ message: string }>> {
  if (fromUserId === toUserId) return { ok: false, error: "You can't nudge yourself." };
  const round = await playableRound(fromUserId, gameSongId);
  if (!round) return { ok: false, error: "That song isn't part of your game." };
  const { gs, game } = round;
  if (game.status !== "active" || gs.position !== game.currentPosition || gs.completedAt) {
    return { ok: false, error: "This song is already done." };
  }
  const [target] = await db
    .select({ name: users.name, email: users.email, answeredAt: answers.answeredAt })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .leftJoin(answers, and(eq(answers.gameSongId, gs.id), eq(answers.userId, users.id)))
    .where(and(eq(gamePlayers.gameId, game.id), eq(gamePlayers.userId, toUserId)))
    .limit(1);
  if (!target) return { ok: false, error: "They aren't in this game." };
  if (target.answeredAt) return { ok: false, error: `${target.name} has already answered.` };

  const since = new Date(Date.now() - NUDGE_EVERY_HOURS * 3600_000);
  const [recent] = await db
    .select({ id: nudges.id })
    .from(nudges)
    .where(
      and(
        eq(nudges.gameSongId, gs.id),
        eq(nudges.fromUserId, fromUserId),
        eq(nudges.toUserId, toUserId),
        gt(nudges.createdAt, since),
      ),
    )
    .limit(1);
  if (recent) return { ok: false, error: `You nudged ${target.name} recently. Give it a few hours.` };

  await db.insert(nudges).values({ gameSongId: gs.id, fromUserId, toUserId });
  const [from] = await db.select({ name: users.name }).from(users).where(eq(users.id, fromUserId)).limit(1);
  after(async () => {
    try {
      const url = await createLoginUrl(toUserId, `/game/${game.id}`);
      await sendEmail({ to: target.email, ...nudgeEmail(target.name, url, from?.name ?? "Someone", gs.position) });
    } catch (err) {
      console.error("Nudge email failed", err);
    }
  });
  return { ok: true, message: `Nudged ${target.name}.` };
}

/** Admin: clear a player's attempt at the current song (for genuine accidents, like a phone call). */
export async function resetAttempt(gameSongId: string, userId: string): Promise<Result> {
  const [gs] = await db.select().from(gameSongs).where(eq(gameSongs.id, gameSongId)).limit(1);
  if (!gs) return { ok: false, error: "That song isn't in a game." };
  if (gs.completedAt) return { ok: false, error: "Everyone has answered this song, so it can't be reset." };
  await db.delete(answers).where(and(eq(answers.gameSongId, gameSongId), eq(answers.userId, userId)));
  await publishGameUpdate(gs.gameId);
  return { ok: true };
}

export async function cancelGame(gameId: string): Promise<void> {
  await db
    .update(games)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(games.id, gameId), eq(games.status, "active")));
  await publishGameUpdate(gameId);
}

/** After a player is removed, the songs they were holding up can move on. */
export async function afterPlayerRemoved(gameIds: string[]): Promise<void> {
  for (const gameId of gameIds) {
    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game || game.status !== "active") continue;
    const [{ players }] = await db.select({ players: count() }).from(gamePlayers).where(eq(gamePlayers.gameId, gameId));
    if (players === 0) {
      await cancelGame(gameId);
      continue;
    }
    const [gs] = await db
      .select({ id: gameSongs.id })
      .from(gameSongs)
      .where(and(eq(gameSongs.gameId, gameId), eq(gameSongs.position, game.currentPosition)))
      .limit(1);
    if (gs) await completeRoundIfDone(gs.id);
    await publishGameUpdate(gameId); // the "waiting on" list changed
  }
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

type GameEmail = { kind: "start" } | { kind: "over" };

/** Email every player in a game, each with their own login button to the game. */
async function emailPlayers(gameId: string, what: GameEmail): Promise<void> {
  try {
    const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
    if (!game) return;
    const players = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(gamePlayers)
      .innerJoin(users, eq(users.id, gamePlayers.userId))
      .where(eq(gamePlayers.gameId, gameId));
    // game-view imports from this module, so load it lazily to avoid a cycle.
    const results =
      what.kind === "over" ? (await (await import("./game-view")).loadGameResults([gameId])).get(gameId) : undefined;
    if (what.kind === "over" && !results) return;

    for (const p of players) {
      try {
        const url = await createLoginUrl(p.id, `/game/${gameId}`);
        const others = players.filter((o) => o.id !== p.id).map((o) => o.name);
        const email =
          what.kind === "start"
            ? gameOnEmail(p.name, url, { songCount: game.songCount, others })
            : gameOverEmail(p.name, p.id, url, results!);
        await sendEmail({ to: p.email, ...email });
      } catch (err) {
        console.error(`Game email (${what.kind}) to ${p.email} failed`, err);
      }
    }
  } catch (err) {
    console.error("Game emails failed", err);
  }
}
