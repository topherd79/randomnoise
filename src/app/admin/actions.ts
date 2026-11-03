"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { gamePlayers, games, sessions, users } from "@/db/schema";
import { createLoginUrl, requireAdmin } from "@/lib/auth";
import { inviteEmail, loginEmail, sendEmail } from "@/lib/email";
import { adminEmail, normalizeEmail } from "@/lib/env";
import { afterPlayerRemoved } from "@/lib/games";

// Every action here re-checks the admin: server actions are public endpoints.

export type FormResult = { ok: boolean; message: string } | null;

const playerSchema = z.object({
  name: z.string().trim().min(1, "Add a name.").max(40, "Keep the name under 40 characters."),
  email: z.email("That doesn't look like an email address."),
});

function readPlayer(formData: FormData) {
  return playerSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    email: normalizeEmail(String(formData.get("email") ?? "")),
  });
}

async function emailExists(email: string, exceptId?: string) {
  const where = exceptId ? and(eq(users.email, email), ne(users.id, exceptId)) : eq(users.email, email);
  const [row] = await db.select({ id: users.id }).from(users).where(where).limit(1);
  return Boolean(row);
}

export async function addPlayer(_prev: FormResult, formData: FormData): Promise<FormResult> {
  await requireAdmin();
  const parsed = readPlayer(formData);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { name, email } = parsed.data;

  if (await emailExists(email)) return { ok: false, message: `${email} is already on the list.` };

  const [user] = await db.insert(users).values({ name, email }).returning();
  revalidatePath("/admin");

  if (formData.get("sendInvite") === "on") {
    try {
      await sendEmail({ to: email, ...inviteEmail(name, await createLoginUrl(user.id)) });
      return { ok: true, message: `Added ${name} and emailed an invite.` };
    } catch (err) {
      console.error("Invite email failed", err);
      return { ok: true, message: `Added ${name}, but the invite email failed. Try “Email link”.` };
    }
  }
  return { ok: true, message: `Added ${name}.` };
}

export async function updatePlayer(_prev: FormResult, formData: FormData): Promise<FormResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const parsed = readPlayer(formData);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  const { name, email } = parsed.data;

  const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!existing) return { ok: false, message: "That player no longer exists." };
  if (existing.email === adminEmail() && email !== adminEmail()) {
    return { ok: false, message: "The admin email is set by the ADMIN_EMAIL setting, not here." };
  }
  if (await emailExists(email, id)) return { ok: false, message: `${email} is already on the list.` };

  await db.update(users).set({ name, email }).where(eq(users.id, id));
  // A changed email means old sessions belong to the old address: log them out.
  if (email !== existing.email) await db.delete(sessions).where(eq(sessions.userId, id));
  revalidatePath("/admin");
  return { ok: true, message: "Saved." };
}

export async function removePlayer(id: string): Promise<FormResult> {
  const me = await requireAdmin();
  if (id === me.id) return { ok: false, message: "You can't remove yourself." };
  const activeGames = await db
    .select({ id: games.id })
    .from(gamePlayers)
    .innerJoin(games, eq(games.id, gamePlayers.gameId))
    .where(and(eq(gamePlayers.userId, id), eq(games.status, "active")));
  await db.delete(users).where(eq(users.id, id));
  // Their games shouldn't stay stuck waiting on them.
  await afterPlayerRemoved(activeGames.map((g) => g.id));
  revalidatePath("/admin");
  return { ok: true, message: "Removed." };
}

/** A fresh one-time login link, for pasting into the group chat. */
export async function makeLoginLink(id: string): Promise<{ url: string }> {
  await requireAdmin();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new Error("Player not found");
  return { url: await createLoginUrl(user.id) };
}

/** Email a player a login link (an invite if they've never logged in). */
export async function emailLoginLink(id: string): Promise<FormResult> {
  await requireAdmin();
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return { ok: false, message: "That player no longer exists." };

  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.userId, id))
    .limit(1);
  const url = await createLoginUrl(user.id);
  const email = session ? loginEmail(user.name, url) : inviteEmail(user.name, url);

  try {
    await sendEmail({ to: user.email, ...email });
    return { ok: true, message: `Emailed ${user.name}.` };
  } catch (err) {
    console.error("Login email failed", err);
    return { ok: false, message: "The email failed to send." };
  }
}
