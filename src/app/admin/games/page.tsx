import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { catalogCounts } from "@/lib/catalog-queries";
import { gameSummaries } from "@/lib/admin-games";
import { formatPoints } from "@/lib/rules";
import { CreateGameForm } from "./CreateGameForm";
import { LiveRefresh } from "@/components/LiveRefresh";

function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export default async function GamesPage() {
  const me = await requireAdmin();
  const [players, counts, summaries] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
    catalogCounts(),
    gameSummaries(),
  ]);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
      <section>
        <h1 className="text-2xl font-bold">Games</h1>
        <p className="mt-1 text-muted">
          Progress only: this page never shows the songs of a game in progress, so you can play too.
        </p>
        <LiveRefresh gameIds={summaries.filter((g) => g.status === "active").map((g) => g.id)} />
        {summaries.length === 0 ? (
          <p className="mt-6 rounded-2xl border border-dashed border-line p-10 text-center text-muted">
            No games yet. Start one on the right.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line">
            {summaries.map((g) => (
              <li key={g.id}>
                <Link href={`/admin/games/${g.id}`} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-4 hover:bg-surface/50">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                      g.status === "active" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                    }`}
                  >
                    {g.status === "active" ? "Playing" : g.status === "finished" ? "Finished" : "Ended"}
                  </span>
                  <span className="font-semibold">
                    {g.status === "active"
                      ? `Song ${g.position} of ${g.songCount} · waiting on ${names(g.waitingOn)}`
                      : g.leader
                        ? `${g.leader.name} ${g.status === "finished" ? "won" : "led"} with ${formatPoints(g.leader.points)}`
                        : `${g.songCount} songs`}
                  </span>
                  <span className="text-sm text-muted">{names(g.players)}</span>
                  <span className="ml-auto text-sm text-muted">
                    {g.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside>
        <h2 className="mb-4 text-lg font-bold">Start a game</h2>
        <CreateGameForm
          players={players.map((p) => ({ id: p.id, name: p.name, isMe: p.id === me.id }))}
          unplayed={counts.unplayed}
          catalogSize={counts.active}
        />
      </aside>
    </div>
  );
}
