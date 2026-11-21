import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { gamePlayers, games } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { chatKey, subscribeToGames } from "@/lib/live";
import { myChatIds } from "@/lib/chat";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;
const HEARTBEAT_MS = 25_000;

/**
 * Server-sent events: GET /api/live?game=<id>&game=<id>&chat=<id>
 * Sends "update" (with the game id) whenever one of those games changes, so the
 * page can re-render, and "chat" (with the chat id) when a chat gets a message
 * or a reaction. Players get their own games and chats; the admin can follow
 * any game (but only the chats they're in). The browser's EventSource
 * reconnects by itself if the connection drops.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Not found", { status: 404 });

  const params = new URL(request.url).searchParams;
  const requested = [...new Set(params.getAll("game"))].filter((id) => UUID.test(id)).slice(0, 10);
  const chatsAsked = [...new Set(params.getAll("chat"))].filter((id) => UUID.test(id)).slice(0, 50);
  if (requested.length === 0 && chatsAsked.length === 0) return new Response("No games", { status: 400 });

  const allowed =
    requested.length === 0
      ? []
      : user.isAdmin
        ? (await db.select({ id: games.id }).from(games).where(inArray(games.id, requested))).map((r) => r.id)
        : (
            await db
              .select({ id: gamePlayers.gameId })
              .from(gamePlayers)
              .where(and(eq(gamePlayers.userId, user.id), inArray(gamePlayers.gameId, requested)))
          ).map((r) => r.id);
  const allowedChats = await myChatIds(user.id, chatsAsked);
  if (allowed.length === 0 && allowedChats.length === 0) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          open = false;
        }
      };

      send("retry: 3000\n: connected\n\n");
      const unsubscribeGames = await subscribeToGames(allowed, (gameId) => send(`event: update\ndata: ${gameId}\n\n`));
      const unsubscribeChats = await subscribeToGames(allowedChats.map(chatKey), (key) =>
        send(`event: chat\ndata: ${key.slice("chat:".length)}\n\n`),
      );
      const unsubscribe = () => {
        unsubscribeGames();
        unsubscribeChats();
      };
      // A heartbeat every 25 s keeps proxies from closing an idle connection, and
      // lets the page notice if events stop getting through (it then polls).
      const heartbeat = setInterval(() => send("event: ping\ndata: \n\n"), HEARTBEAT_MS);

      cleanup = () => {
        if (!open) return;
        open = false;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      if (request.signal.aborted) cleanup();
      else request.signal.addEventListener("abort", () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform stops response compression from buffering the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
