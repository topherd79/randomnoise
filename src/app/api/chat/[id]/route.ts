import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { loadChat, markChatRead, reactToMessage, sendMessage } from "@/lib/chat";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat-rules";
import { fromThisSite } from "@/lib/same-origin";

export const dynamic = "force-dynamic";

// One chat: GET is the chat as you see it (held-back messages come as sparkles,
// never their words); POST sends a message, reacts, or marks it read. Every
// reply carries the fresh chat.

const UUID = /^[0-9a-f-]{36}$/;
const noStore = { "Cache-Control": "no-store" };

const tap = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), text: z.string().max(MAX_MESSAGE_LENGTH * 2) }),
  z.object({ action: z.literal("react"), messageId: z.uuid(), kind: z.string().max(20) }),
  z.object({ action: z.literal("read") }),
]);

export async function GET(_request: Request, ctx: RouteContext<"/api/chat/[id]">) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Log in again." }, { status: 401, headers: noStore });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  const chat = await loadChat(id, user.id);
  if (!chat) return Response.json({ error: "Not found" }, { status: 404, headers: noStore });
  return Response.json({ chat }, { headers: noStore });
}

export async function POST(request: Request, ctx: RouteContext<"/api/chat/[id]">) {
  if (!fromThisSite(request)) return Response.json({ ok: false, error: "Not allowed." }, { status: 403, headers: noStore });
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Log in again." }, { status: 401, headers: noStore });
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: noStore });
  const parsed = tap.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "That didn't work." }, { status: 400, headers: noStore });

  const t = parsed.data;
  let r: { ok: boolean; error?: string } = { ok: true };
  if (t.action === "send") r = await sendMessage(user.id, id, t.text);
  else if (t.action === "react") r = await reactToMessage(user.id, t.messageId, t.kind);
  else await markChatRead(user.id, id);
  const chat = await loadChat(id, user.id);
  if (!chat) return Response.json({ ok: false, error: "Not found" }, { status: 404, headers: noStore });
  return Response.json({ ...r, chat }, { headers: noStore });
}
