"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { CLIP_LENGTHS } from "@/lib/clips";
import { cancelGame, createGame, resetAttempt } from "@/lib/games";
import { takeOutOfGame } from "@/lib/play-on-game";
import { MAX_PLAYERS, MIN_PLAYERS } from "@/lib/rules";
import { ALL_LENGTHS, GAME_MODES, MODES } from "@/lib/modes";
import { AUX_MIN_PLAYERS, auxSongCount } from "@/lib/aux";

// Every action here re-checks the admin: server actions are public endpoints.

export type FormResult = { ok: boolean; message: string } | null;

const gameSchema = z
  .object({
    playerIds: z
      .array(z.uuid())
      .min(MIN_PLAYERS, "Pick at least one player.")
      .max(MAX_PLAYERS, `A game has at most ${MAX_PLAYERS} players.`),
    mode: z.enum(GAME_MODES),
    songCount: z.coerce.number().refine((n) => ALL_LENGTHS.includes(n), "Pick how many songs."),
    clipLengthSec: z.coerce.number().refine((n) => (CLIP_LENGTHS as readonly number[]).includes(n), "Pick a clip length."),
    wrongAnswers: z.enum(["random", "similar"]),
    songPool: z.enum(["new", "mix"]),
    filters: z.object({
      decades: z.array(z.number().int().min(1900).max(2100).multipleOf(10)).max(30),
      genres: z.array(z.string().trim().min(1).max(120)).max(100),
      excludeGenres: z.array(z.string().trim().min(1).max(120)).max(100),
      artists: z.array(z.string().trim().min(1).max(300)).max(200),
    }),
  })
  .refine((g) => MODES[g.mode].lengths.includes(g.songCount), { message: "Pick how many songs." })
  .refine((g) => g.mode !== "aux" || g.playerIds.length >= AUX_MIN_PLAYERS, {
    message: `Pick at least ${AUX_MIN_PLAYERS} players for Pass the Aux.`,
  })
  .refine((g) => g.mode !== "aux" || g.songCount === auxSongCount(g.playerIds.length), {
    message: "Pass the Aux is 5 songs a player.",
  });

export async function createGameAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const admin = await requireAdmin();
  const parsed = gameSchema.safeParse({
    playerIds: [...new Set(formData.getAll("playerIds").map(String))],
    mode: formData.get("mode") ?? "og",
    songCount: formData.get("songCount"),
    clipLengthSec: formData.get("clipLengthSec"),
    wrongAnswers: formData.get("wrongAnswers") ?? "random",
    songPool: formData.get("songPool") ?? "mix",
    filters: {
      decades: [...new Set(formData.getAll("decade").map(Number))],
      genres: [...new Set(formData.getAll("genre").map(String))],
      excludeGenres: [...new Set(formData.getAll("excludeGenre").map(String))],
      artists: [...new Set(formData.getAll("artist").map(String))],
    },
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const r = await createGame({ ...parsed.data, createdBy: admin.id });
  if (!r.ok) return { ok: false, message: r.error };
  revalidatePath("/admin/games");
  revalidatePath("/admin/catalog");
  redirect(`/admin/games/${r.gameId}`);
}

export async function resetAttemptAction(gameId: string, gameSongId: string, userId: string): Promise<FormResult> {
  await requireAdmin();
  const r = await resetAttempt(String(gameSongId), String(userId));
  revalidatePath(`/admin/games/${gameId}`);
  return r.ok ? { ok: true, message: "Reset. They can play this song again from the start." } : { ok: false, message: r.error };
}

/** Take a player out of a game in progress: it goes on without them, and they stay in its results, crossed out. */
export async function takeOutAction(gameId: string, userId: string): Promise<FormResult> {
  await requireAdmin();
  const r = await takeOutOfGame(String(gameId), String(userId), "admin");
  revalidatePath("/admin/games");
  revalidatePath(`/admin/games/${gameId}`);
  return r.ok ? { ok: true, message: "Taken out. The game goes on without them." } : { ok: false, message: r.error };
}

export async function endGameAction(gameId: string): Promise<void> {
  await requireAdmin();
  await cancelGame(String(gameId));
  revalidatePath("/admin/games");
  revalidatePath(`/admin/games/${gameId}`);
}
