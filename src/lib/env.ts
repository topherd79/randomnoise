import "server-only";

/** Public base URL used in emails, e.g. https://randomnoise.ai (no trailing slash). */
export function appUrl(): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railway) return `https://${railway}`;
  return "http://localhost:3000";
}

/** The one admin. Defaults to the address agreed in the decision log. */
export function adminEmail(): string {
  return normalizeEmail(process.env.ADMIN_EMAIL || "topher.d@me.com");
}

/** Name given to the admin's account the first time they log in. */
export function adminName(): string {
  return process.env.ADMIN_NAME?.trim() || "Topher";
}

/** Sender for all game email, e.g. "Random Noise <game@randomnoise.ai>". */
export function emailFrom(): string {
  return process.env.EMAIL_FROM?.trim() || "Random Noise <game@randomnoise.ai>";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
