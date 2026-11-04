import "server-only";
import { EventEmitter } from "node:events";
import { Client } from "pg";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Live updates: "game X changed" signals pushed to open pages.
 *
 * Anything that changes a game (an answer, a finished round, a reset, a game
 * ending) calls publishGameUpdate(). That goes through Postgres NOTIFY, so it
 * reaches every copy of the app, including the old and new copies that
 * overlap for a moment during a deploy. Each copy keeps one connection
 * LISTENing and fans the signal out to its open pages (see /api/live).
 *
 * The signal carries only the game id, never what anyone picked: pages
 * re-render through the normal, permission-checked server code.
 */

const CHANNEL = "rn_game_updates";

type Hub = {
  emitter: EventEmitter;
  client: Client | null;
  connecting: Promise<void> | null;
  retry: ReturnType<typeof setTimeout> | null;
  hasConnected: boolean;
};

// One hub per server process (kept across hot reloads in development).
const globalForLive = globalThis as unknown as { rnLiveHub?: Hub };
const hub: Hub =
  globalForLive.rnLiveHub ??
  (globalForLive.rnLiveHub = {
    emitter: new EventEmitter().setMaxListeners(0),
    client: null,
    connecting: null,
    retry: null,
    hasConnected: false,
  });

/** Keep trying to (re)connect every few seconds while any page is listening. */
function scheduleRetry() {
  if (hub.retry) return;
  hub.retry = setTimeout(() => {
    hub.retry = null;
    if (hub.emitter.eventNames().length > 0) ensureListening().catch(() => scheduleRetry());
  }, 3000);
}

function dropClient(client: Client) {
  if (hub.client !== client) return;
  hub.client = null;
  client.end().catch(() => {});
  scheduleRetry();
}

async function ensureListening(): Promise<void> {
  if (hub.client) return;
  if (hub.connecting) return hub.connecting;
  hub.connecting = (async () => {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("notification", (msg) => {
      if (msg.channel === CHANNEL && msg.payload) hub.emitter.emit(msg.payload, msg.payload);
    });
    client.on("error", (err) => {
      console.error("Live updates: listener connection lost", err.message);
      dropClient(client);
    });
    client.on("end", () => dropClient(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
    } catch (err) {
      client.end().catch(() => {});
      throw err;
    }
    hub.client = client;
    // After a reconnect, anything published while we were away was missed:
    // tell every open page to check in.
    if (hub.hasConnected) for (const id of hub.emitter.eventNames()) hub.emitter.emit(id, String(id));
    hub.hasConnected = true;
  })().finally(() => {
    hub.connecting = null;
  });
  return hub.connecting;
}

/** Tell every open page showing this game that something changed. Never throws. */
export async function publishGameUpdate(gameId: string): Promise<void> {
  try {
    await db.execute(sql`select pg_notify(${CHANNEL}, ${gameId})`);
  } catch (err) {
    console.error("Live updates: publish failed", err);
  }
}

/** Call onUpdate whenever one of these games changes. Returns an unsubscribe function. */
export async function subscribeToGames(gameIds: string[], onUpdate: (gameId: string) => void): Promise<() => void> {
  const handler = (gameId: string) => onUpdate(gameId);
  for (const id of gameIds) hub.emitter.on(id, handler);
  try {
    await ensureListening();
  } catch (err) {
    console.error("Live updates: can't listen right now, retrying", err);
    scheduleRetry();
  }
  return () => {
    for (const id of gameIds) hub.emitter.off(id, handler);
  };
}
