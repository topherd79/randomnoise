import Link from "next/link";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { users, type GameStatus } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { countGames, gameSummaries, type GameFilter } from "@/lib/admin-games";
import { formatPoints } from "@/lib/rules";
import { GAME_MODES, isGameMode, MODES, waitingOnText } from "@/lib/modes";
import { LiveRefresh } from "@/components/LiveRefresh";

const PAGE_SIZE = 25;
const STATUSES: { value: GameStatus; label: string }[] = [
  { value: "active", label: "Playing" },
  { value: "finished", label: "Finished" },
  { value: "cancelled", label: "Ended early" },
];
const UUID = /^[0-9a-f-]{36}$/;

type Params = { status?: GameStatus; mode?: GameFilter["mode"]; player?: string; page?: number };

/** A link to this page with some filters changed (any filter change goes back to page 1). */
function hrefWith(current: Params, change: Partial<Params>): string {
  const next: Params = { ...current, page: undefined, ...change };
  const q = new URLSearchParams();
  if (next.status) q.set("status", next.status);
  if (next.mode) q.set("mode", next.mode);
  if (next.player) q.set("player", next.player);
  if (next.page && next.page > 1) q.set("page", String(next.page));
  const s = q.toString();
  return s ? `/admin/games/all?${s}` : "/admin/games/all";
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "true" : undefined}
      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
        on ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink hover:bg-line"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function AllGamesPage(props: PageProps<"/admin/games/all">) {
  await requireAdmin();
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const statusParam = one(sp.status);
  const modeParam = one(sp.mode);
  const playerParam = one(sp.player);
  const params: Params = {
    status: STATUSES.some((s) => s.value === statusParam) ? (statusParam as GameStatus) : undefined,
    mode: isGameMode(modeParam) ? modeParam : undefined,
    player: playerParam && UUID.test(playerParam) ? playerParam : undefined,
  };

  const [players, counts] = await Promise.all([
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
    countGames({ mode: params.mode, playerId: params.player }),
  ]);
  const total = params.status ? counts[params.status] : counts.all;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1), pages);
  params.page = page;
  const rows = await gameSummaries({
    status: params.status,
    mode: params.mode,
    playerId: params.player,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const first = (page - 1) * PAGE_SIZE + 1;
  const filtered = Boolean(params.status || params.mode || params.player);

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh gameIds={rows.filter((g) => g.status === "active").map((g) => g.id)} />
      <Link href="/admin/games" className="text-sm text-muted hover:text-ink">
        ← Games
      </Link>
      <header>
        <h1 className="text-2xl font-bold">All games</h1>
        <p className="mt-1 text-muted">
          Newest first. A game that&apos;s over opens to every song and pick; a game in progress shows progress only.
        </p>
      </header>

      <div className="flex flex-col gap-3 rounded-2xl border border-line p-4">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Status">
          <span className="w-16 text-xs font-semibold uppercase tracking-wider text-muted">Status</span>
          <Chip href={hrefWith(params, { status: undefined })} on={!params.status}>
            All {counts.all}
          </Chip>
          {STATUSES.map((s) => (
            <Chip key={s.value} href={hrefWith(params, { status: s.value })} on={params.status === s.value}>
              {s.label} {counts[s.value]}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Mode">
          <span className="w-16 text-xs font-semibold uppercase tracking-wider text-muted">Mode</span>
          <Chip href={hrefWith(params, { mode: undefined })} on={!params.mode}>
            Any
          </Chip>
          {GAME_MODES.map((m) => (
            <Chip key={m} href={hrefWith(params, { mode: m })} on={params.mode === m}>
              {MODES[m].name}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Player">
          <span className="w-16 text-xs font-semibold uppercase tracking-wider text-muted">Player</span>
          <Chip href={hrefWith(params, { player: undefined })} on={!params.player}>
            Anyone
          </Chip>
          {players.map((p) => (
            <Chip key={p.id} href={hrefWith(params, { player: p.id })} on={params.player === p.id}>
              {p.name}
            </Chip>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">
          {filtered ? "No games match these filters." : "No games yet."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line">
          <div className="grid grid-cols-[5rem_7.5rem_6.5rem_4rem_minmax(0,1fr)_minmax(0,1.3fr)] gap-4 bg-surface px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted">
            <span>Date</span>
            <span>Status</span>
            <span>Mode</span>
            <span>Songs</span>
            <span>Players</span>
            <span>Result</span>
          </div>
          <ul className="divide-y divide-line border-t border-line">
            {rows.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/admin/games/${g.id}`}
                  className="grid grid-cols-[5rem_7.5rem_6.5rem_4rem_minmax(0,1fr)_minmax(0,1.3fr)] items-center gap-4 px-4 py-3 text-sm hover:bg-surface/50"
                >
                  <span className="text-muted">
                    {g.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${
                        g.status === "active" ? "bg-accent/15 text-accent" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {g.status === "active" ? "Playing" : g.status === "finished" ? "Finished" : "Ended"}
                    </span>
                  </span>
                  <span>{MODES[g.mode].name}</span>
                  <span className="tabular-nums">{g.songCount}</span>
                  <span className="truncate text-muted" title={g.players.join(", ")}>
                    {g.players.join(", ")}
                  </span>
                  <span className="truncate font-semibold">
                    {g.status === "active"
                      ? `Waiting on ${waitingOnText(g.waitingOn, g.roundLength)}`
                      : g.leader
                        ? `${g.leader.name} ${g.status === "finished" ? "won" : "led"} with ${formatPoints(g.leader.points)}`
                        : "No players left"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Showing {first}–{first + rows.length - 1} of {total}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={hrefWith(params, { page: page - 1 })} className="rounded-full bg-surface-2 px-4 py-2 font-semibold text-ink hover:bg-line">
                Newer
              </Link>
            ) : (
              <span className="rounded-full px-4 py-2 font-semibold opacity-40">Newer</span>
            )}
            {page < pages ? (
              <Link href={hrefWith(params, { page: page + 1 })} className="rounded-full bg-surface-2 px-4 py-2 font-semibold text-ink hover:bg-line">
                Older
              </Link>
            ) : (
              <span className="rounded-full px-4 py-2 font-semibold opacity-40">Older</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
