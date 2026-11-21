"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import type { Waiter } from "@/lib/game-view";
import { waitingOnText, listNames } from "@/lib/modes";
import { playOnConfirmText, type PlayOnView } from "@/lib/play-on";
import { nudgeAction, playOnVoteAction } from "../actions";

/**
 * Who still has songs to play in the open round, with a nudge button for
 * each. The page around it updates live (LiveRefresh), so names drop off as
 * people answer and the next songs open on their own.
 *
 * When it's down to one player, a while after everyone else finished, the
 * others can vote to play on without them (see src/lib/play-on.ts).
 */
export function Waiting({
  gameId,
  me,
  waitingOn,
  roundLength,
  note,
  playOn,
  afterOut,
}: {
  gameId: string;
  me: string;
  waitingOn: Waiter[];
  roundLength: number;
  note: string;
  playOn: PlayOnView | null;
  /** What opens once that player is out: "songs 7–9 open for the rest of you". */
  afterOut: string;
}) {
  const others = waitingOn.filter((w) => w.userId !== me);
  const [notes, setNotes] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [pending, startTransition] = useTransition();

  if (others.length === 0) return null;
  return (
    <section className="rounded-2xl bg-surface p-4">
      <p className="font-semibold">Waiting on {waitingOnText(others, roundLength)}.</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {others.map((o) => (
          <li key={o.userId} className="flex items-center justify-between gap-3">
            <span>{o.name}</span>
            {notes[o.userId] ? (
              <span className={`text-sm ${notes[o.userId].ok ? "text-accent" : "text-danger"}`}>{notes[o.userId].message}</span>
            ) : (
              <button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const r = await nudgeAction(gameId, o.userId);
                    setNotes((n) => ({ ...n, [o.userId]: r }));
                  })
                }
                className="rounded-full bg-surface-2 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-line disabled:opacity-50"
              >
                Nudge
              </button>
            )}
          </li>
        ))}
      </ul>
      {playOn && <PlayOn key={`${playOn.target.userId}:${playOn.opensAt}`} gameId={gameId} view={playOn} afterOut={afterOut} />}
    </section>
  );
}

const never = () => () => {};
/** A time of day in the phone's own time zone; null on the server (so the first render matches). */
function useClock(at: number): string | null {
  return useSyncExternalStore(
    never,
    () => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    () => null,
  );
}

const hours = (n: number) => `${n} ${n === 1 ? "hour" : "hours"}`;

function PlayOn({ gameId, view, afterOut }: { gameId: string; view: PlayOnView; afterOut: string }) {
  const name = view.target.name;
  // The vote opens on its own while the page is open (the server says how long until then).
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (view.open) return;
    const t = window.setTimeout(() => setOpened(true), view.opensInMs + 500);
    return () => window.clearTimeout(t);
  }, [view.open, view.opensInMs]);
  const open = view.open || opened;
  const [voted, setVoted] = useState(view.iVoted);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const doneAt = useClock(view.othersDoneAt);
  const opensAt = useClock(view.opensAt);

  const voters = view.voters.map((v) => (v.me ? { ...v, voted: v.voted || voted } : v));
  const votes = voters.filter((v) => v.voted).length;
  const action = view.alone ? `Play on without ${name}` : `Vote to play on without ${name}`;

  function vote() {
    setError(null);
    startTransition(async () => {
      const r = await playOnVoteAction(gameId, view.target.userId);
      if (r.ok) {
        setVoted(true);
        setConfirming(false);
      } else setError(r.message);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-2.5 border-t border-line pt-3.5">
      {!open ? (
        <p className="text-sm leading-relaxed text-muted">
          {doneAt && opensAt
            ? view.alone
              ? `You finished at ${doneAt}. From ${opensAt} you can play on without ${name}.`
              : `Everyone else finished at ${doneAt}. From ${opensAt} you can vote to play on without ${name}.`
            : view.alone
              ? `You can play on without ${name} ${hours(Math.round((view.opensAt - view.othersDoneAt) / 3_600_000))} after you finished.`
              : `You can vote to play on without ${name} ${hours(Math.round((view.opensAt - view.othersDoneAt) / 3_600_000))} after everyone else finished.`}
        </p>
      ) : (
        <>
          {votes === 0 || view.alone ? (
            <p className="text-sm leading-relaxed text-muted">
              {name} hasn&apos;t played for {hours(Math.max(view.hoursWaiting, 1))} since {view.alone ? "you" : "everyone else"} finished.
            </p>
          ) : (
            <div className="flex flex-col">
              <p className="font-semibold">
                Play on without {name}?{" "}
                <span className="font-normal text-muted">
                  {votes} of {voters.length} votes
                </span>
              </p>
              <ul className="mt-1">
                {voters.map((v, i) => (
                  <li key={v.userId} className={`flex items-center gap-2.5 py-2 ${i ? "border-t border-line" : ""}`}>
                    {v.voted ? (
                      <span className="flex size-5.5 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-accent-ink">✓</span>
                    ) : (
                      <span className="size-5.5 rounded-full border-[1.5px] border-dashed border-line" />
                    )}
                    <span className="flex-1 font-semibold">{v.me ? "You" : v.name}</span>
                    <span className={`text-sm ${v.voted ? "text-accent" : "text-muted"}`}>{v.voted ? "Voted" : "Not yet"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!voted && (
            <button
              onClick={() => setConfirming(true)}
              className="rounded-full border border-danger/35 bg-danger/15 py-3 font-bold text-danger transition active:scale-[0.99]"
            >
              {action}
            </button>
          )}
          {!voted && votes === 0 && (
            <p className="text-sm leading-relaxed text-muted">
              {view.alone
                ? "You'd finish the game alone. A game played alone never counts as a win."
                : `It takes everyone's vote: ${listNames([...voters.filter((v) => !v.me).map((v) => v.name), "you"])}.`}
            </p>
          )}
        </>
      )}

      {confirming && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/50" onClick={() => !pending && setConfirming(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Play on without ${name}?`}
            onClick={(e) => e.stopPropagation()}
            className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-t-3xl bg-surface px-5 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)] shadow-[0_-16px_40px_rgba(0,0,0,0.5)]"
          >
            <span className="mx-auto -mt-1 mb-1 h-1.5 w-10 rounded-full bg-line" aria-hidden="true" />
            <p className="text-[22px] font-bold">Play on without {name}?</p>
            <p className="leading-relaxed text-muted">{playOnConfirmText({ ...view, voters }, afterOut)}</p>
            <p className="leading-relaxed text-muted">
              {name} stays in the results, crossed out, with the points they have, and stays in your group&apos;s chat. They
              aren&apos;t told about this.{" "}
              {view.alone ? "A game played alone never counts as a win. " : ""}
              You can&apos;t take your vote back.
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="mt-2 flex flex-col gap-2.5">
              <button
                onClick={vote}
                disabled={pending}
                className="rounded-full bg-danger py-3.5 font-bold text-[#1a0a0e] transition disabled:opacity-60"
              >
                {pending ? "Voting…" : action}
              </button>
              <button onClick={() => setConfirming(false)} disabled={pending} className="rounded-full bg-surface-2 py-3.5 font-bold text-ink">
                Not yet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
