"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessageView, ChatSummary, ChatView } from "@/lib/chat";
import { MAX_MESSAGE_LENGTH, REACTIONS, sparkleDots, sparkleWidth } from "@/lib/chat-rules";
import { reportClientError } from "@/lib/client-errors";
import { withTimeout } from "@/lib/timeout";

// The chat: a small tab on the right edge, with the unread count in its
// bubble. Tap it and the chat slides in over the page; tap the tab again (or
// the page behind) and it slides back. On a game page it's that group's chat;
// on the home page, your list of chats.
//
// It keeps its own copy of the chat (fetch, never a page reload), updated live
// through /api/live, and it hides while a song is playing (PlayRound sends
// "rn:song"). Held-back messages arrive without their words and show as sparkles.

const REPLY_MS = 8_000;
const POLL_MS = 30_000;
const LONG_PRESS_MS = 450;

type Props = {
  /** The game page's chat. Without it (the home page) the tab opens your list of chats. */
  chatId?: string;
  /** The chats to listen to for new messages. */
  chatIds: string[];
  /** Games in progress in these chats: answering a song can unlock held-back messages. */
  gameIds: string[];
  /** Unread messages when the page was made. */
  unread: number;
};

type View = { kind: "list" } | { kind: "chat"; id: string };

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function dayOf(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(d.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) });
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await withTimeout(fetch(url, { cache: "no-store", ...init }), REPLY_MS);
  return (await res.json()) as T;
}

export function ChatTab({ chatId, chatIds, gameIds, unread: initialUnread }: Props) {
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [view, setView] = useState<View>(chatId ? { kind: "chat", id: chatId } : { kind: "list" });
  const [list, setList] = useState<ChatSummary[] | null>(null);
  const [chat, setChat] = useState<ChatView | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactingOn, setReactingOn] = useState<string | null>(null);
  const viewRef = useRef(view);
  const openRef = useRef(open);
  useEffect(() => {
    viewRef.current = view;
    openRef.current = open;
  }, [view, open]);

  const loadCounts = useCallback(async () => {
    try {
      const r = await getJson<{ chats?: ChatSummary[]; unread?: number }>("/api/chat");
      if (!r.chats) return;
      setList(r.chats);
      setUnread(chatId ? (r.chats.find((c) => c.id === chatId)?.unread ?? 0) : (r.unread ?? 0));
    } catch {
      // Offline for a moment: the next update tries again.
    }
  }, [chatId]);

  const loadChat = useCallback(async (id: string, markRead: boolean) => {
    try {
      const r = markRead
        ? await getJson<{ chat?: ChatView }>(`/api/chat/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "read" }),
          })
        : await getJson<{ chat?: ChatView }>(`/api/chat/${id}`);
      const v = viewRef.current;
      if (r.chat && v.kind === "chat" && v.id === id) setChat(r.chat);
    } catch {
      // Offline for a moment: the next update tries again.
    }
  }, []);

  /** Something changed: the counts, and the open chat (marking it read, since it's in front of you). */
  const catchUp = useCallback(async () => {
    const v = viewRef.current;
    if (openRef.current && v.kind === "chat") await loadChat(v.id, true);
    await loadCounts();
  }, [loadChat, loadCounts]);

  // Live: a message or reaction in one of these chats, or progress in one of their games.
  const chatKey = chatIds.join(",");
  const gameKey = gameIds.join(",");
  useEffect(() => {
    if (!chatKey) return;
    const params = new URLSearchParams();
    for (const id of chatKey.split(",")) params.append("chat", id);
    for (const id of gameKey ? gameKey.split(",") : []) params.append("game", id);
    const source = new EventSource(`/api/live?${params}`);
    let wasOpen = false;
    source.addEventListener("chat", () => void catchUp());
    source.addEventListener("update", () => {
      const v = viewRef.current;
      if (openRef.current && v.kind === "chat") void loadChat(v.id, false);
    });
    source.addEventListener("open", () => {
      if (wasOpen) void catchUp();
      wasOpen = true;
    });
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && source.readyState !== EventSource.OPEN) void catchUp();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void catchUp();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      source.close();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [chatKey, gameKey, catchUp, loadChat]);

  // No chat while a song is playing: the tab hides, and an open chat closes.
  useEffect(() => {
    const onSong = (e: Event) => {
      const playing = (e as CustomEvent<string>).detail === "playing";
      setHidden(playing);
      if (playing) setOpen(false);
    };
    window.addEventListener("rn:song", onSong);
    return () => window.removeEventListener("rn:song", onSong);
  }, []);

  // While it's open: the page behind doesn't scroll, and doesn't refresh under you (LiveRefresh waits).
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.dataset.chatOpen = "1";
    return () => {
      document.body.style.overflow = before;
      delete root.dataset.chatOpen;
      window.dispatchEvent(new Event("rn:chat-closed"));
    };
  }, [open]);

  // iPhones: keep the panel (and its message box) above the keyboard.
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!open || !vv) return;
    const fit = () => setBox({ top: vv.offsetTop, height: vv.height });
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      setReactingOn(null);
      return;
    }
    setOpen(true);
    setError(null);
    const v = chatId ? ({ kind: "chat", id: chatId } as View) : view;
    setView(v);
    if (v.kind === "chat") void loadChat(v.id, true).then(loadCounts);
    else void loadCounts();
  }

  function openChat(id: string) {
    setChat(null);
    setView({ kind: "chat", id });
    viewRef.current = { kind: "chat", id };
    void loadChat(id, true).then(loadCounts);
  }

  async function post(id: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const r = await getJson<{ ok?: boolean; error?: string; chat?: ChatView }>(`/api/chat/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.chat) setChat(r.chat);
      if (!r.ok) setError(r.error ?? "That didn't work.");
      return Boolean(r.ok);
    } catch (err) {
      reportClientError(`chat ${String(body.action)}`, err);
      setError("That didn't go through. Try again.");
      return false;
    }
  }

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const v = viewRef.current;
    if (v.kind !== "chat" || !text.trim() || sending) return;
    setSending(true);
    setError(null);
    const ok = await post(v.id, { action: "send", text });
    setSending(false);
    if (ok) setText("");
  }

  function onReact(messageId: string, kind: string) {
    const v = viewRef.current;
    setReactingOn(null);
    if (v.kind === "chat") void post(v.id, { action: "react", messageId, kind });
  }

  // Keep the newest message in view: on opening a chat, and when one arrives while you're near the bottom.
  const scroller = useRef<HTMLDivElement>(null);
  const lastSeen = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !chat) return;
    const newest = chat.messages.at(-1)?.id ?? null;
    const first = lastSeen.current === null || !chat.messages.some((m) => m.id === lastSeen.current);
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (newest !== lastSeen.current && (first || nearBottom)) el.scrollTop = el.scrollHeight;
    lastSeen.current = newest;
  }, [chat]);

  if (hidden) return null;

  const showing = view.kind === "chat" ? chat : null;
  const panelStyle: React.CSSProperties = {
    width: "min(340px, calc(100vw - 56px))",
    transform: open ? "translateX(0)" : "translateX(100%)",
    ...(open && box ? { top: box.top, height: box.height, bottom: "auto" } : {}),
  };

  return (
    <>
      {/* The page behind: dimmed, and tapping it slides the chat back. */}
      <div
        onClick={toggle}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/45 transition-opacity duration-200 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        className="fixed top-0 right-0 bottom-0 z-50 transition-transform duration-[260ms] ease-out"
        style={panelStyle}
        aria-label="Chat"
      >
        {/* The tab rides on the panel's edge: on the screen's edge when closed. */}
        <button
          onClick={toggle}
          aria-label={open ? "Close chat" : unread > 0 ? `Chat, ${unread} unread` : "Chat"}
          className="absolute top-[70%] -left-[50px] flex h-[58px] w-[50px] items-center justify-center rounded-l-2xl border border-r-0 border-[#3a3a48] bg-surface-2 shadow-[-6px_8px_20px_rgba(0,0,0,0.5)]"
        >
          {open ? (
            <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3l5 5-5 5" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <Bubble count={unread} />
          )}
        </button>

        <div
          inert={!open}
          className="flex h-full flex-col rounded-l-3xl border-l border-line bg-[#121219] shadow-[-16px_0_40px_rgba(0,0,0,0.55)]"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1.25rem)", paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          {view.kind === "list" ? (
            <ChatList chats={list} onOpen={openChat} />
          ) : (
            <>
              <header className="flex items-center gap-2 border-b border-surface-2 px-4 pb-3">
                {!chatId && (
                  <button onClick={() => setView({ kind: "list" })} aria-label="All chats" className="-ml-1 p-1 text-ink">
                    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[17px] font-bold">{showing?.title ?? "Chat"}</span>
                  {showing?.status && <span className="text-xs text-muted">{showing.status}</span>}
                </span>
              </header>
              <div ref={scroller} className="relative flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                {reactingOn && <div className="fixed inset-0 z-10" onClick={() => setReactingOn(null)} aria-hidden="true" />}
                {showing ? (
                  <Messages messages={showing.messages} reactingOn={reactingOn} onPress={setReactingOn} onReact={onReact} />
                ) : (
                  <p className="py-10 text-center text-sm text-muted">Loading…</p>
                )}
              </div>
              {error && <p className="px-4 pb-2 text-center text-sm text-danger">{error}</p>}
              <form onSubmit={onSend} className="flex items-center gap-2.5 border-t border-surface-2 px-4 pt-2.5">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={MAX_MESSAGE_LENGTH}
                  enterKeyHint="send"
                  placeholder="Message"
                  aria-label="Message"
                  className="min-w-0 flex-1 rounded-full border border-line bg-surface px-4 py-3 text-base text-ink placeholder:text-[#6b6b7a] focus:border-muted focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!text.trim() || sending}
                  aria-label="Send"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent transition disabled:opacity-40"
                >
                  <svg width="20" height="20" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 13V3.5M3.8 7.5L8 3.3l4.2 4.2" fill="none" stroke="var(--color-accent-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </form>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

/** The tab's bubble: green with the unread count in it, or an outline when nothing's unread. */
function Bubble({ count, size = 30 }: { count: number; size?: number }) {
  const h = Math.round((size * 28) / 30);
  if (count > 0) {
    return (
      <svg width={size} height={h} viewBox="0 0 30 28" aria-hidden="true">
        <path d="M4 2h22a3 3 0 0 1 3 3v13a3 3 0 0 1-3 3H13l-6 5v-5H4a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z" fill="var(--color-accent)" />
        <text x="15" y="16" textAnchor="middle" fontSize={count > 99 ? 10 : 13} fontWeight="800" fill="var(--color-accent-ink)" fontFamily="inherit">
          {count > 99 ? "99+" : count}
        </text>
      </svg>
    );
  }
  return (
    <svg width={size} height={h} viewBox="0 0 30 28" aria-hidden="true">
      <path
        d="M4 2.5h22a2.5 2.5 0 0 1 2.5 2.5v13a2.5 2.5 0 0 1-2.5 2.5H13l-6 5v-5H4a2.5 2.5 0 0 1-2.5-2.5V5A2.5 2.5 0 0 1 4 2.5z"
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChatList({ chats, onOpen }: { chats: ChatSummary[] | null; onOpen: (id: string) => void }) {
  const total = chats?.reduce((n, c) => n + c.unread, 0) ?? 0;
  return (
    <>
      <header className="flex flex-col border-b border-surface-2 px-4 pb-3">
        <span className="text-[17px] font-bold">Chats</span>
        {total > 0 && <span className="text-xs text-muted">{total} unread</span>}
      </header>
      <ol className="flex-1 overflow-y-auto overscroll-contain px-3">
        {chats === null ? (
          <li className="py-10 text-center text-sm text-muted">Loading…</li>
        ) : (
          chats.map((c, i) => (
            <li key={c.id} className={i > 0 ? "border-t border-surface-2" : ""}>
              <button onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 px-1 py-3.5 text-left">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className={`truncate ${c.unread ? "font-bold" : "font-semibold"}`}>{c.title}</span>
                  <span className="flex min-w-0 items-center gap-1 text-sm text-muted">
                    {c.last ? (
                      <>
                        <span className="shrink-0">{c.last.sender}:</span>
                        {c.last.text !== null ? <span className="truncate">{c.last.text}</span> : <Sparkles id={c.id} width={70} height={12} />}
                      </>
                    ) : (
                      "No messages yet"
                    )}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {c.last && <span className="text-xs text-muted">{dayOf(c.at) === "Today" ? timeOf(c.at) : dayOf(c.at)}</span>}
                  {c.unread > 0 && <Bubble count={c.unread} size={26} />}
                </span>
              </button>
            </li>
          ))
        )}
      </ol>
    </>
  );
}

function Messages({
  messages,
  reactingOn,
  onPress,
  onReact,
}: {
  messages: ChatMessageView[];
  reactingOn: string | null;
  onPress: (id: string) => void;
  onReact: (messageId: string, kind: string) => void;
}) {
  if (messages.length === 0) return <p className="py-10 text-center text-sm text-muted">No messages yet. Say hi.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {messages.map((m, i) => {
        const day = dayOf(m.at);
        const newDay = i === 0 || dayOf(messages[i - 1].at) !== day;
        return (
          <li key={m.id} className="flex flex-col gap-3">
            {newDay && (
              <div className="flex items-center gap-2.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                <span className="h-px flex-1 bg-line" />
                {day}
                <span className="h-px flex-1 bg-line" />
              </div>
            )}
            <Message m={m} picking={reactingOn === m.id} onPress={onPress} onReact={onReact} />
          </li>
        );
      })}
    </ol>
  );
}

function Message({
  m,
  picking,
  onPress,
  onReact,
}: {
  m: ChatMessageView;
  picking: boolean;
  onPress: (id: string) => void;
  onReact: (messageId: string, kind: string) => void;
}) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | null>(null);
  const canReact = m.text !== null;
  const press = {
    onPointerDown: (e: React.PointerEvent) => {
      if (!canReact) return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => onPress(m.id), LONG_PRESS_MS);
    },
    onPointerMove: (e: React.PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) window.clearTimeout(timer.current);
    },
    onPointerUp: () => window.clearTimeout(timer.current),
    onPointerCancel: () => window.clearTimeout(timer.current),
    onContextMenu: (e: React.MouseEvent) => {
      if (!canReact) return;
      e.preventDefault();
      onPress(m.id);
    },
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const meta = (
    <span className={`text-xs text-muted ${m.mine ? "pr-1" : "pl-1"}`}>
      {m.mine ? timeOf(m.at) : `${m.sender} · ${timeOf(m.at)}`}
      {m.heldUntil !== null && ` · after song ${m.heldUntil}`}
      {m.afterSong !== null && <span className="text-accent"> · after song {m.afterSong}</span>}
    </span>
  );

  return (
    <div className={`relative flex max-w-[250px] flex-col gap-1 ${m.mine ? "items-end self-end" : "items-start self-start"} ${picking ? "z-20" : ""}`}>
      {picking && (
        <div
          className={`absolute bottom-full mb-1 flex gap-0.5 rounded-full border border-line bg-[#1b1b24] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.5)] ${m.mine ? "right-0" : "left-0"}`}
          role="group"
          aria-label="React"
        >
          {REACTIONS.map((r) => {
            const mineAlready = m.reactions.some((x) => x.kind === r.kind && x.mine);
            return (
              <button
                key={r.kind}
                onClick={() => onReact(m.id, r.kind)}
                aria-label={r.kind}
                className={`flex size-9 items-center justify-center rounded-full text-xl ${mineAlready ? "bg-line" : ""}`}
              >
                {r.emoji}
              </button>
            );
          })}
        </div>
      )}
      {meta}
      {m.text === null ? (
        <span className="rounded-[18px] rounded-bl-md bg-surface-2 px-3.5 py-2.5" aria-label={`Hidden until you play song ${m.heldUntil}`}>
          <Sparkles id={m.id} width={sparkleWidth(m.id)} height={20} />
        </span>
      ) : (
        <span
          {...press}
          className={`whitespace-pre-wrap break-words px-3.5 py-2.5 text-[15px] leading-snug select-none [-webkit-touch-callout:none] ${
            m.mine ? "rounded-[18px] rounded-br-md bg-accent font-medium text-accent-ink" : "rounded-[18px] rounded-bl-md bg-surface-2 text-ink"
          } ${picking ? "ring-2 ring-accent ring-offset-2 ring-offset-[#121219]" : ""}`}
        >
          {m.text}
        </span>
      )}
      {m.reactions.length > 0 && (
        <span className="flex gap-1.5">
          {m.reactions.map((r) => (
            <button
              key={r.kind}
              onClick={() => onReact(m.id, r.kind)}
              aria-label={`${r.kind}, ${r.count}`}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                r.mine ? "border-accent bg-accent/15" : "border-line bg-surface"
              }`}
            >
              <span className="text-sm leading-none">{r.emoji}</span>
              {r.count}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/**
 * Invisible ink for a held-back message: specks of light where the words would
 * be. The words never reach the phone; the pattern comes from the message id.
 */
function Sparkles({ id, width, height }: { id: string; width: number; height: number }) {
  const dots = sparkleDots(id, width, height);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="block shrink-0">
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x.toFixed(1)}
          cy={d.y.toFixed(1)}
          r={d.r}
          fill={d.light ? "#ffffff" : "#b9b9c8"}
          fillOpacity={d.o}
          className={`rn-sparkle rn-sparkle-${d.group}`}
        />
      ))}
    </svg>
  );
}
