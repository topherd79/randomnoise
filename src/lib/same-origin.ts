// Taps sent with fetch() (Pass the Aux, chat) only count from this site's own
// pages. The session cookie is SameSite=Lax too, so another site can't send
// one with your login; this is the second lock.

export function fromThisSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
