import { getCurrentUser } from "@/lib/auth";
import { chatSummaries } from "@/lib/chat";

export const dynamic = "force-dynamic";

/** GET /api/chat: every chat you're in, latest first, with unread counts (for the chat tab). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Log in again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const chats = await chatSummaries(user.id);
  return Response.json(
    { chats, unread: chats.reduce((n, c) => n + c.unread, 0) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
