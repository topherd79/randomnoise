"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { CLIP_LENGTHS } from "@/lib/clips";
import { cancelGame, createGame, resetAttempt } from "@/lib/games";
import { GAME_LENGTHS, MAX_PLAYERS, MIN_PLAYERS } from "@/lib/rules";

// Every action here re-checks the admin: server actions are public endpoints.

export type FormResult = { ok: boolean; message: string } | null;

const gameSchema = z.object({
  playerIds: z
    .array(z.uuid())
    .min(MIN_PLAYERS, "Pick at least one player.")
    .max(MAX_PLAYERS, `A game has at most ${MAX_PLAYERS} players.`),
  songCount: z.coerce.number().refine((n) => (GAME_LENGTHS as readonly number[]).includes(n), "Pick how many songs."),
  clipLengthSec: z.coerce.number().refine((n) => (CLIP_LENGTHS as readonly number[]).includes(n), "Pick a clip length."),
  wrongAnswers: z.enum(["random", "similar"]),
  songPool: z.enum(["new", "mix"]),
});

export async function createGameAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const admin = await requireAdmin();
  const parsed = gameSchema.safeParse({
    playerIds: [...new Set(formData.getAll("playerIds").map(String))],
    songCount: formData.get("songCount"),
    clipLengthSec: formData.get("clipLengthSec"),
    wrongAnswers: formData.get("wrongAnswers") ?? "random",
    songPool: formData.get("songPool") ?? "new",
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

export async function endGameAction(gameId: string): Promise<void> {
  await requireAdmin();
  await cancelGame(String(gameId));
  revalidatePath("/admin/games");
  revalidatePath(`/admin/games/${gameId}`);
}
