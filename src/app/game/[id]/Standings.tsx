"use client";

import { useState } from "react";
import type { Standing } from "@/lib/games";
import type { Pick, ResultsView } from "@/lib/game-view";
import { formatPoints, formatSeconds } from "@/lib/rules";

const signed = (p: number) => (p > 0 ? `+${formatPoints(p)}` : formatPoints(p));
/** "13.0 s" that never breaks between the number and the "s". */
const secs = (ms: number) => formatSeconds(ms).replace(" ", "\u00a0");

/**
 * The standings. Tapping a name opens that player's song-by-song history,
 * newest first; tapping another name closes it and opens theirs.
 *
 * `songs` only holds songs this viewer may see (ones they've answered, or every
 * song once the game is over), so a history never gives an answer away.
 */
export function Standings({
  standings,
  songs,
  title = "Standings",
  played,
}: {
  standings: Standing[];
  songs: ResultsView[];
  title?: string;
  /** Show "6 of 9 played" for each player (modes with several songs open). */
  played?: { songCount: number };
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">{title}</h2>
      <ol className="divide-y divide-line overflow-hidden rounded-2xl bg-surface">
        {standings.map((s, i) => {
          const isOpen = open === s.userId;
          const history = songs.flatMap((r) => {
            const pick = r.picks.find((p) => p.userId === s.userId);
            // A song counts in the standings once nobody is still to play it.
            return pick ? [{ song: r, pick, counted: !r.picks.some((p) => p.pending) }] : [];
          });
          return (
            <li key={s.userId}>
              <button
                type="button"
                aria-expanded={isOpen}
                disabled={history.length === 0}
                onClick={() => setOpen(isOpen ? null : s.userId)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${isOpen ? "bg-surface-2" : "active:bg-surface-2"}`}
              >
                <span className="w-6 text-center font-bold text-muted tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{s.name}</span>
                  {played && (
                    <span className="block text-xs text-muted">
                      {s.played} of {played.songCount} played
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted">{s.correct} right</span>
                <span className="w-16 text-right font-bold tabular-nums">{formatPoints(s.points)}</span>
                {history.length > 0 && (
                  <span
                    aria-hidden="true"
                    className={`-mr-1 w-4 text-center text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                  >
                    ›
                  </span>
                )}
              </button>
              {isOpen && (
                <ul className="border-t border-line bg-bg/40 px-4 py-1" aria-label={`${s.name}'s songs`}>
                  {history.map(({ song, pick, counted }) => (
                    <HistoryRow key={song.position} position={song.position} title={song.song.title} artist={song.song.artist} pick={pick} counted={counted} />
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
      {songs.length > 0 && <p className="text-xs text-muted">Tap a name to see their songs.</p>}
    </section>
  );
}

function HistoryRow({
  position,
  title,
  artist,
  pick,
  counted,
}: {
  position: number;
  title: string;
  artist: string;
  pick: Pick;
  counted: boolean;
}) {
  const answered = pick.label !== null;
  const detail = pick.pending
    ? "Not played yet"
    : !answered
      ? "No answer"
      : pick.correct
        ? `Got it${pick.elapsedMs !== null ? ` in ${secs(pick.elapsedMs)}` : ""}`
        : `Picked ${pick.label}${pick.elapsedMs !== null ? ` · ${secs(pick.elapsedMs)}` : ""}`;
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          pick.correct ? "bg-accent text-accent-ink" : answered ? "bg-danger/20 text-danger" : "bg-surface-2 text-muted"
        }`}
        aria-label={pick.correct ? "right" : answered ? "wrong" : pick.pending ? "not played yet" : "no answer"}
      >
        {pick.correct ? "✓" : answered ? "✕" : "–"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">
          <span className="text-muted tabular-nums">{position}.</span> <span className="font-semibold">{title}</span>
          <span className="text-muted"> – {artist}</span>
        </span>
        <span className="block text-xs text-muted">
          {detail}
          {!counted && !pick.pending && " · not counted yet"}
        </span>
      </span>
      {pick.points !== null && !pick.pending && (
        <span
          className={`text-sm font-bold tabular-nums ${pick.points > 0 ? "text-accent" : pick.points < 0 ? "text-danger" : "text-muted"}`}
        >
          {signed(pick.points)}
        </span>
      )}
    </li>
  );
}
