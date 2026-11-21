import { getCurrentUser } from "@/lib/auth";
import { overGameView } from "@/lib/game-view";

export const dynamic = "force-dynamic";

// GET /api/games/[id]: a game that's over, as you see it (the past-games panel
// opens it in the panel). Only for its players, and never a game still being played.

const UUID = /^[0-9a-f-]{36}$/;
const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, ctx: RouteContext<"/api/games/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Log in again." }, { status: 401, headers: noStore });
  const { id } = await ctx.params;
  const game = UUID.test(id) ? await overGameView(id, user.id) : null;
  if (!game) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  return Response.json({ game, me: user.id }, { headers: noStore });
}
