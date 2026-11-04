import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadGameView, type GameView } from "@/lib/game-view";
import { formatPoints, formatSeconds } from "@/lib/rules";
import { Logo } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PlayRound } from "./PlayRound";
import { ResultsCard, SongCard, StandingsCard } from "./parts";
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
          {view.status === "active" ? `Song ${view.position} of ${view.songCount}` : view.status === "finished" ? "Final results" : "Game ended"}
        </span>
      </header>
      {view.status === "active" ? <ActiveGame view={view} userId={user.id} /> : <OverGame view={view} />}
    </main>
  );
}

function ActiveGame({ view, userId }: { view: GameView; userId: string }) {
  const round = view.current;
  if (!round) return <p className="py-10 text-muted">This game has no song to play right now.</p>;

  // Not yet answered: the play screen (results of the last song first, if you haven't started this one).
  if (!round.my.answeredAt) {
    const showLast = view.last && !round.my.startedAt;
    return (
      <div className="flex flex-1 flex-col gap-8 pt-6">
        {showLast && view.last && (
          <>
            <ResultsCard results={view.last} />
            <StandingsCard standings={view.standings} />
            <h2 className="-mb-6 text-sm font-semibold uppercase tracking-[0.18em] text-muted">Up next</h2>
          </>
        )}
        <PlayRound
          key={round.gameSongId}
          gameSongId={round.gameSongId}
          position={round.position}
          total={view.songCount}
          clipUrl={round.clipUrl}
          choices={round.choices}
          startedAt={round.my.startedAt}
          serverNow={serverTime()}
        />
      </div>
    );
  }

  // Answered: how you did, the song, and who's left.
  const right = round.my.correct;
  const yourPick = round.choices.find((c) => c.songId === round.my.choiceSongId)?.label;
  return (
    <div className="flex flex-col gap-6 pt-6">
      {/* Updates by itself as others answer; the results appear the moment the last one does. */}
      <LiveRefresh gameIds={[view.id]} />
      <section>
        <p className={`text-3xl font-bold ${right ? "text-accent" : "text-danger"}`}>
          {right ? "You got it." : "Not this time."}
        </p>
        <p className="mt-2 text-lg text-muted">
          {round.my.points !== null && (
            <span className="font-semibold text-ink">
              {round.my.points > 0 ? `+${formatPoints(round.my.points)}` : formatPoints(round.my.points)} points
            </span>
          )}
          {round.my.elapsedMs !== null && ` · answered in ${formatSeconds(round.my.elapsedMs)}`}
        </p>
        {!right && yourPick && <p className="mt-1 text-sm text-muted">You picked {yourPick}.</p>}
      </section>
      {round.song && <SongCard song={round.song} />}
      <Waiting gameSongId={round.gameSongId} me={userId} waitingOn={round.waitingOn} />
      {view.last && (
        <details className="group">
          <summary className="cursor-pointer list-none text-sm font-semibold text-muted">
            <span className="group-open:hidden">Show song {view.last.position} results and standings</span>
            <span className="hidden group-open:inline">Hide earlier results</span>
          </summary>
          <div className="mt-4 flex flex-col gap-8">
            <ResultsCard results={view.last} />
            <StandingsCard standings={view.standings} />
          </div>
        </details>
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
      <StandingsCard standings={view.standings} title="Final standings" />
      {view.history.map((r) => (
        <ResultsCard key={r.position} results={r} title={`Song ${r.position}`} />
      ))}
      <Link href="/" className="rounded-full bg-surface-2 py-3 text-center font-semibold text-ink">
        Home
      </Link>
    </div>
  );
}
