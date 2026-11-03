import "server-only";
import { count } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";

/** Whether a song has been drawn into any game (such songs can't be deleted). */
export async function songDrawnIntoGame(songId: string): Promise<boolean> {
  void songId; // Games aren't built yet, so no song has been drawn.
  return false;
}

/** Songs in the catalog, and how many no game has used yet. */
export async function catalogCounts(): Promise<{ total: number; unplayed: number }> {
  const [{ total }] = await db.select({ total: count() }).from(songs);
  return { total, unplayed: total };
}
