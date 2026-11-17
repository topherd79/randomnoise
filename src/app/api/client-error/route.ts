import { getCurrentUser } from "@/lib/auth";

// Script errors from players' browsers, written to the server log (Railway's
// deploy logs) so a failure on someone's phone can be seen and fixed. Only
// logged-in players are heard, a few times an hour each, and every field is cut
// short, so this can't be used to flood the logs.

const PER_HOUR = 20;
const recent = new Map<string, number[]>();
const clip = (v: unknown, n: number) => String(v ?? "").slice(0, n);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 204 });

  const now = Date.now();
  const times = (recent.get(user.id) ?? []).filter((t) => now - t < 3_600_000);
  if (times.length >= PER_HOUR) return new Response(null, { status: 204 });
  times.push(now);
  recent.set(user.id, times);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Not JSON: log what we know.
  }
  console.error(
    `[client-error] ${user.name} (${user.id}) on ${clip(body.url, 200)} at ${clip(body.where, 60)}: ${clip(body.message, 500)}` +
      ` | ua: ${clip(request.headers.get("user-agent"), 300)}` +
      (body.stack ? ` | stack: ${clip(body.stack, 1500).replace(/\s+/g, " ")}` : ""),
  );
  return new Response(null, { status: 204 });
}
