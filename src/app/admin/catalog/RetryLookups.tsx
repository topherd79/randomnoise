"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { retryNotFoundLookups } from "./actions";

/** Songs Apple's search didn't find: queue them all for another try (the lookup runner does the rest). */
export function RetryLookups({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm">
      <span className="text-muted">
        {count} {count === 1 ? "song" : "songs"} didn&apos;t get artwork and links from the details lookup. The lookup
        now also tries the title on its own, so another try often finds them.
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            await retryNotFoundLookups();
            router.refresh();
          })
        }
        className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line disabled:opacity-50"
      >
        {pending ? "Queuing…" : "Try again"}
      </button>
    </section>
  );
}
