"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuxPlayer, AuxResult, AuxState, AuxTurn } from "@/lib/aux-game";
import { AUX_LATE_ANSWER_MS, auxPhase, clockStart, MISSED_CUE_MS } from "@/lib/aux";
import { formatPoints, formatSeconds, pointsAt, REVEAL_MS, revealedChars } from "@/lib/rules";
import { listNames } from "@/lib/modes";
import { reportClientError } from "@/lib/client-errors";
import { withTimeout } from "@/lib/timeout";
import { SILENCE } from "@/lib/silence";
import { Logo } from "@/components/Logo";

// Pass the Aux on a phone: the lobby, every turn, the results between them.
//
// The page stays open for the whole game and never reloads (a reload would
// lose the "I'm in" tap that lets the phone play its songs by itself), so it
// keeps its own copy of the game: it asks /api/aux/<id> whenever the live feed
// says something changed, and it lines its clock up with the server's, so
// every phone shows the same countdown and the same turn at the same moment.

/** How long to wait for a reply before trying again. */
const REPLY_MS = 8_000;
/** How often to ask for the game while the live feed isn't working. */
const POLL_MS = 3_000;
/** The live feed sends a heartbeat every 25 s; this long without one means it's stuck. */
const STALE_MS = 60_000;
/** The last player's song fades out over this long as the next player's starts. */
const FADE_MS = 800;
/** If the clip hasn't started this long after the cue, show the big Play button. */
const CUE_WATCHDOG_MS = 2_000;

type TapReply = { ok: boolean; error?: string; state?: AuxState; offline?: boolean };

const signed = (points: number) => (points > 0 ? `+${formatPoints(points)}` : formatPoints(points));

export function AuxGame({ initial }: { initial: AuxState }) {
  const id = initial.id;
  const me = initial.me;
  const [state, setState] = useState(initial);
  const latest = useRef(initial);

  // Server time ≈ Date.now() + offset, measured on every reply (the quickest round trip wins).
  const offset = useRef(0);
  const bestRtt = useRef(Infinity);
  const serverNow = useCallback(() => Date.now() + offset.current, []);
  const [now, setNow] = useState(initial.serverNow);

  const apply = useCallback((next: AuxState, sentAt: number, receivedAt: number) => {
    const rtt = receivedAt - sentAt;
    if (rtt < bestRtt.current) {
      bestRtt.current = rtt;
      offset.current = next.serverNow - (sentAt + receivedAt) / 2;
    }
    if (next.serverNow < latest.current.serverNow) return; // overtaken by a newer reply
    latest.current = next;
    setState(next);
  }, []);

  // The clock on screen: about 20 times a second (the answers reveal letter by letter).
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last >= 50) {
        last = t;
        setNow(Date.now() + offset.current);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Ask for the game. One request at a time; one asked for meanwhile runs straight after.
  const busy = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        const sentAt = Date.now();
        try {
          const res = await withTimeout(fetch(`/api/aux/${id}`, { cache: "no-store" }), REPLY_MS);
          // Logged out, or no longer in this game: the page itself explains.
          if (res.status === 401 || res.status === 404) {
            window.location.reload();
            return;
          }
          const body = (await res.json()) as { state?: AuxState };
          if (body.state) apply(body.state, sentAt, Date.now());
        } catch {
          // Offline for a moment: the next check tries again.
        }
      } while (again.current);
    } finally {
      busy.current = false;
    }
  }, [apply, id]);

  const tap = useCallback(
    async (body: Record<string, unknown>): Promise<TapReply> => {
      const sentAt = Date.now();
      try {
        const res = await withTimeout(
          fetch(`/api/aux/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
          REPLY_MS,
        );
        const reply = (await res.json()) as TapReply;
        if (reply.state) apply(reply.state, sentAt, Date.now());
        return reply;
      } catch (err) {
        reportClientError(`aux ${String(body.action)}`, err);
        void refresh();
        return { ok: false, offline: true, error: "That didn't go through. Try again." };
      }
    },
    [apply, id, refresh],
  );

  // Keep the screen on: a phone that goes to sleep can't play its song on cue.
  const wake = useRef<WakeLockSentinel | null>(null);
  const keepAwake = useCallback(async () => {
    try {
      if (wake.current || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      const lock = await navigator.wakeLock.request("screen");
      wake.current = lock;
      lock.addEventListener("release", () => {
        if (wake.current === lock) wake.current = null;
      });
    } catch {
      // Not allowed right now; tried again on the next tap.
    }
  }, []);
  useEffect(() => {
    void keepAwake();
    return () => {
      const lock = wake.current;
      wake.current = null;
      void lock?.release().catch(() => {});
    };
  }, [keepAwake]);

  // Live updates: the server says "this game changed", the phone asks for it.
  useEffect(() => {
    void refresh(); // line the clock up, and catch anything since the page was made
    const source = new EventSource(`/api/live?game=${id}`);
    let wasOpen = false;
    let lastHeard = Date.now();
    const heard = () => (lastHeard = Date.now());
    source.addEventListener("update", () => {
      heard();
      void refresh();
    });
    source.addEventListener("ping", heard);
    source.addEventListener("open", () => {
      heard();
      if (wasOpen) void refresh(); // back after a dropped connection
      wasOpen = true;
    });
    const poll = setInterval(() => {
      const live = source.readyState === EventSource.OPEN && Date.now() - lastHeard < STALE_MS;
      if (document.visibilityState === "visible" && !live) void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      void keepAwake();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);
    return () => {
      source.close();
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [id, keepAwake, refresh]);

  const turn = state.turn;
  const turnKey = turn ? `${turn.gameSongId}:${turn.startsAt}:${turn.endsAt}:${turn.playerId}` : null;

  // The moment a turn should end, ask: the server scores a turn that ran out
  // (no answer = 0) and moves the game on, even if that player's phone died.
  useEffect(() => {
    const t = latest.current.turn;
    if (!t) return;
    const timers = [
      t.endsAt + AUX_LATE_ANSWER_MS + 150,
      t.endsAt + AUX_LATE_ANSWER_MS + 2500,
      t.startsAt + MISSED_CUE_MS,
    ].map((at) => window.setTimeout(() => void refresh(), Math.max(0, at - serverNow())));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [turnKey, refresh, serverNow]);

  // ---------------------------------------------------------------------------
  // Sound: one player for the whole game, so the "I'm in" tap keeps counting.
  // ---------------------------------------------------------------------------

  const audio = useRef<HTMLAudioElement>(null);
  const [unlocked, setUnlocked] = useState(false);
  const unlockedRef = useRef(false);
  const loaded = useRef<string | null>(null);
  /** My turn's clip: cued (for which song), and whether it has started. */
  const cue = useRef<{ gameSongId: string; started: boolean } | null>(null);
  /** Server time my clip started, until the server confirms it. */
  const [localStart, setLocalStart] = useState<{ gameSongId: string; at: number } | null>(null);
  const [missed, setMissed] = useState<string | null>(null);
  const [clipPlaying, setClipPlaying] = useState(false);
  const fading = useRef(false);

  const setSource = useCallback((url: string) => {
    const el = audio.current;
    if (!el || loaded.current === url) return;
    loaded.current = url;
    el.src = url;
    el.load();
  }, []);

  /** Load my next song ahead of time, once the player is free (never cutting a song off). */
  const maybePreload = useCallback(() => {
    const el = audio.current;
    const s = latest.current;
    if (!el || !s.myNextClip || fading.current) return;
    if (!el.paused && !el.ended) return;
    if (s.turn && cue.current?.gameSongId === s.turn.gameSongId) return; // my turn is on: leave its clip be
    setSource(s.myNextClip);
  }, [setSource]);

  /**
   * Inside a tap: play a moment of silence. After that, an iPhone lets this
   * page start the songs by itself, on cue.
   */
  const unlock = useCallback(() => {
    const el = audio.current;
    // iPhones: play through the media channel, which the silent switch doesn't mute.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    void keepAwake();
    if (!el || unlockedRef.current || (!el.paused && !el.ended)) return;
    loaded.current = SILENCE;
    el.src = SILENCE;
    el.play().then(
      () => {
        el.pause();
        unlockedRef.current = true;
        setUnlocked(true);
        maybePreload();
      },
      () => {},
    );
  }, [keepAwake, maybePreload]);

  /** Start my turn's clip from the top (on cue, or from a tap). */
  const playClip = useCallback(() => {
    const el = audio.current;
    const t = latest.current.turn;
    if (!el || !t?.clipUrl || t.playerId !== me) return;
    if (!cue.current || cue.current.gameSongId !== t.gameSongId) cue.current = { gameSongId: t.gameSongId, started: false };
    setSource(t.clipUrl);
    el.volume = 1;
    try {
      el.currentTime = 0;
    } catch {
      // Not loaded yet: it starts from the top anyway.
    }
    el.play().catch(() => {
      if (!cue.current?.started) setMissed(t.gameSongId);
    });
  }, [me, setSource]);

  /** Tell the server my clip started (it keeps the clock). Tries again if the connection hiccups. */
  const reportPlay = useCallback(
    async (gameSongId: string) => {
      for (let i = 0; i < 3; i++) {
        const r = await tap({ action: "play", gameSongId });
        if (r.ok || !r.offline) return;
      }
    },
    [tap],
  );

  function onPlaying() {
    setClipPlaying(true);
    const el = audio.current;
    const t = latest.current.turn;
    if (!el || !t || t.playerId !== me || loaded.current !== t.clipUrl) return;
    if (!cue.current || cue.current.gameSongId !== t.gameSongId) cue.current = { gameSongId: t.gameSongId, started: false };
    if (cue.current.started) return; // a replay
    cue.current.started = true;
    setMissed(null);
    setLocalStart({ gameSongId: t.gameSongId, at: serverNow() });
    void reportPlay(t.gameSongId);
  }

  function onStopped() {
    setClipPlaying(false);
    maybePreload();
  }

  // My turn: the clip starts on cue, by itself.
  useEffect(() => {
    const t = latest.current.turn;
    if (!t || t.playerId !== me || !t.clipUrl || t.startedAt !== null) return;
    if (cue.current?.gameSongId === t.gameSongId) return;
    setSource(t.clipUrl);
    let watchdog = 0;
    const timer = window.setTimeout(
      () => {
        if (serverNow() >= t.endsAt) return;
        cue.current = { gameSongId: t.gameSongId, started: false };
        playClip();
        watchdog = window.setTimeout(() => {
          if (!cue.current?.started) setMissed(t.gameSongId);
        }, CUE_WATCHDOG_MS);
      },
      Math.max(0, t.startsAt - serverNow()),
    );
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(watchdog);
    };
  }, [turnKey, me, playClip, serverNow, setSource]);

  const phase = auxPhase(state, now);
  const turnIsMine = turn?.playerId === me;

  // My song keeps playing through the result and the countdown, then fades
  // as the next player's song starts. Otherwise, get my next song ready.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    if (phase.kind === "turn" && !turnIsMine && !el.paused && loaded.current !== SILENCE && !fading.current) {
      fading.current = true;
      const from = el.volume;
      const t0 = performance.now();
      const step = () => {
        const k = (performance.now() - t0) / FADE_MS;
        if (k >= 1 || el.paused) {
          el.pause();
          el.volume = 1;
          fading.current = false;
          maybePreload();
          return;
        }
        // (iPhones don't let a page change the volume: there it just stops.)
        el.volume = Math.max(0, from * (1 - k));
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      maybePreload();
    }
  }, [phase.kind, turnIsMine, turnKey, state.myNextClip, maybePreload]);

  // The game is over: the page shows the final results and every song.
  useEffect(() => {
    if (phase.kind === "over") window.location.reload();
  }, [phase.kind]);

  // ---------------------------------------------------------------------------
  // Taps
  // ---------------------------------------------------------------------------

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pick, setPick] = useState<{ gameSongId: string; songId: string } | null>(null);

  async function onJoin() {
    unlock();
    setError(null);
    setPending(true);
    const r = await tap({ action: "join" });
    setPending(false);
    if (!r.ok) setError(r.error ?? "Try again.");
  }

  async function onStart(without: boolean) {
    unlock();
    setError(null);
    setPending(true);
    const r = await tap({ action: "start", without });
    setPending(false);
    if (!r.ok) setError(r.error ?? "Try again.");
  }

  async function onPick(songId: string) {
    const t = latest.current.turn;
    if (!t || t.playerId !== me || pick?.gameSongId === t.gameSongId) return;
    setPick({ gameSongId: t.gameSongId, songId });
    setError(null);
    let r = await tap({ action: "answer", gameSongId: t.gameSongId, choiceSongId: songId });
    if (!r.ok && r.error === "Tap Play first.") {
      // The "it started" message got lost: send it, then the answer again.
      await tap({ action: "play", gameSongId: t.gameSongId });
      r = await tap({ action: "answer", gameSongId: t.gameSongId, choiceSongId: songId });
    }
    if (!r.ok) {
      setPick(null);
      setError(r.error ?? "Try again.");
    }
  }

  function onPlayTap() {
    unlock();
    playClip();
  }

  // ---------------------------------------------------------------------------
  // Screens
  // ---------------------------------------------------------------------------

  const players = state.players;
  const mine = players.find((p) => p.userId === me);
  const nameOf = (userId: string) => players.find((p) => p.userId === userId)?.name ?? "Someone";

  // The clock for the answers and points: the server's start when it has one.
  let start: number | null = null;
  if (turn) {
    if (turn.startedAt !== null) start = turn.startedAt;
    else if (turnIsMine) start = localStart?.gameSongId === turn.gameSongId ? localStart.at : null;
    else start = clockStart(turn, now);
  }

  const headerLabel =
    phase.kind === "lobby"
      ? "Lobby"
      : phase.kind === "result" && state.last
        ? `Song ${state.last.position} of ${state.songCount}`
        : turn
          ? `Song ${turn.position} of ${state.songCount}`
          : "";

  let body: React.ReactNode = null;
  if (phase.kind === "lobby" && state.lobby && mine) {
    body = (
      <Lobby
        state={state}
        mine={mine}
        now={now}
        pending={pending}
        onJoin={onJoin}
        onStart={onStart}
      />
    );
  } else if (phase.kind === "result" && state.last) {
    body = (
      <ResultScreen
        last={state.last}
        me={me}
        nameOf={nameOf}
        next={state.status === "active" ? turn : null}
        stillPlaying={state.last.playerId === me && clipPlaying}
      />
    );
  } else if (phase.kind === "countdown" && turn) {
    body = (
      <CountdownScreen
        seconds={phase.seconds}
        turn={turn}
        me={me}
        nameOf={nameOf}
        needsTap={turnIsMine && !unlocked}
        onReady={unlock}
      />
    );
  } else if ((phase.kind === "turn" || phase.kind === "timeUp") && turn) {
    const cueMissed = turnIsMine && start === null && (missed === turn.gameSongId || now - turn.startsAt > MISSED_CUE_MS);
    body = cueMissed ? (
      <MissedCue secondsLeft={Math.max(0, Math.ceil((turn.endsAt - now) / 1000))} onPlay={onPlayTap} />
    ) : (
      <TurnScreen
        turn={turn}
        songCount={state.songCount}
        players={players}
        me={me}
        now={now}
        start={start}
        timeUp={phase.kind === "timeUp"}
        picked={pick?.gameSongId === turn.gameSongId ? pick.songId : null}
        onPick={onPick}
        onReplay={onPlayTap}
        clipPlaying={clipPlaying}
      />
    );
  } else {
    body = <p className="py-16 text-center text-muted">One moment…</p>;
  }

  // Someone who reloaded the page after "I'm in": one tap so their phone can play their next song.
  const showReadyTap =
    !unlocked &&
    state.status === "active" &&
    state.myNextClip !== null &&
    (state.started ? phase.kind !== "countdown" && !(turnIsMine && phase.kind === "turn") : Boolean(mine?.joined) && state.lobby?.starter !== me);

  return (
    <>
      <header className="flex items-center justify-between">
        <Link href="/?stay=1" aria-label="Home">
          <Logo />
        </Link>
        <span className="text-sm text-muted">{headerLabel}</span>
      </header>
      {/* One player for the whole game: see unlock(). */}
      <audio ref={audio} preload="auto" onPlaying={onPlaying} onPause={onStopped} onEnded={onStopped} />
      <div className="flex flex-1 flex-col gap-5 pt-6">
        {body}
        {error && (
          <p className="text-center text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        {showReadyTap && (
          <button
            onClick={unlock}
            className="rounded-2xl border border-accent/40 bg-accent/10 px-4 py-3 text-left text-sm font-semibold text-ink"
          >
            Tap here so your phone can play your song when your turn comes.
          </button>
        )}
        {state.started && <Scores players={players} me={me} turnPlayer={phase.kind === "result" ? state.last?.playerId : turn?.playerId} last={phase.kind === "result" ? state.last : null} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The lobby
// ---------------------------------------------------------------------------

function NumberDot({ n, on }: { n: number; on: boolean }) {
  return (
    <span
      className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
        on ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"
      }`}
    >
      {n}
    </span>
  );
}

function YouTag() {
  return <span className="ml-1.5 rounded-full bg-accent px-2 py-0.5 text-xs font-extrabold text-accent-ink">YOU</span>;
}

function Lobby({
  state,
  mine,
  now,
  pending,
  onJoin,
  onStart,
}: {
  state: AuxState;
  mine: AuxPlayer;
  now: number;
  pending: boolean;
  onJoin: () => void;
  onStart: (without: boolean) => void;
}) {
  const lobby = state.lobby!;
  const missing = state.players.filter((p) => !p.joined);
  const everyoneIn = missing.length === 0;
  const starter = state.players.find((p) => p.userId === lobby.starter);
  const amStarter = lobby.starter === mine.userId;
  const missingNames = listNames(missing.map((p) => p.name));
  const withoutReady = lobby.startWithoutAt !== null && now >= lobby.startWithoutAt;
  const withoutIn = lobby.startWithoutAt === null ? null : Math.max(0, Math.ceil((lobby.startWithoutAt - now) / 1000));
  const per = Math.round(state.songCount / state.players.length);

  let note: string;
  if (!mine.joined) note = `${state.players.length} players · ${state.songCount} songs, ${per} each. When it's your turn, your phone plays the song and only you can answer.`;
  else if (amStarter && everyoneIn) note = "Everyone's in. You go first: tap Start and your song plays after a 3-2-1 countdown.";
  else if (amStarter && mine.order !== 1) note = `You'll go first if you start without ${missingNames}.`;
  else if (everyoneIn) note = `Everyone's in. Waiting for ${starter?.name ?? "player 1"} to start.`;
  else note = `Waiting on ${missingNames}.`;

  return (
    <>
      <section className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Pass the Aux</p>
        <h1 className="text-4xl font-extrabold leading-tight">You&apos;re player {mine.order}</h1>
        <p className="text-[15px] leading-relaxed text-muted">{note}</p>
      </section>
      <ol className="overflow-hidden rounded-2xl bg-surface" aria-label="Turn order">
        {state.players.map((p, i) => {
          const isMe = p.userId === mine.userId;
          return (
            <li
              key={p.userId}
              className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-line" : ""} ${
                isMe ? "bg-accent/10 shadow-[inset_3px_0_0_var(--color-accent)]" : ""
              }`}
            >
              <NumberDot n={p.order} on={isMe} />
              <span className={`flex-1 ${isMe ? "font-bold" : "font-semibold"}`}>
                {p.name}
                {isMe && <YouTag />}
              </span>
              {p.joined ? (
                <span className="text-sm font-semibold text-accent">✓ In</span>
              ) : (
                <span className="text-sm text-muted">Not in yet</span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-auto flex flex-col gap-2.5">
        {!mine.joined ? (
          <>
            <button
              onClick={onJoin}
              disabled={pending}
              className="h-[72px] rounded-full bg-accent text-[22px] font-extrabold text-accent-ink transition active:scale-[0.98] disabled:opacity-70"
            >
              I&apos;m in
            </button>
            <p className="text-center text-[13px] leading-relaxed text-muted">
              This also lets your phone play your songs when your turn comes. Keep this screen open and your volume up.
            </p>
          </>
        ) : amStarter ? (
          <>
            <button
              onClick={() => onStart(false)}
              disabled={!everyoneIn || pending}
              className="h-[72px] rounded-full bg-accent text-[22px] font-extrabold text-accent-ink transition active:scale-[0.98] disabled:opacity-40"
            >
              {everyoneIn ? "▶  Start" : `Start (waiting on ${missingNames})`}
            </button>
            {!everyoneIn &&
              (withoutReady ? (
                <button
                  onClick={() => onStart(true)}
                  disabled={pending}
                  className="h-14 rounded-full border border-line bg-surface-2 text-[17px] font-bold text-ink disabled:opacity-60"
                >
                  Start without {missingNames}
                </button>
              ) : withoutIn !== null ? (
                <p className="text-center text-[13px] text-muted">
                  If {missingNames} {missing.length === 1 ? "isn't" : "aren't"} in within {withoutIn} s, you can start without them.
                </p>
              ) : null)}
            <p className="text-center text-[13px] leading-relaxed text-muted">Keep this screen open and your volume up.</p>
          </>
        ) : (
          <p className="rounded-2xl bg-surface px-4 py-4 text-center font-semibold">
            {everyoneIn ? `Waiting for ${starter?.name ?? "player 1"} to start` : `Waiting on ${missingNames}`}
            <span className="mt-1 block text-[13px] font-normal text-muted">Keep this screen open and your volume up.</span>
          </p>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// A turn
// ---------------------------------------------------------------------------

function SpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className="shrink-0">
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 5.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function TurnScreen({
  turn,
  songCount,
  players,
  me,
  now,
  start,
  timeUp,
  picked,
  onPick,
  onReplay,
  clipPlaying,
}: {
  turn: AuxTurn;
  songCount: number;
  players: AuxPlayer[];
  me: string;
  now: number;
  start: number | null;
  timeUp: boolean;
  picked: string | null;
  onPick: (songId: string) => void;
  onReplay: () => void;
  clipPlaying: boolean;
}) {
  const mine = turn.playerId === me;
  const name = players.find((p) => p.userId === turn.playerId)?.name ?? "Someone";
  const elapsed = start === null ? 0 : Math.max(0, now - start);
  const worth = pointsAt(elapsed);
  const secondsLeft = Math.max(0, Math.ceil((turn.endsAt - now) / 1000));
  const index = players.findIndex((p) => p.userId === turn.playerId);
  const upNext = players.length > 1 ? players[(index + 1) % players.length] : null;
  const canPick = mine && !timeUp && start !== null && picked === null;

  return (
    <>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span
            className={`self-start rounded-full px-2.5 py-1 text-[13px] font-extrabold tracking-[0.08em] ${
              mine ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"
            }`}
          >
            {mine ? "YOUR TURN" : `${name.toUpperCase()}'S TURN`}
          </span>
          <span className="text-[13px] text-muted">
            {timeUp
              ? "Time's up"
              : mine
                ? `Turn ${turn.lap} of ${turn.laps} · ends in ${secondsLeft} s`
                : `Only ${name} can answer · ends in ${secondsLeft} s`}
          </span>
        </div>
        <p className="shrink-0 text-right">
          <span className={`text-[34px] font-extrabold tabular-nums ${mine ? "text-accent" : "text-ink"}`}>{formatPoints(worth)}</span>
          <span className="ml-1 text-sm text-muted">pts</span>
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        <div
          className={`h-full rounded-full ${mine ? "bg-accent" : "bg-muted"}`}
          style={{ width: `${Math.min(1, elapsed / REVEAL_MS) * 100}%` }}
        />
      </div>

      <div className="flex flex-col gap-2.5" role="group" aria-label={mine ? "Choices" : `${name}'s choices`}>
        {turn.choices.map((c) => {
          const n = start === null ? 0 : revealedChars(c.label.length, elapsed);
          const text = (
            <>
              <span>{c.label.slice(0, n)}</span>
              <span className="text-transparent" aria-hidden="true">
                {c.label.slice(n)}
              </span>
            </>
          );
          return mine ? (
            <button
              key={c.songId}
              onClick={() => onPick(c.songId)}
              disabled={!canPick}
              className={`min-h-16 rounded-2xl border-2 px-4 py-3 text-left text-lg font-semibold leading-snug transition ${
                picked === c.songId ? "border-accent bg-surface-2" : "border-line bg-surface active:bg-surface-2"
              } ${timeUp && picked !== c.songId ? "opacity-50" : ""}`}
            >
              {text}
            </button>
          ) : (
            <div
              key={c.songId}
              className="min-h-16 rounded-2xl border-2 border-dashed border-line bg-[#121218] px-4 py-3 text-lg font-semibold leading-snug text-[#c9c9d4]"
            >
              {text}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-2 text-sm text-muted">
        {mine ? (
          <div className="flex items-center gap-3">
            <button
              onClick={onReplay}
              disabled={timeUp}
              className="rounded-full bg-surface-2 px-5 py-3 font-semibold text-ink transition disabled:opacity-50"
            >
              {clipPlaying ? "↺  Replay clip" : "▶  Play the clip again"}
            </button>
            <span className="flex items-center gap-1.5 text-[13px]">
              <SpeakerIcon />
              {picked ? "Sending…" : "On your phone"}
            </span>
          </div>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <SpeakerIcon />
              {start === null ? `Waiting for ${name}'s song to start` : `Playing on ${name}'s phone`}
            </span>
            {upNext?.userId === me && turn.position < songCount && (
              <span className="font-semibold text-accent">You&apos;re up next</span>
            )}
          </>
        )}
      </div>
    </>
  );
}

function MissedCue({ secondsLeft, onPlay }: { secondsLeft: number; onPlay: () => void }) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-3.5">
      <span className="self-start rounded-full bg-accent px-2.5 py-1 text-[13px] font-extrabold tracking-[0.08em] text-accent-ink">
        YOUR TURN
      </span>
      <h1 className="text-4xl font-extrabold leading-tight">Your song didn&apos;t start.</h1>
      <p className="text-base leading-relaxed text-muted">
        Your phone wasn&apos;t ready when your turn came. Tap Play: your turn is already running.
      </p>
      <button
        onClick={onPlay}
        className="mt-3 flex h-20 items-center justify-center gap-3 rounded-full bg-accent text-2xl font-extrabold text-accent-ink transition active:scale-[0.98]"
      >
        ▶  Play
      </button>
      <p className="text-center font-semibold">Turn ends in {secondsLeft} s</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Between turns
// ---------------------------------------------------------------------------

function ResultScreen({
  last,
  me,
  nameOf,
  next,
  stillPlaying,
}: {
  last: AuxResult;
  me: string;
  nameOf: (userId: string) => string;
  next: AuxTurn | null;
  stillPlaying: boolean;
}) {
  const mine = last.playerId === me;
  const name = nameOf(last.playerId);
  const timedOut = last.pickSongId === null;
  const headline = mine
    ? last.correct
      ? "You got it!"
      : timedOut
        ? "Time's up."
        : "Not this time."
    : last.correct
      ? `${name} got it!`
      : timedOut
        ? `Time ran out for ${name}.`
        : `${name} missed it.`;
  const who = mine ? "You" : name;
  const s = last.song;

  return (
    <>
      <section>
        <h1 className={`text-[32px] font-extrabold leading-tight ${last.correct ? "text-accent" : timedOut ? "text-ink" : "text-danger"}`}>
          {headline}
        </h1>
        <p className="mt-1.5 text-[17px] text-muted">
          <span className="font-bold text-ink">{signed(last.points)} points</span>
          {last.elapsedMs !== null && ` · ${formatSeconds(last.elapsedMs)}`}
        </p>
      </section>
      <div className="flex items-center gap-3.5 rounded-2xl bg-surface p-3.5">
        {s.artworkUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.artworkUrl} alt="" width={64} height={64} className="size-16 shrink-0 rounded-xl bg-surface-2 object-cover" />
        ) : (
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-2xl text-muted" aria-hidden="true">
            ♪
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="text-lg font-bold leading-tight">{s.title}</span>
          <span className="text-muted">{s.artist}</span>
          {(s.album || s.year) && <span className="truncate text-[13px] text-muted">{[s.album, s.year].filter(Boolean).join(" · ")}</span>}
        </span>
      </div>
      <ul className="flex flex-col gap-2" aria-label="The choices">
        {last.choices.map((c) => {
          const right = c.songId === last.rightSongId;
          const pickedThis = c.songId === last.pickSongId;
          return (
            <li
              key={c.songId}
              className={`flex justify-between gap-2 rounded-2xl border-2 px-3.5 py-3 font-semibold ${
                right ? "border-accent bg-accent/10" : pickedThis ? "border-danger bg-danger/10" : "border-line text-muted"
              }`}
            >
              <span>{c.label}</span>
              {pickedThis && (
                <span className={`shrink-0 text-[13px] ${right ? "text-accent" : "text-danger"}`}>
                  {right ? "✓" : "✕"} {who}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-center text-sm text-muted">
        {stillPlaying && "Still playing on your phone. "}
        {next ? (next.playerId === me ? "You're up next." : `Next up: ${nameOf(next.playerId)}.`) : "That was the last song."}
      </p>
    </>
  );
}

function CountdownScreen({
  seconds,
  turn,
  me,
  nameOf,
  needsTap,
  onReady,
}: {
  seconds: number;
  turn: AuxTurn;
  me: string;
  nameOf: (userId: string) => string;
  needsTap: boolean;
  onReady: () => void;
}) {
  const mine = turn.playerId === me;
  const name = nameOf(turn.playerId);
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <p className="text-[15px] font-bold tracking-[0.18em] text-accent">{mine ? "YOU'RE UP" : `${name.toUpperCase()}'S UP`}</p>
      <span
        className="flex size-44 items-center justify-center rounded-full border-[6px] border-accent text-[104px] font-extrabold tabular-nums text-accent"
        aria-live="polite"
      >
        {seconds}
      </span>
      <p className="text-[22px] font-bold">{mine ? `Your song starts in ${seconds}…` : `${name}'s song starts in ${seconds}…`}</p>
      <p className="max-w-xs text-[15px] leading-relaxed text-muted">
        {mine ? "It plays on your phone: volume up." : `It plays on ${name}'s phone.`}
      </p>
      {needsTap && (
        <button onClick={onReady} className="rounded-full bg-accent px-6 py-3 font-bold text-accent-ink">
          Tap so your phone can play it
        </button>
      )}
    </section>
  );
}

/** Everyone's points, in turn order: whose turn it is outlined, mine in green. */
function Scores({
  players,
  me,
  turnPlayer,
  last,
}: {
  players: AuxPlayer[];
  me: string;
  turnPlayer: string | undefined;
  last: AuxResult | null;
}) {
  return (
    <section className="mt-auto flex flex-col gap-2 pt-2">
      <h2 className="text-xs font-semibold tracking-[0.18em] text-muted">SCORES</h2>
      <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${players.length}, minmax(0, 1fr))` }}>
        {players.map((p) => {
          const isMe = p.userId === me;
          const isTurn = p.userId === turnPlayer;
          return (
            <li
              key={p.userId}
              className={`flex min-w-0 flex-col gap-0.5 rounded-xl border px-2.5 py-2 ${isMe ? "bg-accent/10" : "bg-surface"} ${
                isTurn ? (isMe ? "border-accent" : "border-ink") : isMe ? "border-transparent" : "border-surface"
              }`}
            >
              <span className={`truncate text-[11px] ${isMe ? "font-bold text-accent" : isTurn ? "font-bold text-ink" : "text-muted"}`}>
                {p.order} · {isMe ? "You" : p.name}
              </span>
              <span className="font-bold tabular-nums">{formatPoints(p.points)}</span>
              {last?.playerId === p.userId && (
                <span className={`text-[11px] font-bold ${last.points > 0 ? "text-accent" : last.points < 0 ? "text-danger" : "text-muted"}`}>
                  {signed(last.points)}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
