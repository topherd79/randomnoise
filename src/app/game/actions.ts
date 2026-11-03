"use server";

import { requireUser } from "@/lib/auth";
import { answerSong, nudge, startSong, type AnswerResult } from "@/lib/games";

// Server actions are public endpoints: each one checks the player, and the game
// functions check that they're in the game and on the current song.

export async function startSongAction(gameSongId: string): Promise<{ ok: true; startedAt: number } | { ok: false; error: string }> {
  const user = await requireUser();
  return startSong(user.id, String(gameSongId));
}

export async function answerSongAction(
  gameSongId: string,
  choiceSongId: string,
): Promise<{ ok: true; result: AnswerResult } | { ok: false; error: string }> {
  const user = await requireUser();
  return answerSong(user.id, String(gameSongId), String(choiceSongId));
}

export async function nudgeAction(gameSongId: string, toUserId: string): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const r = await nudge(user.id, String(gameSongId), String(toUserId));
  return r.ok ? { ok: true, message: r.message } : { ok: false, message: r.error };
}
