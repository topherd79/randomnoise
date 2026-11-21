import { getCurrentUser } from "@/lib/auth";
import { profileCard } from "@/lib/profiles";

export const dynamic = "force-dynamic";

// GET /api/players/[id]: someone's short profile (a side panel opens it in the
// panel). Yours, anyone you've played a game with, or anyone's for the admin.

const UUID = /^[0-9a-f-]{36}$/;
const noStore = { "Cache-Control": "no-store" };

export async function GET(_request: Request, ctx: RouteContext<"/api/players/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Log in again." }, { status: 401, headers: noStore });
  const { id } = await ctx.params;
  const profile = UUID.test(id) ? await profileCard(user, id) : null;
  if (!profile) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  return Response.json({ profile }, { headers: noStore });
}
