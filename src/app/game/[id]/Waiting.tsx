"use client";

import { useState, useTransition } from "react";
import type { Waiter } from "@/lib/game-view";
import { waitingOnText } from "@/lib/modes";
import { nudgeAction } from "../actions";

/**
 * Who still has songs to play in the open round, with a nudge button for
 * each. The page around it updates live (LiveRefresh), so names drop off as
 * people answer and the next songs open on their own.
 */
export function Waiting({
  gameId,
  me,
  waitingOn,
  roundLength,
  note,
}: {
  gameId: string;
  me: string;
  waitingOn: Waiter[];
  roundLength: number;
  note: string;
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
    </section>
  );
}
