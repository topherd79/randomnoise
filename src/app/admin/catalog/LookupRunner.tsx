"use client";

import { useEffect, useState } from "react";
import { lookupNext } from "./actions";

/** Apple allows roughly 20 searches a minute; one every 3.5 seconds stays under that. */
const GAP_MS = 3500;

/**
 * Looks up details (artwork, year, genre, links) for new songs one at a time
 * while this page is open. Each finished lookup refreshes the list.
 */
export function LookupRunner({ pending }: { pending: number }) {
  const [remaining, setRemaining] = useState(pending);
  const [stalled, setStalled] = useState(false);

  // A new upload batch arrives as a new `pending` prop.
  const [lastPending, setLastPending] = useState(pending);
  if (pending !== lastPending) {
    setLastPending(pending);
    setRemaining(pending);
  }

  const working = remaining > 0;
  useEffect(() => {
    if (!working) return;
    let cancelled = false;
    (async () => {
      for (;;) {
        try {
          const r = await lookupNext();
          if (cancelled) return;
          setStalled(false);
          setRemaining(r.remaining);
          if (r.remaining === 0) return;
        } catch {
          if (cancelled) return;
          setStalled(true);
        }
        await new Promise((res) => setTimeout(res, GAP_MS));
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [working]);

  if (!working) return null;
  return (
    <p className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
      <span className="inline-block size-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
      Looking up artwork, year, genre and links: {remaining} {remaining === 1 ? "song" : "songs"} to go. This runs
      while the page is open.
      {stalled && <span className="text-danger"> Having trouble reaching the lookup; still trying.</span>}
    </p>
  );
}
