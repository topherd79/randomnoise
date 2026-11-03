"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { nudgeAction } from "../actions";

function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * Who still has to answer (never what anyone picked), with a nudge button for
 * each. Checks back every 20 seconds so the results show up on their own.
 */
export function Waiting({
  gameSongId,
  me,
  waitingOn,
}: {
  gameSongId: string;
  me: string;
  waitingOn: { userId: string; name: string }[];
}) {
  const router = useRouter();
  const others = waitingOn.filter((w) => w.userId !== me);
  const [notes, setNotes] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (others.length === 0) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 20_000);
    return () => clearInterval(id);
  }, [others.length, router]);

  if (others.length === 0) return null;
  return (
    <section className="rounded-2xl bg-surface p-4">
      <p className="font-semibold">Waiting on {names(others.map((o) => o.name))}.</p>
      <p className="mt-1 text-sm text-muted">Everyone sees the results once the last person answers.</p>
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
                    const r = await nudgeAction(gameSongId, o.userId);
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
