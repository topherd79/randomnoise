import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { answerAux, joinAux, loadAuxState, playAux, startAux } from "@/lib/aux-game";

export const dynamic = "force-dynamic";

// Pass the Aux: the phones keep one page open for the whole game (so the turn
// player's phone can play its song on cue) and talk to the server here instead
// of reloading. GET is the game as this player sees it; POST is a tap. Every
// reply carries the fresh game, so a phone never has to ask twice.

const UUID = /^[0-9a-f-]{36}$/;
const noStore = { "Cache-Control": "no-store" };

const tap = z.discriminatedUnion("action", [
  z.object({ action: z.literal("join") }),
  z.object({ action: z.literal("start"), without: z.boolean().optional() }),
  z.object({ action: z.literal("play"), gameSongId: z.uuid() }),
  z.object({ action: z.literal("answer"), gameSongId: z.uuid(), choiceSongId: z.uuid() }),
]);

export async function GET(_request: Request, ctx: RouteContext<"/api/aux/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Log in again." }, { status: 401, headers: noStore });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  const state = await loadAuxState(id, user.id);
  if (!state) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  return Response.json({ state }, { headers: noStore });
}

/** Taps only come from this site's own pages (the session cookie is SameSite=Lax too). */
function sameSite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/aux/[id]">) {
  if (!sameSite(request)) return Response.json({ ok: false, error: "Not allowed." }, { status: 403, headers: noStore });
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Log in again." }, { status: 401, headers: noStore });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: noStore });
  const parsed = tap.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "That didn't work." }, { status: 400, headers: noStore });

  const t = parsed.data;
  const r =
    t.action === "join"
      ? await joinAux(user.id, id)
      : t.action === "start"
        ? await startAux(user.id, id, { without: t.without })
        : t.action === "play"
          ? await playAux(user.id, t.gameSongId)
          : await answerAux(user.id, t.gameSongId, t.choiceSongId);
  const state = await loadAuxState(id, user.id);
  return Response.json({ ...r, state }, { headers: noStore });
}
