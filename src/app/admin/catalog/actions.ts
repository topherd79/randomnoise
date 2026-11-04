"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { songs } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { runLookup } from "@/lib/catalog";
import { CLIP_LENGTHS } from "@/lib/clips";
import { removeFile } from "@/lib/storage";
import { songDrawnIntoGame } from "@/lib/catalog-queries";

// Every action here re-checks the admin: server actions are public endpoints.

export type FormResult = { ok: boolean; message: string } | null;

/**
 * Look up details for the next song that hasn't been looked up yet. The
 * catalog page calls this every few seconds while any are waiting, which keeps
 * us under Apple's limit of roughly 20 searches a minute.
 */
export async function lookupNext(): Promise<{ remaining: number }> {
  await requireAdmin();
  const [next] = await db
    .select()
    .from(songs)
    .where(eq(songs.lookupStatus, "pending"))
    .orderBy(asc(songs.createdAt))
    .limit(1);
  if (next) await runLookup(next);
  const [{ n }] = await db.select({ n: count() }).from(songs).where(eq(songs.lookupStatus, "pending"));
  if (next) revalidatePath("/admin/catalog");
  return { remaining: n };
}

export async function lookupAgain(id: string): Promise<FormResult> {
  await requireAdmin();
  const [song] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) return { ok: false, message: "That song no longer exists." };
  await runLookup(song, { overwrite: true });
  const [after] = await db.select({ status: songs.lookupStatus }).from(songs).where(eq(songs.id, id)).limit(1);
  revalidatePath("/admin/catalog");
  revalidatePath(`/admin/catalog/${id}`);
  return after?.status === "found"
    ? { ok: true, message: "Found it. Details updated." }
    : after?.status === "not_found"
      ? { ok: false, message: "Apple's search didn't find this title and artist. Check the spelling, or fill the details in yourself." }
      : { ok: false, message: "The lookup didn't work just now. Try again in a minute." };
}

const optionalUrl = z
  .string()
  .trim()
  .transform((s) => s || null)
  .refine((s) => s === null || /^https:\/\/\S+$/.test(s), "Links must start with https://");

const detailsSchema = z.object({
  title: z.string().trim().min(1, "Add a title.").max(200),
  artist: z.string().trim().min(1, "Add an artist.").max(200),
  album: z.string().trim().max(200).transform((s) => s || null),
  year: z
    .string()
    .trim()
    .transform((s) => (s ? Number(s) : null))
    .refine((y) => y === null || (Number.isInteger(y) && y >= 1900 && y <= 2100), "Year should be like 1997."),
  genre: z.string().trim().max(80).transform((s) => s || null),
  artworkUrl: optionalUrl,
  appleMusicUrl: optionalUrl,
  spotifyUrl: optionalUrl,
});

export async function updateSongDetails(_prev: FormResult, formData: FormData): Promise<FormResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const parsed = detailsSchema.safeParse(Object.fromEntries(Object.keys(detailsSchema.shape).map((k) => [k, String(formData.get(k) ?? "")])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };

  const updated = await db
    .update(songs)
    .set({ ...parsed.data, needsReview: false, updatedAt: new Date() })
    .where(eq(songs.id, id))
    .returning({ id: songs.id });
  if (!updated.length) return { ok: false, message: "That song no longer exists." };
  revalidatePath("/admin/catalog");
  revalidatePath(`/admin/catalog/${id}`);
  return { ok: true, message: "Saved." };
}

const clipSchema = z.object({
  mode: z.enum(["surprise", "start", "spots"]),
  spots: z.array(z.number().min(0)).max(20),
  lengthSec: z
    .number()
    .refine((n) => (CLIP_LENGTHS as readonly number[]).includes(n))
    .nullable(),
});

export async function saveClipSettings(
  id: string,
  settings: { mode: string; spots: number[]; lengthSec: number | null },
): Promise<FormResult> {
  await requireAdmin();
  const parsed = clipSchema.safeParse(settings);
  if (!parsed.success) return { ok: false, message: "Those clip settings don't look right." };
  const { mode, lengthSec } = parsed.data;

  const [song] = await db.select({ durationSec: songs.durationSec }).from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) return { ok: false, message: "That song no longer exists." };
  const spots = [...new Set(parsed.data.spots.map((s) => Math.round(s * 10) / 10))]
    .filter((s) => s < song.durationSec)
    .sort((a, b) => a - b);
  if (mode === "spots" && spots.length === 0) {
    return { ok: false, message: "Mark at least one spot on the sound wave, or pick another setting." };
  }

  await db
    .update(songs)
    .set({ clipMode: mode, clipSpots: spots, clipLengthSec: lengthSec, updatedAt: new Date() })
    .where(eq(songs.id, id));
  revalidatePath("/admin/catalog");
  revalidatePath(`/admin/catalog/${id}`);
  return { ok: true, message: "Clip setting saved." };
}

/**
 * Turn a song on or off for new games. Off means it's never drawn and never
 * used as a wrong answer; games already created are unaffected (and saying
 * otherwise would hint at which songs are in the game in progress).
 */
export async function setSongActive(id: string, active: boolean): Promise<FormResult> {
  await requireAdmin();
  if (typeof active !== "boolean") return { ok: false, message: "That setting doesn't look right." };
  const updated = await db
    .update(songs)
    .set({ active, updatedAt: new Date() })
    .where(eq(songs.id, id))
    .returning({ id: songs.id });
  if (!updated.length) return { ok: false, message: "That song no longer exists." };
  revalidatePath("/admin/catalog");
  revalidatePath(`/admin/catalog/${id}`);
  revalidatePath("/admin/games");
  return { ok: true, message: active ? "On: new games can use it." : "Off: new games leave it out." };
}

/** Switch a batch of songs on or off at once (the upload list's "Switch all" buttons). */
export async function setSongsActive(ids: string[], active: boolean): Promise<FormResult> {
  await requireAdmin();
  const parsed = z.object({ ids: z.array(z.uuid()).min(1).max(2000), active: z.boolean() }).safeParse({ ids, active });
  if (!parsed.success) return { ok: false, message: "That setting doesn't look right." };
  const updated = await db
    .update(songs)
    .set({ active: parsed.data.active, updatedAt: new Date() })
    .where(inArray(songs.id, parsed.data.ids))
    .returning({ id: songs.id });
  revalidatePath("/admin/catalog");
  revalidatePath("/admin/games");
  const n = updated.length;
  return { ok: true, message: `${n} ${n === 1 ? "song" : "songs"} switched ${parsed.data.active ? "on" : "off"}.` };
}

export async function removeCustomClip(id: string): Promise<FormResult> {
  await requireAdmin();
  const [song] = await db.select({ file: songs.customClipFile }).from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) return { ok: false, message: "That song no longer exists." };
  await db.update(songs).set({ customClipFile: null, updatedAt: new Date() }).where(eq(songs.id, id));
  await removeFile("custom-clips", song.file);
  revalidatePath(`/admin/catalog/${id}`);
  return { ok: true, message: "Custom clip removed." };
}

export async function deleteSong(id: string): Promise<FormResult> {
  await requireAdmin();
  const [song] = await db.select().from(songs).where(eq(songs.id, id)).limit(1);
  if (!song) redirect("/admin/catalog");
  // Deliberately vague: saying "it's in the game in progress" would tell the
  // admin (who also plays) which songs are coming up.
  if (await songDrawnIntoGame(id)) {
    return { ok: false, message: "Songs that have been drawn into a game can't be deleted." };
  }
  await db.delete(songs).where(eq(songs.id, id));
  await Promise.all([removeFile("songs", song.fileName), removeFile("custom-clips", song.customClipFile)]);
  revalidatePath("/admin/catalog");
  redirect("/admin/catalog");
}
