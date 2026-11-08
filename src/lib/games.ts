import "server-only";
import { randomBytes } from "node:crypto";
import { copyFile } from "node:fs/promises";
import { after } from "next/server";
import { and, between, count, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
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
  type GameMode,
  type SongSnapshot,
  type WrongAnswerMode,
} from "@/db/schema";
import { cutClip, probe } from "./audio";
import { publishGameUpdate } from "./live";
import { filterKey, hasFilters, matchesFilters, NO_FILTERS, type SongFilters } from "./song-filters";
import { createLoginUrl } from "./auth";
import { usedSongIdsSql } from "./catalog-queries";
import { pickClipStart } from "./clips";
import { gameOnEmail, gameOverEmail, nudgeEmail, sendEmail } from "./email";
import { maxSongsPerArtist, pickSpreadOut, pickWrongAnswers, shuffle } from "./draw";
import { scoreAnswer } from "./rules";
import { inRound, MODES, nextPosition, openRound, songsLeft } from "./modes";
import { ensureFolder, filePath, removeFile } from "./storage";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Creating a game
// ---------------------------------------------------------------------------

/**
 * Which songs a new game may use:
 * - new: only songs no earlier game has used (the default)
 * - mix: new songs first, then songs from earlier games, the ones played longest ago first
 */
export type SongPool = "new" | "mix";

/** Same normalization as filterKey() in song-filters.ts, in SQL. */
const filterKeySql = (col: typeof songs.artist | typeof songs.genre) =>
  sql`lower(regexp_replace(trim(${col}), '\\s+', ' ', 'g'))`;

/** SQL conditions for the game form's filters (any option within a filter, every filter). */
function filterConditions(f: SongFilters) {
  const conds = [];
  if (f.decades.length) conds.push(inArray(sql`(${songs.year} / 10) * 10`, f.decades));
  if (f.genres.length) conds.push(inArray(filterKeySql(songs.genre), f.genres.map(filterKey)));
  if (f.artists.length) conds.push(inArray(filterKeySql(songs.artist), f.artists.map(filterKey)));
  return conds;
}

export async function createGame(opts: {
  playerIds: string[];
  songCount: number;
  clipLengthSec: number;
  wrongAnswers: WrongAnswerMode;
  mode?: GameMode;
  songPool?: SongPool;
  filters?: SongFilters;
  createdBy: string;
}): Promise<Result<{ gameId: string }>> {
  const { playerIds, songCount, clipLengthSec, wrongAnswers, mode = "og", songPool = "new", filters = NO_FILTERS, createdBy } = opts;
  if (!MODES[mode].lengths.includes(songCount)) {
    return { ok: false, error: `${MODES[mode].name} games are ${MODES[mode].lengths.join(", ")} songs long.` };
  }
  const filtered = hasFilters(filters);
  const matching = filterConditions(filters);

  const players = await db.select({ id: users.id }).from(users).where(inArray(users.id, playerIds));
  if (players.length !== playerIds.length) return { ok: false, error: "One of those players no longer exists." };

  // Inactive songs are left out entirely: never drawn, never a wrong answer.
  // Candidates are just id + artist; full rows are loaded for the songs picked.
  const fresh = await db
    .select({ id: songs.id, artist: songs.artist })
    .from(songs)
    .where(and(eq(songs.active, true), sql`${songs.id} not in ${usedSongIdsSql}`, ...matching))
    .orderBy(sql`random()`);
  // With "include songs from earlier games", those come after the new ones,
  // the ones played longest ago first.
  const earlier =
    songPool === "mix"
      ? await db
          .select({ id: songs.id, artist: songs.artist })
          .from(songs)
          .where(and(eq(songs.active, true), sql`${songs.id} in ${usedSongIdsSql}`, ...matching))
          .orderBy(
            sql`(select max(g.created_at) from game_songs gs join games g on g.id = gs.game_id where gs.song_id = ${songs.id}) asc nulls first`,
            sql`random()`,
          )
      : [];
  // No more than one song per artist for every five in the game, where the catalog allows.
  const chosen = pickSpreadOut(fresh, earlier, songCount, maxSongsPerArtist(songCount));
  if (chosen.length < songCount) {
    const drawn = chosen;
    const which = filtered ? " that match these filters" : "";
    return {
      ok: false,
      error:
        songPool === "mix"
          ? `There are only ${drawn.length} switched-on songs${which}. ${filtered ? "Loosen the filters" : "Add or turn on more songs"}, or pick a shorter game.`
          : `There are only ${drawn.length} new songs${which} (switched on, not played yet). Include songs from earlier games, ${filtered ? "loosen the filters" : "add or turn on more songs"}, or pick a shorter game.`,
    };
  }
  // Load the picked songs, in a shuffled play order (so songs from earlier games
  // aren't bunched at the end).
  const rowsById = new Map(
    (await db.select().from(songs).where(inArray(songs.id, chosen.map((c) => c.id)))).map((r) => [r.id, r]),
  );
  const drawn = shuffle(chosen).flatMap((c) => (rowsById.has(c.id) ? [rowsById.get(c.id)!] : []));
  if (drawn.length < songCount) return { ok: false, error: "Some songs changed while the game was being made. Try again." };
  const pool = await db
    .select({ id: songs.id, title: songs.title, artist: songs.artist, year: songs.year, genre: songs.genre })
    .from(songs)
    .where(eq(songs.active, true));
  // Wrong answers come from the same filtered set when it's big enough (a Queen-only
  // game gets Queen songs as wrong answers), otherwise from the whole catalog.
  const filteredPool = filtered ? pool.filter((c) => matchesFilters(c, filters)) : pool;
  const inThisGame = new Set(drawn.map((s) => s.id));

  await ensureFolder("clips");
  const made: string[] = [];
  try {
    const rows: (typeof gameSongs.$inferInsert)[] = [];
    for (const [i, song] of drawn.entries()) {
      let wrong = pickWrongAnswers(song, filteredPool, inThisGame, wrongAnswers);
      if (wrong.length < 3) wrong = pickWrongAnswers(song, pool, inThisGame, wrongAnswers);
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
      // A snapshot of the song, so this game's history survives later edits or deletion.
      const snapshot: SongSnapshot = {
        title: song.title,
        artist: song.artist,
        album: song.album,
        year: song.year,
        genre: song.genre,
        artworkUrl: song.artworkUrl,
        appleMusicUrl: song.appleMusicUrl,
        spotifyUrl: song.spotifyUrl,
      };
      rows.push({ gameId: "", position: i + 1, songId: song.id, song: snapshot, clipFile, clipStartSec: start, clipLengthSec: length, choices });
    }

    const gameId = await db.transaction(async (tx) => {
      const [game] = await tx
        .insert(games)
        .values({ songCount, clipLengthSec, wrongAnswers, mode, createdBy })
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

/** A game song, if the player is in its game. */
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

type GameRow = typeof games.$inferSelect;

/**
 * The open round of a game, and which of its songs each player has answered.
 * With The OG the round is the one current song; with 3 songs it's three; with
 * All songs it's the whole game.
 */
export async function roundState(game: Pick<GameRow, "id" | "mode" | "songCount" | "currentPosition">) {
  const round = openRound(game.mode, game.songCount, game.currentPosition);
  const rows = await db
    .select({ userId: answers.userId, position: gameSongs.position })
    .from(answers)
    .innerJoin(gameSongs, eq(gameSongs.id, answers.gameSongId))
    .where(and(eq(gameSongs.gameId, game.id), isNotNull(answers.answeredAt), between(gameSongs.position, round.start, round.end)));
  const byPlayer = new Map<string, Set<number>>();
  for (const r of rows) {
    if (!byPlayer.has(r.userId)) byPlayer.set(r.userId, new Set());
    byPlayer.get(r.userId)!.add(r.position);
  }
  const answered = (userId: string): ReadonlySet<number> => byPlayer.get(userId) ?? new Set<number>();
  return { round, answered };
}

/**
 * Whether a player may fetch a clip: they're in its game, and it's a song
 * they've reached (their next song or one they've answered), never a song
 * ahead of that, even when several are open at once.
 */
export async function mayPlayClip(userId: string, clipFile: string): Promise<boolean> {
  const [row] = await db
    .select({ position: gameSongs.position, game: games })
    .from(gameSongs)
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, userId)))
    .where(eq(gameSongs.clipFile, clipFile))
    .limit(1);
  if (!row) return false;
  if (row.game.status !== "active") return true; // (an ended game's clips are deleted anyway)
  const { round, answered } = await roundState(row.game);
  if (row.position < round.start) return true;
  if (!inRound(round, row.position)) return false;
  const next = nextPosition(round, answered(userId));
  return next === null || row.position <= next;
}

/** Tapping Play: the server's clock starts now. Calling it again keeps the original start. */
export async function startSong(userId: string, gameSongId: string): Promise<Result<{ startedAt: number }>> {
  const row = await playableRound(userId, gameSongId);
  if (!row) return { ok: false, error: "That song isn't part of your game." };
  const { gs, game } = row;
  if (game.status !== "active" || gs.completedAt) return { ok: false, error: "This song isn't being played right now." };
  // Only the player's next song: the lowest one in the open round they haven't answered.
  const { round, answered } = await roundState(game);
  if (!inRound(round, gs.position) || nextPosition(round, answered(userId)) !== gs.position) {
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
  const row = await playableRound(userId, gameSongId);
  if (!row) return { ok: false, error: "That song isn't part of your game." };
  const { gs, game } = row;

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
  const round = openRound(game.mode, game.songCount, game.currentPosition);
  if (game.status !== "active" || !inRound(round, gs.position) || gs.completedAt) {
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

  await completeSongIfDone(gs.id);
  // Others see their "waiting on" list shrink and this pick appear (once they've
  // answered the song themselves) without refreshing.
  await publishGameUpdate(game.id);
  return { ok: true, result: { correct, points, elapsedMs, rightSongId: gs.songId, choiceSongId } };
}

/**
 * When every player has answered a song: mark it complete (once, even if two
 * answers land together), delete its clip, and move the game on if that
 * finished the round.
 */
export async function completeSongIfDone(gameSongId: string): Promise<void> {
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

  // Everyone has heard this clip and nobody can play it again: free the space.
  await removeFile("clips", gs.clipFile).catch((err) => console.error("Couldn't delete clip", gs.clipFile, err));
  await advanceIfRoundDone(game.id);
  await publishGameUpdate(game.id);
}

/**
 * Once every song in the open round is complete, open the next round, or
 * finish the game (with one results email) if that was the last.
 */
async function advanceIfRoundDone(gameId: string): Promise<void> {
  const [game] = await db.select().from(games).where(eq(games.id, gameId)).limit(1);
  if (!game || game.status !== "active") return;
  const round = openRound(game.mode, game.songCount, game.currentPosition);
  const [{ open }] = await db
    .select({ open: count() })
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, gameId), between(gameSongs.position, round.start, round.end), isNull(gameSongs.completedAt)));
  if (open > 0) return;

  const last = round.end >= game.songCount;
  // Only the first caller moves the game on (two songs can complete at the same moment).
  const moved = await db
    .update(games)
    .set(last ? { status: "finished", finishedAt: new Date() } : { currentPosition: round.end + 1 })
    .where(and(eq(games.id, gameId), eq(games.status, "active"), eq(games.currentPosition, round.start)))
    .returning({ id: games.id });
  if (!moved.length) return;
  await publishGameUpdate(gameId);
  // One email at the end with the full results (no email after every song;
  // the waiting screens update live instead).
  if (last) after(() => emailPlayers(gameId, { kind: "over" }));
}

/**
 * Total points from completed songs (ones every player has answered), best
 * first, so the standings always compare like with like.
 */
export async function standings(gameId: string) {
  const rows = await db.execute<{ user_id: string; name: string; points: string; correct: string; played: string }>(sql`
    select u.id as user_id, u.name,
      coalesce(sum(a.points) filter (where gs.completed_at is not null), 0) as points,
      count(a.id) filter (where gs.completed_at is not null and a.correct) as correct,
      count(a.id) filter (where a.answered_at is not null) as played
    from game_players gp
    join users u on u.id = gp.user_id
    left join game_songs gs on gs.game_id = gp.game_id
    left join answers a on a.game_song_id = gs.id and a.user_id = gp.user_id
    where gp.game_id = ${gameId}
    group by u.id, u.name
    order by points desc, u.name asc
  `);
  return rows.rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    points: Number(r.points),
    correct: Number(r.correct),
    /** Songs this player has answered, including ones others haven't yet (not counted in points). */
    played: Number(r.played),
  }));
}

export type Standing = Awaited<ReturnType<typeof standings>>[number];

// ---------------------------------------------------------------------------
// Nudges, resets, ending a game
// ---------------------------------------------------------------------------

const NUDGE_EVERY_HOURS = 6;

export async function nudge(fromUserId: string, gameId: string, toUserId: string): Promise<Result<{ message: string }>> {
  if (fromUserId === toUserId) return { ok: false, error: "You can't nudge yourself." };
  const [row] = await db
    .select({ game: games })
    .from(games)
    .innerJoin(gamePlayers, and(eq(gamePlayers.gameId, games.id), eq(gamePlayers.userId, fromUserId)))
    .where(eq(games.id, gameId))
    .limit(1);
  if (!row) return { ok: false, error: "That isn't your game." };
  const { game } = row;
  if (game.status !== "active") return { ok: false, error: "This game is over." };

  const [target] = await db
    .select({ name: users.name, email: users.email })
    .from(gamePlayers)
    .innerJoin(users, eq(users.id, gamePlayers.userId))
    .where(and(eq(gamePlayers.gameId, game.id), eq(gamePlayers.userId, toUserId)))
    .limit(1);
  if (!target) return { ok: false, error: "They aren't in this game." };
  const { round, answered } = await roundState(game);
  const next = nextPosition(round, answered(toUserId));
  if (next === null) return { ok: false, error: `${target.name} has already played ${round.start === round.end ? "this song" : "these songs"}.` };
  const left = songsLeft(round, answered(toUserId));

  // Nudges are kept against the round's first song, so the limit is per round.
  const [roundSong] = await db
    .select({ id: gameSongs.id })
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, game.id), eq(gameSongs.position, round.start)))
    .limit(1);
  if (!roundSong) return { ok: false, error: "This game has no song to play right now." };
  const since = new Date(Date.now() - NUDGE_EVERY_HOURS * 3600_000);
  const [recent] = await db
    .select({ id: nudges.id })
    .from(nudges)
    .where(
      and(
        eq(nudges.gameSongId, roundSong.id),
        eq(nudges.fromUserId, fromUserId),
        eq(nudges.toUserId, toUserId),
        gt(nudges.createdAt, since),
      ),
    )
    .limit(1);
  if (recent) return { ok: false, error: `You nudged ${target.name} recently. Give it a few hours.` };

  await db.insert(nudges).values({ gameSongId: roundSong.id, fromUserId, toUserId });
  const [from] = await db.select({ name: users.name }).from(users).where(eq(users.id, fromUserId)).limit(1);
  after(async () => {
    try {
      const url = await createLoginUrl(toUserId, `/game/${game.id}`);
      await sendEmail({ to: target.email, ...nudgeEmail(target.name, url, from?.name ?? "Someone", { position: next, left }) });
    } catch (err) {
      console.error("Nudge email failed", err);
    }
  });
  return { ok: true, message: `Nudged ${target.name}.` };
}

/**
 * Admin: clear a player's attempt at a song in the open round (for genuine
 * accidents, like a phone call), so they play it again from the start. Any
 * song after it that they had started but not answered is cleared too, so its
 * clock doesn't keep running while they replay this one.
 */
export async function resetAttempt(gameSongId: string, userId: string): Promise<Result> {
  const [row] = await db
    .select({ gs: gameSongs, game: games })
    .from(gameSongs)
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .where(eq(gameSongs.id, gameSongId))
    .limit(1);
  if (!row) return { ok: false, error: "That song isn't in a game." };
  const { gs, game } = row;
  if (gs.completedAt) return { ok: false, error: "Everyone has answered this song, so it can't be reset." };
  const round = openRound(game.mode, game.songCount, game.currentPosition);
  const laterUnanswered = db
    .select({ id: gameSongs.id })
    .from(gameSongs)
    .where(and(eq(gameSongs.gameId, game.id), gt(gameSongs.position, gs.position), lte(gameSongs.position, round.end)));
  await db
    .delete(answers)
    .where(
      and(
        eq(answers.userId, userId),
        or(eq(answers.gameSongId, gameSongId), and(inArray(answers.gameSongId, laterUnanswered), isNull(answers.answeredAt))),
      ),
    );
  await publishGameUpdate(gs.gameId);
  return { ok: true };
}

export async function cancelGame(gameId: string): Promise<void> {
  const ended = await db
    .update(games)
    .set({ status: "cancelled", finishedAt: new Date() })
    .where(and(eq(games.id, gameId), eq(games.status, "active")))
    .returning({ id: games.id });
  if (ended.length) {
    // The game is over, so none of its clips will be played again.
    const clips = await db.select({ file: gameSongs.clipFile }).from(gameSongs).where(eq(gameSongs.gameId, gameId));
    await Promise.all(clips.map((c) => removeFile("clips", c.file).catch(() => {})));
  }
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
    const round = openRound(game.mode, game.songCount, game.currentPosition);
    const open = await db
      .select({ id: gameSongs.id })
      .from(gameSongs)
      .where(and(eq(gameSongs.gameId, gameId), gte(gameSongs.position, round.start), lte(gameSongs.position, round.end)))
      .orderBy(gameSongs.position);
    for (const gs of open) await completeSongIfDone(gs.id);
    await advanceIfRoundDone(gameId);
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
            ? gameOnEmail(p.name, url, { songCount: game.songCount, mode: game.mode, others })
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
