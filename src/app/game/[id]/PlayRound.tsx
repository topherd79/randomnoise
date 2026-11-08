"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CUTOFF_MS, GUESS_PENALTY, REVEAL_MS, formatPoints, pointsAt, revealedChars } from "@/lib/rules";
import type { AnswerResult } from "@/lib/games";
import { answerSongAction, startSongAction } from "../actions";

type Props = {
  gameSongId: string;
  position: number;
  total: number;
  clipUrl: string;
  choices: { songId: string; label: string }[];
  /** Server time the clock started, if this player already tapped Play. */
  startedAt: number | null;
  /** Server time when the page was rendered, to line our clock up with the server's. */
  serverNow: number;
  /** How scoring works, shown before a player's first song of the game (not before every one). */
  showRules?: boolean;
};

type Phase = "ready" | "starting" | "playing" | "sending" | "done";

export function PlayRound({ gameSongId, position, total, clipUrl, choices, startedAt, serverNow, showRules = true }: Props) {
  const router = useRouter();
  const audio = useRef<HTMLAudioElement>(null);
  const section = useRef<HTMLElement>(null);
  // serverTime ≈ Date.now() + offset
  const [offset] = useState(() => serverNow - Date.now());
  // Local Date.now() when the clock started (from the server's start time if we're resuming).
  const [clockStart, setClockStart] = useState<number | null>(() => (startedAt ? startedAt - offset : null));
  const [phase, setPhase] = useState<Phase>(startedAt ? "playing" : "ready");
  const [elapsed, setElapsed] = useState(0);
  const [clipPlaying, setClipPlaying] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clockStarted = useRef(Boolean(startedAt));

  // Tick the clock while choices are revealing (and a little after, for the points display).
  useEffect(() => {
    if (clockStart === null || phase === "done") return;
    let frame = 0;
    let last = -1;
    const tick = () => {
      const e = Date.now() - clockStart;
      const bucket = Math.floor(e / 50);
      if (bucket !== last) {
        last = bucket;
        setElapsed(e);
      }
      if (e < CUTOFF_MS + 1000) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clockStart, phase]);

  function onPlay() {
    const el = audio.current;
    if (!el) return;
    setError(null);
    // iPhones: play through the media channel, which the silent switch doesn't mute.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    if (phase === "ready") setPhase("starting");
    el.currentTime = 0;
    // play() must be called inside the tap itself, or iOS refuses to play.
    el.play().catch(() => {
      if (!clockStarted.current) setPhase("ready");
      setError("The clip didn't play. Check your volume and tap again.");
    });
  }

  /** The clock starts when the sound does (not when the tap happens), on the server too. */
  function onPlaying() {
    setClipPlaying(true);
    if (clockStarted.current) return;
    clockStarted.current = true;
    setClockStart(Date.now());
    setPhase("playing");
    // Earlier results may sit above this song: bring the choices into view.
    section.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    startSongAction(gameSongId).then((r) => {
      if (r.ok) setClockStart(r.startedAt - offset);
      else setError(r.error);
    });
  }

  async function onPick(songId: string) {
    if (phase !== "playing") return;
    setPicked(songId);
    setPhase("sending");
    const r = await answerSongAction(gameSongId, songId);
    if (!r.ok) {
      setError(r.error);
      setPicked(null);
      setPhase("playing");
      return;
    }
    audio.current?.pause();
    setResult(r.result);
    setPhase("done");
    // Show the full "you answered" page (song, full track, links, who's left).
    setTimeout(() => router.refresh(), 1600);
  }

  const started = phase === "playing" || phase === "sending" || phase === "done";
  const shownElapsed = result ? result.elapsedMs : elapsed;
  const worth = pointsAt(shownElapsed);
  const revealPct = Math.min(1, shownElapsed / REVEAL_MS);

  return (
    <section ref={section} className="flex flex-1 flex-col scroll-mt-4">
      <audio
        ref={audio}
        src={clipUrl}
        preload="auto"
        onPlaying={onPlaying}
        onPause={() => setClipPlaying(false)}
        onEnded={() => setClipPlaying(false)}
      />

      {!started ? (
        <div className="flex flex-1 flex-col justify-center py-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
            Song {position} of {total}
          </p>
          <h1 className="mt-3 text-4xl font-bold leading-tight">Ready?</h1>
          {showRules && (
            <>
              <p className="mt-4 text-lg leading-relaxed text-muted">
                The clip and the clock start together. Four answers appear letter by letter; the sooner you pick
                the right one, the more points it&apos;s worth.
              </p>
              <ul className="mt-4 space-y-1 text-sm leading-relaxed text-muted">
                <li>
                  Right: {formatPoints(1000)} at the start, sliding to 100 once all the answers are showing (
                  {REVEAL_MS / 1000} s).
                </li>
                {GUESS_PENALTY && <li>Wrong: you lose a third of what a right answer would have earned.</li>}
                <li>Turn your volume up. You can replay the clip, but the clock keeps running.</li>
              </ul>
            </>
          )}
          <button
            onClick={onPlay}
            disabled={phase === "starting"}
            className={`${showRules ? "mt-10" : "mt-6"} flex h-20 w-full items-center justify-center gap-3 rounded-full bg-accent text-2xl font-bold text-accent-ink transition active:scale-[0.98] disabled:opacity-70`}
          >
            {phase === "starting" ? "Loading…" : "▶  Play"}
          </button>
        </div>
      ) : (
        <div className="flex flex-1 flex-col pt-4">
          <div className="flex items-end justify-between">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
              Song {position} of {total}
            </p>
            <p className="text-right">
              <span className={`text-3xl font-bold tabular-nums ${phase === "done" ? "" : "text-accent"}`}>
                {phase === "done" && result ? (result.points > 0 ? `+${formatPoints(result.points)}` : formatPoints(result.points)) : formatPoints(worth)}
              </span>
              <span className="ml-1 text-sm text-muted">pts</span>
            </p>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
            <div className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${revealPct * 100}%` }} />
          </div>

          <div className="mt-6 flex flex-col gap-3" role="group" aria-label="Choices">
            {choices.map((c) => {
              const n = revealedChars(c.label.length, shownElapsed);
              const isPicked = picked === c.songId;
              const isRight = result?.rightSongId === c.songId;
              const style =
                phase === "done"
                  ? isRight
                    ? "border-accent bg-accent/15"
                    : isPicked
                      ? "border-danger bg-danger/10"
                      : "border-line opacity-50"
                  : isPicked
                    ? "border-accent bg-surface-2"
                    : "border-line bg-surface active:bg-surface-2";
              return (
                <button
                  key={c.songId}
                  onClick={() => onPick(c.songId)}
                  disabled={phase !== "playing"}
                  className={`min-h-16 rounded-2xl border-2 px-4 py-3 text-left text-lg font-semibold leading-snug transition ${style}`}
                >
                  {/* The rest of the text is there but invisible, so the buttons don't change size. */}
                  <span>{c.label.slice(0, n)}</span>
                  <span className="text-transparent" aria-hidden="true">
                    {c.label.slice(n)}
                  </span>
                </button>
              );
            })}
          </div>

          {phase === "done" && result ? (
            <p className={`mt-6 text-center text-xl font-bold ${result.correct ? "text-accent" : "text-danger"}`}>
              {result.correct ? "Got it!" : "Not that one."}
            </p>
          ) : (
            <div className="mt-6 flex flex-col items-center gap-2">
              <button
                onClick={onPlay}
                disabled={phase !== "playing"}
                className="rounded-full bg-surface-2 px-5 py-3 font-semibold text-ink transition hover:bg-line disabled:opacity-50"
              >
                {clipPlaying ? "↺  Replay clip" : "▶  Play the clip again"}
              </button>
              {shownElapsed > CUTOFF_MS ? (
                <p className="text-center text-sm text-muted">Too late for points now, but pick one so the game can move on.</p>
              ) : !clipPlaying && phase === "playing" && startedAt ? (
                <p className="text-center text-sm text-muted">Your clock kept running while you were away.</p>
              ) : null}
            </div>
          )}
          {error && <p className="mt-4 text-center text-sm text-danger">{error}</p>}
        </div>
      )}
    </section>
  );
}
