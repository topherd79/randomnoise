"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fillSpotifyLink } from "./actions";

type Progress = {
  running: boolean;
  checked: number;
  found: number;
  notFound: number;
  failed: number;
  /** Why it stopped early, if it did. */
  stopped?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Songs looked up before a Spotify key was set only have a Spotify *search*
 * link. This finds the exact track for each, one at a time (Spotify limits how
 * fast you can ask), and fills the same link into past games' results.
 */
export function SpotifyLinksRunner({ ids, configured }: { ids: string[]; configured: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(null);

  if (!configured) {
    return ids.length > 0 ? (
      <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-muted">
        Spotify links are search links for now. Add <code className="text-ink">SPOTIFY_CLIENT_ID</code> and{" "}
        <code className="text-ink">SPOTIFY_CLIENT_SECRET</code> to the app&apos;s variables in Railway to get exact
        track links.
      </p>
    ) : null;
  }
  if (ids.length === 0 && !progress) return null;

  async function run() {
    const p: Progress = { running: true, checked: 0, found: 0, notFound: 0, failed: 0 };
    setProgress({ ...p });
    let failedInARow = 0;
    for (const id of ids) {
      let r = await fillSpotifyLink(id).catch(() => ({ status: "error" as const }));
      if (r.status === "error") {
        // Usually Spotify asking us to slow down: wait and try once more.
        await sleep(5000);
        r = await fillSpotifyLink(id).catch(() => ({ status: "error" as const }));
      }
      if (r.status === "bad_keys") {
        p.stopped =
          "Spotify didn't accept the keys. Check SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Railway, then try again.";
        break;
      }
      p.checked += 1;
      if (r.status === "found") p.found += 1;
      else if (r.status === "not_found") p.notFound += 1;
      else if (r.status === "error") p.failed += 1;
      failedInARow = r.status === "error" ? failedInARow + 1 : 0;
      setProgress({ ...p });
      if (failedInARow >= 3) {
        p.stopped = "Spotify isn't answering right now. Try again later; songs already done are saved.";
        break;
      }
      await sleep(200);
    }
    setProgress({ ...p, running: false });
    router.refresh();
  }

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-surface px-4 py-3 text-sm">
      {!progress ? (
        <>
          <span className="text-muted">
            {ids.length} {ids.length === 1 ? "song has" : "songs have"} a Spotify search link instead of an exact one.
          </span>
          <button
            type="button"
            onClick={run}
            className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink transition hover:bg-line"
          >
            Find exact Spotify links
          </button>
        </>
      ) : progress.running ? (
        <span className="text-muted" role="status">
          Finding exact Spotify links: {progress.checked} of {ids.length} checked · {progress.found} found. Keep this page open.
        </span>
      ) : progress.stopped ? (
        <span className="text-ink" role="status">
          {progress.found > 0 && `${progress.found} exact ${progress.found === 1 ? "link" : "links"} found, then stopped. `}
          {progress.stopped}
        </span>
      ) : (
        <span className="text-muted" role="status">
          Done: {progress.found} exact {progress.found === 1 ? "link" : "links"} found
          {progress.notFound > 0 && `, ${progress.notFound} not on Spotify (they keep a search link)`}
          {progress.failed > 0 && `, ${progress.failed} couldn't be checked (try again later)`}.
        </span>
      )}
    </section>
  );
}
