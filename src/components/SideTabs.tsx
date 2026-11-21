"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChatMessageView, ChatSummary, ChatView } from "@/lib/chat";
import { MAX_MESSAGE_LENGTH, REACTIONS, sparkleDots, sparkleWidth, stampBefore, stampText } from "@/lib/chat-rules";
import { reportClientError } from "@/lib/client-errors";
import { withTimeout } from "@/lib/timeout";
import { PanelNavProvider, type PanelPage } from "./PanelNav";
import { PanelPageView } from "./PanelPages";

// The side tabs: two small tabs on the right edge, stacked with no gap. The
// chat tab (on top) has the unread count in its bubble; the podium tab under
// it opens the standings on a game page, or your past games on the home page.
// Tap a tab and its panel slides in over the page; the open tab joins its panel
// like a folder tab (same background, no line between them) and the other tab
// keeps its outline, so tapping it switches panels. Tap the open tab again (or
// the page behind) and the panel slides back. Tabs and panels share one
// see-through background; what's inside them stays solid.
//
// Nothing in a panel takes you to another page: a past game, or a name's
// profile, opens in the panel with a back arrow (PanelLink).
//
// The chat keeps its own copy (fetch, never a page reload), updated live
// through /api/live. Both tabs hide while a song is playing (PlayRound sends
// "rn:song"). Held-back messages arrive without their words and show as sparkles.
// The chat opens at its newest message and stays there (new messages, the
// keyboard coming up) unless you've scrolled up to read.

const REPLY_MS = 8_000;
const POLL_MS = 30_000;
const LONG_PRESS_MS = 450;

type ChatProps = {
  /** The game page's chat. Without it (the home page) the tab opens your list of chats. */
  chatId?: string;
  /** The chats to listen to for new messages. */
  chatIds: string[];
  /** Games in progress in these chats: answering a song can unlock held-back messages. */
  gameIds: string[];
  /** Unread messages when the page was made. */
  unread: number;
};

/** The podium tab's panel: the standings (game page) or your past games (home page). */
type PodiumProps = {
  /** Names the tab for screen readers: "Standings", "Past games". */
  label: string;
  title: string;
  subtitle?: string;
  content: React.ReactNode;
};

type Props = { chat?: ChatProps; podium?: PodiumProps };
type Tab = "chat" | "podium";

/** Each tab's height; they sit 70% of the way down the screen, chat first. */
const TAB_H = 58;
/** One see-through level for the tabs and the panels. */
const GLASS = "bg-[rgba(18,18,25,0.55)] backdrop-blur-[10px]";

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

export function SideTabs({ chat: chatProps, podium }: Props) {
  const chatId = chatProps?.chatId;
  const chatIds = chatProps?.chatIds ?? [];
  const gameIds = chatProps?.gameIds ?? [];
  const initialUnread = chatProps?.unread ?? 0;
  const tabs: Tab[] = [...(chatProps ? ["chat" as const] : []), ...(podium ? ["podium" as const] : [])];
  const [open, setOpen] = useState<Tab | null>(null);
  /** What the panel shows: stays put while it slides away. */
  const [shown, setShown] = useState<Tab>(tabs[0] ?? "chat");
  const [hidden, setHidden] = useState(false);
  const [view, setView] = useState<View>(chatId ? { kind: "chat", id: chatId } : { kind: "list" });
  const [list, setList] = useState<ChatSummary[] | null>(null);
  const [chat, setChat] = useState<ChatView | null>(null);
  const [unread, setUnread] = useState(initialUnread);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactingOn, setReactingOn] = useState<string | null>(null);
  /** Pages opened inside the podium panel (a past game, a profile), the one on top showing. */
  const [pages, setPages] = useState<PanelPage[]>([]);
  const aside = useRef<HTMLElement>(null);
  const viewRef = useRef(view);
  const openRef = useRef(false);
  useEffect(() => {
    viewRef.current = view;
    openRef.current = open === "chat";
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
      if (playing) setOpen(null);
    };
    window.addEventListener("rn:song", onSong);
    return () => window.removeEventListener("rn:song", onSong);
  }, []);

  // While a panel is open: the page behind doesn't scroll, and doesn't refresh under you (LiveRefresh waits).
  const isOpen = open !== null;
  useEffect(() => {
    if (!isOpen) return;
    const root = document.documentElement;
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.dataset.panelOpen = "1";
    return () => {
      document.body.style.overflow = before;
      delete root.dataset.panelOpen;
      window.dispatchEvent(new Event("rn:panel-closed"));
    };
  }, [isOpen]);

  // iPhones: keep the panel (and its message box) above the keyboard.
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!isOpen || !vv) return;
    const fit = () => setBox({ top: vv.offsetTop, height: vv.height });
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
    };
  }, [isOpen]);

  function close() {
    // A song from a past game stops when its panel slides away.
    aside.current?.querySelectorAll("audio").forEach((a) => a.pause());
    setOpen(null);
    setReactingOn(null);
  }

  /** Tap a tab: open its panel, switch to it from the other one, or (if it's open) slide it back. */
  function toggle(which: Tab) {
    if (open === which) return close();
    setOpen(which);
    setShown(which);
    setError(null);
    setReactingOn(null);
    // The podium panel opens at its top (the standings, or your list of past games).
    if (which === "podium") return setPages([]);
    openRef.current = true;
    const v = chatId ? ({ kind: "chat", id: chatId } as View) : view;
    setView(v);
    viewRef.current = v;
    pin(true);
    toBottom();
    if (v.kind === "chat") void loadChat(v.id, true).then(loadCounts);
    else void loadCounts();
  }

  function openChat(id: string) {
    setChat(null);
    setView({ kind: "chat", id });
    viewRef.current = { kind: "chat", id };
    pin(true);
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
    pin(true);
    const ok = await post(v.id, { action: "send", text });
    setSending(false);
    if (ok) setText("");
  }

  function onReact(messageId: string, kind: string) {
    const v = viewRef.current;
    setReactingOn(null);
    if (v.kind === "chat") void post(v.id, { action: "react", messageId, kind });
  }

  // Keep the newest message in view while you're at the bottom: when it opens, when a message comes
  // in, and when the panel gets shorter (the keyboard coming up). Scroll up to read and it stays put.
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const chatShown = !hidden && shown === "chat" && view.kind === "chat";
  useEffect(() => {
    const el = scroller.current;
    if (!chatShown || !el || typeof ResizeObserver === "undefined") return;
    const resized = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
    });
    resized.observe(el);
    return () => resized.disconnect();
  }, [chatShown]);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [chat]);
  /** Stay at the newest message from now on (or, scrolled up, stop). */
  const pin = useCallback((on: boolean) => {
    pinnedRef.current = on;
  }, []);
  function toBottom() {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }
  function onScroll() {
    const el = scroller.current;
    if (el) pin(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }

  if (hidden || tabs.length === 0) return null;

  const showing = view.kind === "chat" ? chat : null;
  const panelStyle: React.CSSProperties = {
    width: "min(340px, calc(100vw - 56px))",
    transform: isOpen ? "translateX(0)" : "translateX(100%)",
    ...(isOpen && box ? { top: box.top, height: box.height, bottom: "auto" } : {}),
  };
  // Where the open tab joins the panel: the panel's edge line has an opening there.
  const joinAt = Math.max(0, tabs.indexOf(open ?? shown));

  return (
    <>
      {/* The page behind: dimmed, and tapping it slides the panel back. */}
      <div
        onClick={close}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/45 transition-opacity duration-200 ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        ref={aside}
        className="fixed top-0 right-0 bottom-0 z-50 transition-transform duration-[260ms] ease-out"
        style={panelStyle}
        aria-label={shown === "chat" ? "Chat" : podium?.label}
      >
        {/* Closed: one stack on the screen's edge, with a shadow behind it. */}
        {!isOpen && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -left-[50px] w-[50px] rounded-l-2xl shadow-[-6px_8px_20px_rgba(0,0,0,0.25)]"
            style={{ top: "70%", height: tabs.length * TAB_H }}
          />
        )}
        {tabs.map((t, i) => (
          <button
            key={t}
            onClick={() => toggle(t)}
            aria-label={
              t === "chat"
                ? open === "chat"
                  ? "Close chat"
                  : unread > 0
                    ? `Chat, ${unread} unread`
                    : "Chat"
                : open === "podium"
                  ? `Close ${podium!.label.toLowerCase()}`
                  : podium!.label
            }
            className={`absolute -left-[50px] flex w-[50px] items-center justify-center ${GLASS} ${tabEdges(i, tabs.length, open === null ? null : tabs.indexOf(open))}`}
            style={{ top: `calc(70% + ${i * TAB_H}px)`, height: TAB_H }}
          >
            {open === t ? (
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <path d="M6 3l5 5-5 5" fill="none" stroke="var(--color-accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : t === "chat" ? (
              <Bubble count={unread} />
            ) : (
              <Podium />
            )}
          </button>
        ))}

        <div
          inert={!isOpen}
          className={`relative flex h-full flex-col rounded-l-3xl ${GLASS} shadow-[-16px_0_40px_rgba(0,0,0,0.55)]`}
          style={{ paddingTop: "max(env(safe-area-inset-top), 1.25rem)", paddingBottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          {/* The panel's edge, open where its tab joins it. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-6 w-px bg-line"
            style={{ height: `calc(70% + ${joinAt * TAB_H + 1}px - 1.5rem)` }}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-0 bottom-6 w-px bg-line"
            style={{ top: `calc(70% + ${(joinAt + 1) * TAB_H - 1}px)` }}
          />
          {shown === "podium" && podium ? (
            // Links inside open their page here, on top; back returns to the page under it, as you left it.
            <PanelNavProvider value={(page) => setPages((ps) => [...ps, page])}>
              <div className={pages.length ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
                <header className="flex flex-col border-b border-surface-2 px-4 pb-3">
                  <span className="text-[17px] font-bold">{podium.title}</span>
                  {podium.subtitle && <span className="text-xs text-muted">{podium.subtitle}</span>}
                </header>
                <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">{podium.content}</div>
              </div>
              {pages.map((page, i) => (
                <div key={`${i}-${page.kind}-${page.id}`} className={i === pages.length - 1 ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                  <header className="flex flex-col border-b border-surface-2 px-4 pb-3">
                    <button
                      type="button"
                      onClick={() => setPages((ps) => ps.slice(0, i))}
                      className="-ml-1 mb-1 flex max-w-full items-center gap-1 self-start py-0.5 text-sm font-semibold text-accent"
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
                        <path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate">{i === 0 ? podium.title : pages[i - 1].title}</span>
                    </button>
                    <span className="text-[17px] font-bold">{page.title}</span>
                    {page.subtitle && <span className="text-xs text-muted">{page.subtitle}</span>}
                  </header>
                  <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                    <PanelPageView page={page} />
                  </div>
                </div>
              ))}
            </PanelNavProvider>
          ) : view.kind === "list" ? (
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
              <div ref={scroller} onScroll={onScroll} className="relative flex flex-1 flex-col overflow-y-auto overscroll-contain px-4 py-3">
                {reactingOn && <div className="fixed inset-0 z-10" onClick={() => setReactingOn(null)} aria-hidden="true" />}
                {showing ? (
                  <Messages messages={showing.messages} reactingOn={reactingOn} onPress={setReactingOn} onReact={onReact} />
                ) : (
                  <p className="py-10 text-center text-sm text-muted">Loading…</p>
                )}
              </div>
              {error && <p className="px-4 pb-2 text-center text-sm text-danger">{error}</p>}
              <form onSubmit={onSend} className="flex items-center gap-2 border-t border-surface-2 px-4 pt-2">
                {/* 16 px text: any smaller and iPhones zoom the page in when you tap the box. */}
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={() => {
                    // Typing: back to the newest message, and it stays there as the keyboard comes up.
                    pin(true);
                    toBottom();
                  }}
                  maxLength={MAX_MESSAGE_LENGTH}
                  enterKeyHint="send"
                  placeholder="Message"
                  aria-label="Message"
                  className="min-w-0 flex-1 rounded-full border border-line bg-surface px-3.5 py-1.5 text-base leading-[22px] text-ink placeholder:text-[#6b6b7a] focus:border-muted focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!text.trim() || sending}
                  aria-label="Send"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent transition disabled:opacity-40"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
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

/**
 * A tab's outline. Closed: the tabs make one stack (rounded at its outer
 * corners, a line between them). Open: the open tab's outline runs into the
 * panel's edge (it has no right side, so the two read as one piece); the other
 * tab keeps its own outline, except the side it shares with the open tab.
 */
function tabEdges(i: number, count: number, openAt: number | null): string {
  const line = "border-[#3a3a48]/55";
  if (openAt === null) {
    if (count === 1) return `rounded-l-2xl border border-r-0 ${line}`;
    return i === 0 ? `rounded-tl-2xl border border-r-0 ${line}` : `rounded-bl-2xl border-b border-l ${line}`;
  }
  if (i === openAt) return "rounded-l-2xl border border-r-0 border-line shadow-[-8px_6px_18px_rgba(0,0,0,0.35)]";
  return i > openAt ? `rounded-bl-2xl border-b border-l ${line}` : `rounded-tl-2xl border-t border-l ${line}`;
}

/** The podium: 1st in the middle (tallest), 2nd on the left, 3rd on the right. */
function Podium() {
  return (
    <svg width="30" height="28" viewBox="0 0 30 28" aria-hidden="true">
      <rect x="1.5" y="11" width="8.6" height="15.5" rx="1.6" fill="var(--color-accent)" />
      <rect x="10.7" y="3.5" width="8.6" height="23" rx="1.6" fill="var(--color-accent)" />
      <rect x="19.9" y="15.5" width="8.6" height="11" rx="1.6" fill="var(--color-accent)" />
    </svg>
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
    // A short chat sits at the bottom, right above the message box.
    <ol className="mt-auto flex flex-col gap-[3px]">
      {messages.map((m, i) => {
        const prev = i > 0 ? messages[i - 1] : null;
        // A date and time only for the first message and after an hour or more of quiet.
        const stamped = stampBefore(m.at, prev?.at ?? null);
        // A new run of messages: after a time line, or from someone else.
        const fresh = stamped || !prev || prev.mine !== m.mine || prev.sender !== m.sender;
        return (
          <li key={m.id} className={`flex flex-col ${fresh && !stamped ? "mt-1.5" : ""}`}>
            {stamped && <p className={`${i > 0 ? "mt-2.5" : ""} mb-1 text-center text-[10px] font-semibold text-muted`}>{stampText(m.at)}</p>}
            <Message m={m} named={fresh} picking={reactingOn === m.id} onPress={onPress} onReact={onReact} />
          </li>
        );
      })}
    </ol>
  );
}

function Message({
  m,
  named,
  picking,
  onPress,
  onReact,
}: {
  m: ChatMessageView;
  /** First of a run from this sender: their name goes above it. */
  named: boolean;
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

  const tag =
    m.heldUntil !== null ? (
      <> · after song {m.heldUntil}</>
    ) : m.afterSong !== null ? (
      <span className="text-accent"> · after song {m.afterSong}</span>
    ) : null;
  const showName = !m.mine && (named || tag !== null);
  const reacted = m.reactions.length > 0;

  return (
    <div
      className={`relative flex max-w-[240px] flex-col gap-0.5 ${m.mine ? "items-end self-end" : "items-start self-start"} ${
        reacted && !showName ? "mt-2" : ""
      } ${picking ? "z-20" : ""}`}
    >
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
      {showName && (
        <span className="pl-2.5 text-[10px] text-muted">
          {m.sender}
          {tag}
        </span>
      )}
      <span className="relative block max-w-full">
        {m.text === null ? (
          <span
            className="block rounded-[14px] rounded-bl-[4px] bg-surface-2 px-2.5 py-[5px]"
            aria-label={`Hidden until you play song ${m.heldUntil}`}
          >
            <Sparkles id={m.id} width={sparkleWidth(m.id)} height={12} />
          </span>
        ) : (
          <span
            {...press}
            className={`block whitespace-pre-wrap break-words px-2.5 py-[5px] text-[12px] leading-[1.3] select-none [-webkit-touch-callout:none] ${
              m.mine ? "rounded-[14px] rounded-br-[4px] bg-accent font-medium text-accent-ink" : "rounded-[14px] rounded-bl-[4px] bg-surface-2 text-ink"
            } ${picking ? "ring-2 ring-accent ring-offset-2 ring-offset-[#121219]" : ""}`}
          >
            {m.text}
          </span>
        )}
        {/* Reactions perch on the bubble's top-right corner; a count only when there's more than one. Tap to react. */}
        {reacted && (
          <button
            type="button"
            onClick={() => onPress(m.id)}
            aria-label={`Reactions: ${m.reactions.map((r) => `${r.kind} ${r.count}`).join(", ")}`}
            className="absolute -top-2.5 -right-[9px] inline-flex items-center gap-1 rounded-full border border-line bg-surface px-[5px] py-px text-[10px] leading-none font-bold text-ink"
          >
            {m.reactions.map((r) => (
              <span key={r.kind} className="inline-flex items-center gap-px">
                <span className="text-[11px] leading-none">{r.emoji}</span>
                {r.count > 1 && r.count}
              </span>
            ))}
          </button>
        )}
      </span>
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
