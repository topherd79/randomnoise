import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { gameProgress } from "@/lib/admin-games";
import { formatPoints } from "@/lib/rules";
import { GameControls, ResetButton } from "./GameControls";

function since(d: Date) {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

export default async function AdminGamePage(props: PageProps<"/admin/games/[id]">) {
  await requireAdmin();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const progress = await gameProgress(id);
  if (!progress) notFound();
  const { game, players, standings, currentGameSongId } = progress;
  const active = game.status === "active";

  return (
    <div className="flex flex-col gap-8">
      <Link href="/admin/games" className="text-sm text-muted hover:text-ink">
        ← Games
      </Link>

      <header>
        <h1 className="text-2xl font-bold">
          {active ? `Song ${game.currentPosition} of ${game.songCount}` : game.status === "finished" ? "Finished" : "Ended early"}
        </h1>
        <p className="mt-1 text-muted">
          Started {game.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ·{" "}
          {game.songCount} songs · {game.clipLengthSec}-second clips ·{" "}
          {game.wrongAnswers === "similar" ? "similar wrong answers" : "random wrong answers"}
        </p>
      </header>

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        {active ? (
          <section>
            <h2 className="text-lg font-bold">This song</h2>
            <p className="mt-1 text-sm text-muted">
              If someone&apos;s attempt went wrong by accident (a phone call, a crash), reset it and they can play the
              song again from the start.
            </p>
            <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {players.map((p) => (
                <li key={p.userId} className="flex flex-wrap items-center gap-4 px-4 py-3">
                  <span className="w-32 font-semibold">{p.name}</span>
                  <span className="flex-1 text-sm text-muted">
                    {p.state === "answered"
                      ? "Answered"
                      : p.state === "playing"
                        ? `Tapped Play ${p.startedAt ? since(p.startedAt) : ""}, hasn't answered`
                        : "Hasn't started"}
                  </span>
                  {p.state !== "waiting" && currentGameSongId && (
                    <ResetButton gameId={game.id} gameSongId={currentGameSongId} userId={p.userId} name={p.name} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section>
            <p className="text-muted">
              This game is over. Players can see every song and everyone&apos;s picks on their game page.
            </p>
          </section>
        )}

        <aside className="flex flex-col gap-6">
          <div>
            <h2 className="text-lg font-bold">Standings</h2>
            <ol className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line">
              {standings.map((s, i) => (
                <li key={s.userId} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-5 text-muted">{i + 1}</span>
                  <span className="flex-1 font-semibold">{s.name}</span>
                  <span className="text-muted">{s.correct} right</span>
                  <span className="w-14 text-right font-bold tabular-nums">{formatPoints(s.points)}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted">Counts finished songs only.</p>
          </div>
          {active && <GameControls gameId={game.id} />}
        </aside>
      </div>
    </div>
  );
}
