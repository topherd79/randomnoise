import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { loginTokens, sessions, users } from "@/db/schema";
import { adminEmail, appUrl } from "./env";
import { hashToken, newToken } from "./tokens";

const SESSION_COOKIE = "rn_session";
const SESSION_DAYS = 365;

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
};

/** The logged-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) return null;
  return { ...row, isAdmin: row.email === adminEmail() };
});

/** Use at the top of any page or action that needs a logged-in player. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Use at the top of every admin page AND every admin server action.
 * Non-admins get a 404 so the admin area doesn't advertise itself.
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!user.isAdmin) notFound();
  return user;
}

/**
 * For route handlers, where redirect()/notFound() aren't the right answer:
 * returns the admin, or a 404 response to send back.
 */
export async function adminForRoute(): Promise<CurrentUser | Response> {
  const user = await getCurrentUser();
  if (!user?.isAdmin) return new Response("Not found", { status: 404 });
  return user;
}

/** Log a user in: create a session row and set the cookie. Server actions only. */
export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Log out: delete this session and clear the cookie. Server actions only. */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  store.delete(SESSION_COOKIE);
}

/** Create a fresh one-time login link for a player. */
export async function createLoginUrl(userId: string): Promise<string> {
  const token = newToken();
  await db.insert(loginTokens).values({ userId, tokenHash: hashToken(token) });
  return `${appUrl()}/auth/${token}`;
}

/** Look up a login link without using it up (for the "tap to log in" page). */
export async function findLoginToken(token: string) {
  const [row] = await db
    .select({ userId: users.id, name: users.name, usedAt: loginTokens.usedAt })
    .from(loginTokens)
    .innerJoin(users, eq(loginTokens.userId, users.id))
    .where(eq(loginTokens.tokenHash, hashToken(token)))
    .limit(1);
  return row ?? null;
}

/**
 * Use up a login link. Atomic: if two taps race, only one wins.
 * Returns the user id, or null if the link is unknown or already used.
 */
export async function consumeLoginToken(token: string): Promise<string | null> {
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, hashToken(token)), isNull(loginTokens.usedAt)))
    .returning({ userId: loginTokens.userId });
  return row?.userId ?? null;
}
