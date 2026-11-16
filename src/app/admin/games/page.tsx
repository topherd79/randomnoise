import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { activeSongMeta } from "@/lib/catalog-queries";
import { countGames, gameSummaries } from "@/lib/admin-games";
import { formatPoints } from "@/lib/rules";
import { CreateGameForm } from "./CreateGameForm";
import { ResultsGrid } from "./ResultsGrid";
import { loadGameResults } from "@/lib/game-view";
import { LiveRefresh } from "@/components/LiveRefresh";
import { listNames, MODES, waitingOnText } from "@/lib/modes";

/** The Games page shows this many; the rest are on All games. */
const RECENT = 5;

export default async function GamesPage() {
  const me = await requireAdmin();
  const [players, songMeta, summaries, counts] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
    activeSongMeta(),
    gameSummaries({ limit: RECENT }),
    countGames(),
  ]);
  // Song-by-song results for games that are over (never for one in progress: the admin plays too).
  const results = await loadGameResults(summaries.filter((g) => g.status !== "active").map((g) => g.id));

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="text-2xl font-bold">Games</h1>
        <p className="mt-1 text-muted">
          Progress only: this page never shows the songs of a game in progress, so you can play too.
        </p>
        <LiveRefresh gameIds={summaries.filter((g) => g.status === "active").map((g) => g.id)} />
        {summaries.length > 0 && (
          <h2 className="mt-8 text-sm font-semibold uppercase tracking-[0.18em] text-muted">Recent games</h2>
        )}
        {summaries.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-muted">
            No games yet. Start one on the right.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {summaries.map((g) => {
              const row = (
                <>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                      g.status === "active" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {g.status === "active" ? "Playing" : g.status === "finished" ? "Finished" : "Ended"}
                  </span>
                  <span className="font-semibold">
                    {g.status === "active"
                      ? `${g.label} · waiting on ${waitingOnText(g.waitingOn, g.roundLength)}`
                      : g.leader
                        ? `${g.leader.name} ${g.status === "finished" ? "won" : "led"} with ${formatPoints(g.leader.points)}`
                        : `${g.songCount} songs`}
                  </span>
                  <span className="text-sm text-muted">
                    {listNames(g.players)}
                    {g.mode !== "og" && ` · ${MODES[g.mode].name} mode`}
                  </span>
                  <span className="ml-auto text-sm text-muted">
                    {g.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </>
              );
              const done = results.get(g.id);
              // Games in progress link to their progress page; games that are over open up in place.
              return (
                <li key={g.id}>
                  {g.status === "active" || !done ? (
                    <Link href={`/admin/games/${g.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-4 hover:bg-surface/50">
                      {row}
                    </Link>
                  ) : (
                    <details className="group">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-1 px-4 py-4 hover:bg-surface/50 [&::-webkit-details-marker]:hidden">
                        <svg viewBox="0 0 12 12" className="size-3 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden="true">
                          <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        {row}
                      </summary>
                      <div className="flex flex-col gap-3 px-4 pb-5">
                        <ResultsGrid results={done} />
                        <Link href={`/admin/games/${g.id}`} className="self-start text-sm text-muted hover:text-ink">
                          Open this game&apos;s page →
                        </Link>
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {counts.all > 0 && (
          <Link
            href="/admin/games/all"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-5 py-2.5 text-sm font-semibold text-ink hover:bg-line"
          >
            See all {counts.all} {counts.all === 1 ? "game" : "games"}
            <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
              <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
      </section>

      <aside>
        <h2 className="mb-4 text-lg font-bold">Start a game</h2>
        <CreateGameForm
          players={players.map((p) => ({ id: p.id, name: p.name, isMe: p.id === me.id }))}
          songs={songMeta}
        />
      </aside>
    </div>
  );
}
