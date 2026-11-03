import "server-only";
import { createHash, randomBytes } from "node:crypto";

/** A new random token, safe to put in a URL or cookie. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What we store in the database instead of the raw token. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
