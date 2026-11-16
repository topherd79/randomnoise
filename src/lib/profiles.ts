import "server-only";
import { and, eq, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { answers, gameSongs, games, users, type GameMode } from "@/db/schema";
import {
  answerSummary,
  bestAndWorst,
  bestGuesses,
  decadeOf,
  genreOf,
  isWin,
  placeOf,
  resultText,
  type GameTotal,
  type GroupStat,
  type ScoredSong,
} from "./profile-stats";

// Player profiles and past games.
//
// Only games that are over count: finished games, plus the finished songs of
// games ended early (which count toward the numbers but not as a game played
// or won). A game still being played gives nothing away, to anyone, the admin
// included.

export type PastGame = {
  id: string;
  status: "finished" | "cancelled";
  mode: GameMode;
  songCount: number;
  /** Songs everyone answered (all of them, unless the game was ended early). */
  completed: number;
  /** When it finished (or was ended). */
  date: Date;
  /** This player's points, place (ties share a place) and how many played. */
  points: number;
  place: number;
  players: number;
  others: string[];
  /** "You won", "Dave won", "You and Dave tied", "Mike led"; empty for a game played alone. */
  result: string;
  won: boolean;
};

type PastRow = {
  id: string;
  status: "finished" | "cancelled";
  mode: GameMode;
  song_count: number;
  at_ms: string;
  completed: string;
  user_id: string;
  name: string;
  points: string;
};

/** Every game a player was in that's over (finished or ended early), newest first. */
export async function pastGames(userId: string): Promise<PastGame[]> {
  // Points as on the game page: every answer counts, as in standings().
  const rows = await db.execute<PastRow>(sql`
    select g.id, g.status, g.mode, g.song_count,
      extract(epoch from coalesce(g.finished_at, g.created_at)) * 1000 as at_ms,
      (select count(*) from game_songs c where c.game_id = g.id and c.completed_at is not null) as completed,
      u.id as user_id, u.name,
      coalesce(sum(a.points) filter (where a.answered_at is not null), 0) as points
    from games g
    join game_players me on me.game_id = g.id and me.user_id = ${userId}
    join game_players gp on gp.game_id = g.id
    join users u on u.id = gp.user_id
    left join game_songs gs on gs.game_id = g.id
    left join answers a on a.game_song_id = gs.id and a.user_id = gp.user_id
    where g.status <> 'active'
    group by g.id, u.id, u.name
    order by at_ms desc, g.id
  `);

  const order: string[] = [];
  const byGame = new Map<string, { row: PastRow; table: GameTotal[] }>();
  for (const r of rows.rows) {
    let g = byGame.get(r.id);
    if (!g) {
      g = { row: r, table: [] };
      byGame.set(r.id, g);
      order.push(r.id);
    }
    g.table.push({ userId: r.user_id, name: r.name, points: Number(r.points) });
  }

  return order.map((id) => {
    const { row, table } = byGame.get(id)!;
    const ended = row.status === "cancelled";
    const me = table.find((t) => t.userId === userId);
    return {
      id,
      status: row.status,
      mode: row.mode,
      songCount: row.song_count,
      completed: Number(row.completed),
      date: new Date(Number(row.at_ms)),
      points: me?.points ?? 0,
      place: placeOf(table, userId),
      players: table.length,
      others: table.filter((t) => t.userId !== userId).map((t) => t.name),
      result: table.length > 1 ? resultText(table, userId, ended) : "",
      won: !ended && isWin(table, userId),
    };
  });
}

/** The songs that count toward a player's numbers: answered, in a game that's over, and finished by everyone. */
async function scoredSongs(userId: string): Promise<ScoredSong[]> {
  const rows = await db
    .select({
      points: answers.points,
      correct: answers.correct,
      elapsedMs: answers.elapsedMs,
      answeredAt: answers.answeredAt,
      song: gameSongs.song,
    })
    .from(answers)
    .innerJoin(gameSongs, eq(gameSongs.id, answers.gameSongId))
    .innerJoin(games, eq(games.id, gameSongs.gameId))
    .where(
      and(
        eq(answers.userId, userId),
        isNotNull(answers.answeredAt),
        ne(games.status, "active"),
        or(eq(games.status, "finished"), isNotNull(gameSongs.completedAt)),
      ),
    );
  return rows.map((r) => ({
    points: r.points ?? 0,
    correct: Boolean(r.correct),
    elapsedMs: r.elapsedMs ?? 0,
    answeredAt: r.answeredAt!,
    title: r.song.title,
    artist: r.song.artist,
    artworkUrl: r.song.artworkUrl,
    genre: r.song.genre,
    year: r.song.year,
  }));
}

export type Profile = {
  userId: string;
  name: string;
  since: Date;
  /** Finished games played and won (games ended early don't count as either). */
  games: number;
  wins: number;
  answered: number;
  right: number;
  averageMs: number | null;
  bestGuesses: ScoredSong[];
  genres: { best: GroupStat | null; worst: GroupStat | null };
  decades: { best: GroupStat | null; worst: GroupStat | null };
  /** Newest first. */
  past: PastGame[];
};

export async function loadProfile(userId: string): Promise<Profile | null> {
  const [user] = await db
    .select({ id: users.id, name: users.name, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;
  const [scored, past] = await Promise.all([scoredSongs(userId), pastGames(userId)]);
  const finished = past.filter((g) => g.status === "finished");
  const summary = answerSummary(scored);
  return {
    userId: user.id,
    name: user.name,
    since: user.createdAt,
    games: finished.length,
    wins: finished.filter((g) => g.won).length,
    answered: summary.answered,
    right: summary.right,
    averageMs: summary.averageMs,
    bestGuesses: bestGuesses(scored),
    genres: bestAndWorst(scored, (r) => genreOf(r.genre)),
    decades: bestAndWorst(scored, (r) => decadeOf(r.year)),
    past,
  };
}

/**
 * Who may open whose profile: your own, anyone you've played a game with, and
 * the admin anyone's. Players from another group of friends stay private.
 */
export async function maySeeProfile(viewer: { id: string; isAdmin: boolean }, userId: string): Promise<boolean> {
  if (viewer.isAdmin || viewer.id === userId) return true;
  const rows = await db.execute(sql`
    select 1 from game_players a
    join game_players b on b.game_id = a.game_id
    where a.user_id = ${viewer.id} and b.user_id = ${userId}
    limit 1
  `);
  return rows.rows.length > 0;
}
