"use server";

import { redirect } from "next/navigation";
import { consumeLoginToken, safeNext, startSession } from "@/lib/auth";

/** Runs only when the player taps "Log in", never when the link is merely opened. */
export async function confirmLogin(token: string, next?: string) {
  const userId = await consumeLoginToken(token);
  if (!userId) redirect(`/auth/${encodeURIComponent(token)}`); // shows "already used"
  await startSession(userId);
  redirect(safeNext(next));
}
