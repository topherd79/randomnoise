import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { openLobbyFor } from "@/lib/aux-game";
import { activeGamesIn, chatSummaries } from "@/lib/chat";
import { SideTabs } from "@/components/SideTabs";
import { myGames } from "@/lib/game-view";
import { gameRecord, pastGames } from "@/lib/profiles";
import { Logo } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { logout } from "./actions";
import { listNames, waitingOnText } from "@/lib/modes";
import { Avatar, PastGamesList, gamesAndWins } from "./profile/parts";


export default async function Home(props: PageProps<"/">) {
  const user = await requireUser();
  // A Pass the Aux lobby is open: everyone's in the room about to play, so go
  // straight there (the game's own Home link adds ?stay to really come here).
  if (!(await props.searchParams).stay) {
    const lobby = await openLobbyFor(user.id);
    if (lobby) redirect(`/game/${lobby}`);
  }
  const [active, past, chats] = await Promise.all([myGames(user.id), pastGames(user.id), chatSummaries(user.id)]);
  const chatIds = chats.map((c) => c.id);
  const chatGames = await activeGamesIn(chatIds);
  const record = gameRecord(past);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center justify-between">
        <Logo />
        <div className="flex items-center gap-3.5">
          {user.isAdmin && (
            <Link href="/admin" className="text-sm font-medium text-muted underline-offset-4 hover:underline">
              Admin
            </Link>
          )}
          <Link href="/profile" aria-label="Your profile">
            <Avatar name={user.name} />
          </Link>
        </div>
      </header>

      {active.length === 0 ? (
        <section className="flex flex-1 flex-col justify-center py-10">
          <p className="text-muted">Hi {user.name},</p>
          <h1 className="mt-2 text-3xl font-bold leading-tight">No game is running right now.</h1>
          <p className="mt-4 text-lg leading-relaxed text-muted">
            When a game starts, you&apos;ll get an email and the first song will be waiting here.
          </p>
        </section>
      ) : (
        <section className="flex flex-1 flex-col justify-center gap-4 py-10">
          <LiveRefresh gameIds={active.map((g) => g.id)} />
          <p className="text-muted">Hi {user.name},</p>
          {active.map((g) => {
            if (g.aux) {
              const a = g.aux;
              return (
                <Link key={g.id} href={`/game/${g.id}`} className="block rounded-3xl bg-surface p-6 transition active:scale-[0.99]">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
                    Pass the Aux · {a.lobby ? `${a.players} players` : g.label}
                  </p>
                  <h1 className="mt-2 text-3xl font-bold leading-tight">
                    {a.lobby ? "The lobby's open." : a.myTurn ? "It's your turn." : `${a.turnName}'s turn.`}
                  </h1>
                  <p className="mt-2 text-muted">
                    {a.lobby
                      ? `You're player ${a.myNumber}. ${a.joined} of ${a.players} in.`
                      : `You're player ${a.myNumber}. With ${listNames(g.others)}.`}
                  </p>
                  <span className="mt-6 block rounded-full bg-accent py-4 text-center text-lg font-semibold text-accent-ink">
                    {a.lobby ? "Join the lobby" : "Back to the game"}
                  </span>
                </Link>
              );
            }
            return (
              <Link key={g.id} href={`/game/${g.id}`} className="block rounded-3xl bg-surface p-6 transition active:scale-[0.99]">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
                  {g.label}
                </p>
                <h1 className="mt-2 text-3xl font-bold leading-tight">
                  {g.myTurn ? "Your turn." : `Waiting on ${waitingOnText(g.waitingOn, g.roundLength)}.`}
                </h1>
                {g.waitingOnYou ? (
                  <p className="mt-2 font-semibold text-accent">{g.waitingOnYou}</p>
                ) : g.playOn ? (
                  // A vote to play on without the one player holding the game up.
                  <p className={`mt-2 ${g.playOn.mine ? "text-muted" : "font-semibold text-accent"}`}>{g.playOn.text}</p>
                ) : (
                  g.others.length > 0 && <p className="mt-2 text-muted">With {listNames(g.others)}</p>
                )}
                <span
                  className={`mt-6 block rounded-full py-4 text-center text-lg font-semibold ${
                    g.myTurn ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"
                  }`}
                >
                  {g.myTurn ? `Play song ${g.nextPosition}` : "See the game"}
                </span>
              </Link>
            );
          })}
        </section>
      )}

      <Link href="/profile" className="mb-8 flex items-center gap-3.5 rounded-2xl bg-surface p-4 active:bg-surface-2">
        <Avatar name={user.name} accent />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[17px] font-bold">Your profile</span>
          <span className="text-sm text-muted">{gamesAndWins(record)} · best guesses and stats</span>
        </span>
        <svg viewBox="0 0 16 16" className="size-4 shrink-0 text-muted" aria-hidden="true">
          <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>

      {/* The side tabs: your chats, and all your past games (they used to be listed here). */}
      {(chats.length > 0 || past.length > 0) && (
        <SideTabs
          chat={chats.length > 0 ? { chatIds, gameIds: chatGames, unread: chats.reduce((n, c) => n + c.unread, 0) } : undefined}
          podium={
            past.length > 0
              ? { label: "Past games", title: "Past games", subtitle: gamesAndWins(record), content: <PastGamesList games={past} /> }
              : undefined
          }
        />
      )}

      <form action={logout} className="text-center">
        <SubmitButton variant="secondary" pendingText="Logging out…">
          Log out
        </SubmitButton>
      </form>
    </main>
  );
}
