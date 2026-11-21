"use client";

import { useEffect, useState } from "react";
import type { GameView } from "@/lib/game-view";
import type { ProfileCard } from "@/lib/profiles";
import { withTimeout } from "@/lib/timeout";
import { Final } from "@/app/game/[id]/Final";
import { ProfileSummary } from "@/app/profile/parts";
import type { PanelPage } from "./PanelNav";

// What a side panel shows when you open a past game or a profile inside it.
// Each page fetches its own copy (never a page reload).

const REPLY_MS = 8_000;

type Loaded<T> = { data: T } | { failed: true } | null;

function useFetched<T>(url: string, pick: (json: Record<string, unknown>) => T | undefined, attempt: number): Loaded<T> {
  const [state, setState] = useState<{ url: string; attempt: number; loaded: Loaded<T> }>({ url, attempt, loaded: null });
  useEffect(() => {
    let live = true;
    withTimeout(fetch(url, { cache: "no-store" }), REPLY_MS)
      .then((res) => res.json() as Promise<Record<string, unknown>>)
      .then((json) => {
        const data = pick(json);
        if (live) setState({ url, attempt, loaded: data === undefined ? { failed: true } : { data } });
      })
      .catch(() => {
        if (live) setState({ url, attempt, loaded: { failed: true } });
      });
    return () => {
      live = false;
    };
    // `pick` is a plain function of the reply; the page only changes with the url or a retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt]);
  // A retry (or another page) shows "Loading…" until its reply comes.
  return state.url === url && state.attempt === attempt ? state.loaded : null;
}

export function PanelPageView({ page }: { page: PanelPage }) {
  return page.kind === "game" ? <GamePage id={page.id} /> : <ProfilePage id={page.id} />;
}

function GamePage({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const loaded = useFetched(
    `/api/games/${id}`,
    (j) => (j.game && typeof j.me === "string" ? { game: j.game as GameView, me: j.me } : undefined),
    attempt,
  );
  if (!loaded || "failed" in loaded) return <Status failed={Boolean(loaded)} onRetry={() => setAttempt((a) => a + 1)} />;
  return (
    <div className="flex flex-col gap-6">
      <Final view={loaded.data.game} me={loaded.data.me} compact />
    </div>
  );
}

function ProfilePage({ id }: { id: string }) {
  const [attempt, setAttempt] = useState(0);
  const loaded = useFetched(
    `/api/players/${id}`,
    (j) => {
      const p = j.profile as ProfileCard | undefined;
      // Dates arrive as text.
      return p && { ...p, bestGuesses: p.bestGuesses.map((g) => ({ ...g, answeredAt: new Date(g.answeredAt) })) };
    },
    attempt,
  );
  if (!loaded || "failed" in loaded) return <Status failed={Boolean(loaded)} onRetry={() => setAttempt((a) => a + 1)} />;
  return (
    <div className="flex flex-col gap-6">
      <ProfileSummary p={loaded.data} compact />
    </div>
  );
}

function Status({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  if (!failed) return <p className="py-10 text-center text-sm text-muted">Loading…</p>;
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted">
      <p>That didn&apos;t load.</p>
      <button type="button" onClick={onRetry} className="rounded-full bg-surface-2 px-5 py-2.5 font-semibold text-ink">
        Try again
      </button>
    </div>
  );
}
