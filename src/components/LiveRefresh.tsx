"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const FALLBACK_POLL_MS = 20_000;
/** The server sends a heartbeat every 25 s; this long without one means the feed is stuck. */
const STALE_MS = 60_000;

/**
 * Keeps a page up to date without a manual refresh. The server pushes a small
 * "this game changed" signal (see /api/live) and the page re-renders with
 * fresh data. Also re-checks when the phone wakes up or the tab comes back
 * (iOS pauses background pages), and falls back to checking every 20 seconds
 * whenever the live connection isn't open or has gone quiet (no heartbeat).
 *
 * If a song is playing on the page (the full song after you answer), the
 * refresh waits until it's paused or finished, so it never cuts the music off.
 */
export function LiveRefresh({ gameIds }: { gameIds: string[] }) {
  const router = useRouter();
  const key = [...gameIds].sort().join(",");

  useEffect(() => {
    if (!key) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let waitingForMusic = false;
    const musicPlaying = () => [...document.querySelectorAll("audio")].some((a) => !a.paused && !a.ended);
    const refreshNow = () => {
      if (musicPlaying()) {
        waitingForMusic = true;
        return;
      }
      waitingForMusic = false;
      router.refresh();
    };
    const refresh = () => {
      // Several signals often arrive together (an answer, then the round finishing).
      if (timer) clearTimeout(timer);
      timer = setTimeout(refreshNow, 250);
    };
    // Media events don't bubble, so listen in the capture phase.
    const onMusicStop = () => {
      if (waitingForMusic) refresh();
    };
    document.addEventListener("pause", onMusicStop, true);
    document.addEventListener("ended", onMusicStop, true);

    const params = new URLSearchParams();
    for (const id of key.split(",")) params.append("game", id);
    const source = new EventSource(`/api/live?${params}`);
    let wasOpen = false;
    let lastHeard = Date.now();
    const heard = () => (lastHeard = Date.now());
    source.addEventListener("update", () => {
      heard();
      refresh();
    });
    source.addEventListener("ping", heard);
    source.addEventListener("open", () => {
      heard();
      // Back after a dropped connection: something may have changed meanwhile.
      if (wasOpen) refresh();
      wasOpen = true;
    });

    const poll = setInterval(() => {
      const live = source.readyState === EventSource.OPEN && Date.now() - lastHeard < STALE_MS;
      if (document.visibilityState === "visible" && !live) refreshNow();
    }, FALLBACK_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      source.close();
      clearInterval(poll);
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("pause", onMusicStop, true);
      document.removeEventListener("ended", onMusicStop, true);
    };
  }, [key, router]);

  return null;
}
