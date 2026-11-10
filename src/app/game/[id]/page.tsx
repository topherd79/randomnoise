import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadGameView, type GameView } from "@/lib/game-view";
import { formatPoints, formatSeconds } from "@/lib/rules";
import { Logo } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PlayRound } from "./PlayRound";
import { PicksList, ResultsCard, SongCard } from "./parts";
import { Standings } from "./Standings";
import { Waiting } from "./Waiting";

function serverTime() {
  return Date.now();
}

export default async function GamePage(props: PageProps<"/game/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const view = await loadGameView(id, user.id);
  if (!view) notFound();

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center justify-between">
        <Link href="/" aria-label="Home">
          <Logo />
        </Link>
        <span className="text-sm text-muted">
          {view.status === "active" ? view.label : view.status === "finished" ? "Final results" : "Game ended"}
        </span>
      </header>
      {view.status === "active" ? <ActiveGame view={view} userId={user.id} /> : <OverGame view={view} />}
    </main>
  );
}

function ActiveGame({ view, userId }: { view: GameView; userId: string }) {
  const next = view.next;

  // In the middle of a song (tapped Play, not answered): just the play screen.
  if (next?.my.startedAt) {
    return (
      <div className="flex flex-1 flex-col pt-6">
        <PlayRound
          key={next.gameSongId}
          gameSongId={next.gameSongId}
          position={next.position}
          total={view.songCount}
          clipUrl={next.clipUrl}
          choices={next.choices}
          startedAt={next.my.startedAt}
          serverNow={serverTime()}
        />
      </div>
    );
  }

  const latest = view.latest;
  // The song I just answered gets the big "how you did"; a song from a round
  // that's already over is just its results.
  const justPlayed = latest && latest.position >= view.roundStart;
  return (
    <div className="flex flex-1 flex-col gap-8 pt-6">
      {/* Waiting on others: updates by itself as they answer and when the next songs open. */}
      {!next && <LiveRefresh gameIds={[view.id]} />}

      {latest && justPlayed ? (
        <section className="flex flex-col gap-4">
          <div>
            <p className={`text-3xl font-bold ${latest.my.correct ? "text-accent" : "text-danger"}`}>
              {latest.my.correct ? "You got it." : "Not this time."}
            </p>
            <p className="mt-2 text-lg text-muted">
              <span className="font-semibold text-ink">
                {latest.my.points > 0 ? `+${formatPoints(latest.my.points)}` : formatPoints(latest.my.points)} points
              </span>
              {` · song ${latest.position} · ${formatSeconds(latest.my.elapsedMs)}`}
            </p>
            {!latest.my.correct && latest.my.pickLabel && <p className="mt-1 text-sm text-muted">You picked {latest.my.pickLabel}.</p>}
          </div>
          <SongCard song={latest.song} />
          {latest.picks.length > 1 && <PicksList picks={latest.picks} />}
        </section>
      ) : (
        latest && <ResultsCard results={latest} />
      )}

      {next ? (
        <div className="flex flex-1 flex-col">
          {latest && <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Up next</h2>}
          <PlayRound
            key={next.gameSongId}
            gameSongId={next.gameSongId}
            position={next.position}
            total={view.songCount}
            clipUrl={next.clipUrl}
            choices={next.choices}
            startedAt={null}
            serverNow={serverTime()}
            showRules={!latest}
          />
        </div>
      ) : (
        <Waiting gameId={view.id} me={userId} waitingOn={view.waitingOn} roundLength={view.roundLength} note={view.waitingNote} />
      )}

      {/* Tap a name for that player's song-by-song history (songs I've answered only). */}
      {view.standings.some((s) => s.played > 0) && (
        <Standings
          standings={view.standings}
          songs={view.songs}
          title="Standings so far"
          played={{ songCount: view.songCount }}
        />
      )}
    </div>
  );
}

function OverGame({ view }: { view: GameView }) {
  const top = view.standings[0];
  const winners = view.standings.filter((s) => s.points === top?.points);
  return (
    <div className="flex flex-col gap-8 pt-6">
      <section>
        <h1 className="text-3xl font-bold leading-tight">
          {view.status === "cancelled"
            ? "This game was ended early."
            : winners.length > 1
              ? `${winners.map((w) => w.name).join(" and ")} tie!`
              : `${top?.name} wins!`}
        </h1>
        {view.status === "finished" && top && (
          <p className="mt-2 text-lg text-muted">
            {formatPoints(top.points)} points over {view.songCount} songs.
          </p>
        )}
      </section>
      <Standings standings={view.standings} songs={view.songs} title="Final standings" />
      {view.history.map((r) => (
        <ResultsCard key={r.position} results={r} title={`Song ${r.position}`} />
      ))}
      <Link href="/" className="rounded-full bg-surface-2 py-3 text-center font-semibold text-ink">
        Home
      </Link>
    </div>
  );
}
