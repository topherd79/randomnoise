import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadGameView, type GameView } from "@/lib/game-view";
import { isAuxGame, loadAuxState } from "@/lib/aux-game";
import { unreadIn } from "@/lib/chat";
import { SideTabs } from "@/components/SideTabs";
import { formatPoints, formatSeconds } from "@/lib/rules";
import { waitingOnYouText } from "@/lib/modes";
import { outNotice, wentOnText } from "@/lib/play-on";
import { Logo } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PlayRound } from "./PlayRound";
import { PicksList, ResultsCard, SongCard } from "./parts";
import { Final } from "./Final";
import { Standings } from "./Standings";
import { Waiting } from "./Waiting";
import { AuxGame } from "./AuxGame";

function serverTime() {
  return Date.now();
}

export default async function GamePage(props: PageProps<"/game/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const view = await loadGameView(id, user.id);
  if (!view) {
    // Pass the Aux drops players who weren't in the lobby when it started.
    if (await isAuxGame(id)) return <LeftOut />;
    notFound();
  }

  // Pass the Aux in progress: one screen for the whole game, kept up to date by itself.
  if (view.mode === "aux" && view.status === "active") {
    const state = await loadAuxState(id, user.id);
    if (state?.status === "active") {
      return (
        <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
          <AuxGame initial={state} />
        </main>
      );
    }
    // It just ended: show the results.
    if (state) return GamePage(props);
  }

  // The game went on without me: no more songs, just what happened (and the group's chat).
  if (view.status === "active" && view.iAmOut) {
    const mine = view.out.find((o) => o.userId === user.id);
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
        <header>
          <Link href="/" aria-label="Home">
            <Logo />
          </Link>
        </header>
        <section className="flex flex-1 flex-col justify-center py-10">
          <h1 className="text-3xl font-bold leading-tight">This game went on without you.</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            {wentOnText(mine?.by ?? "vote", view.standings.filter((s) => !s.out).map((s) => s.name))} You stay in its results,
            crossed out, with the points you had. Once it&apos;s over, it&apos;s in your past games.
          </p>
          <Link href="/" className="mt-8 rounded-full bg-surface-2 py-3 text-center font-semibold text-ink">
            Home
          </Link>
        </section>
        {view.chatId && (
          <SideTabs chat={{ chatId: view.chatId, chatIds: [view.chatId], gameIds: [view.id], unread: await unreadIn(user.id, view.chatId) }} />
        )}
      </main>
    );
  }

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
      {view.status === "active" ? <ActiveGame view={view} userId={user.id} /> : <OverGame view={view} userId={user.id} />}
      {/*
        The side tabs: the group's chat, and the standings while the game is on (a finished
        game shows its final standings on the page). Not in the middle of a song (that
        screen is PlayRound alone).
      */}
      {(view.chatId || view.status === "active") && !(view.status === "active" && view.next?.my.startedAt) && (
        <SideTabs
          chat={
            view.chatId
              ? {
                  chatId: view.chatId,
                  chatIds: [view.chatId],
                  gameIds: view.status === "active" ? [view.id] : [],
                  unread: await unreadIn(user.id, view.chatId),
                }
              : undefined
          }
          podium={
            view.status === "active"
              ? {
                  label: "Standings",
                  title: "Standings so far",
                  subtitle: view.label,
                  content: (
                    <Standings
                      gameId={view.id}
                      me={user.id}
                      standings={view.standings}
                      songs={view.songs}
                      played={{ songCount: view.songCount }}
                      bare
                    />
                  ),
                }
              : undefined
          }
        />
      )}
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
  // Everyone else has played every open song: say so to the one they're waiting on.
  const leftOf = (uid: string) => view.waitingOn.find((w) => w.userId === uid)?.left ?? 0;
  const waitingOnYou = waitingOnYouText(
    view.players
      .filter((p) => p.userId !== userId && !view.out.some((o) => o.userId === p.userId))
      .map((p) => ({ name: p.name, left: leftOf(p.userId) })),
    leftOf(userId),
  );
  // The song I just answered gets the big "how you did"; a song from a round
  // that's already over is just its results.
  const justPlayed = latest && latest.position >= view.roundStart;
  const notice = outNotice(view.out, view.standings.filter((s) => !s.out).length);
  return (
    <div className="flex flex-1 flex-col gap-8 pt-6">
      {/* Waiting on others: updates by itself as they answer and when the next songs open. */}
      {!next && <LiveRefresh gameIds={[view.id]} />}
      {notice && <p className="-mb-4 rounded-2xl bg-surface px-4 py-3 text-[15px] text-muted">{notice}</p>}

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
          {waitingOnYou && (
            <p className="mb-4 rounded-2xl border border-accent/30 bg-accent/10 px-4 py-3 font-semibold text-ink" role="status">
              {waitingOnYou}
            </p>
          )}
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
        <Waiting
          gameId={view.id}
          me={userId}
          waitingOn={view.waitingOn}
          roundLength={view.roundLength}
          note={view.waitingNote}
          playOn={view.playOn}
          afterOut={view.afterOut}
        />
      )}

    </div>
  );
}

function LeftOut() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header>
        <Link href="/?stay=1" aria-label="Home">
          <Logo />
        </Link>
      </header>
      <section className="flex flex-1 flex-col justify-center py-10">
        <h1 className="text-3xl font-bold leading-tight">This game started without you.</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          It&apos;s a Pass the Aux game, played in one room, and it began while you weren&apos;t in the lobby. You&apos;ll get an email when
          the next game starts.
        </p>
        <Link href="/?stay=1" className="mt-8 rounded-full bg-surface-2 py-3 text-center font-semibold text-ink">
          Home
        </Link>
      </section>
    </main>
  );
}

function OverGame({ view, userId }: { view: GameView; userId: string }) {
  return (
    <div className="flex flex-col gap-8 pt-6">
      <Final view={view} me={userId} />
      <Link href="/" className="rounded-full bg-surface-2 py-3 text-center font-semibold text-ink">
        Home
      </Link>
    </div>
  );
}
