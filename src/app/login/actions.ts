"use server";

import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createLoginUrl } from "@/lib/auth";
import { loginEmail, sendEmail } from "@/lib/email";
import { adminEmail, adminName, normalizeEmail } from "@/lib/env";

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "unknown"; email: string }
  | { status: "invalid" }
  | { status: "error" };

const emailSchema = z.email();

export async function requestLoginLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = emailSchema.safeParse(normalizeEmail(String(formData.get("email") ?? "")));
  if (!parsed.success) return { status: "invalid" };
  const email = parsed.data;

  let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // The admin's account is created the first time they ask for a link.
  if (!user && email === adminEmail()) {
    [user] = await db
      .insert(users)
      .values({ email, name: adminName() })
      .onConflictDoNothing()
      .returning();
    user ??= (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  }

  // Private game: it's friendlier to say so than to pretend an email went out.
  if (!user) return { status: "unknown", email };

  try {
    const url = await createLoginUrl(user.id);
    await sendEmail({ to: user.email, ...loginEmail(user.name, url) });
    return { status: "sent", email };
  } catch (err) {
    console.error("Failed to send login email", err);
    return { status: "error" };
  }
}
