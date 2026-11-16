import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myGames } from "@/lib/game-view";
import { pastGames } from "@/lib/profiles";
import { Logo } from "@/components/Logo";
import { LiveRefresh } from "@/components/LiveRefresh";
import { SubmitButton } from "@/components/SubmitButton";
import { logout } from "./actions";
import { listNames, waitingOnText } from "@/lib/modes";
import { Avatar, PastGamesList, SectionTitle, gamesAndWins } from "./profile/parts";

/** How many past games the home screen lists before "See all". */
const RECENT = 3;

export default async function Home() {
  const user = await requireUser();
  const [active, past] = await Promise.all([myGames(user.id), pastGames(user.id)]);
  const finished = past.filter((g) => g.status === "finished");
  const record = { games: finished.length, wins: finished.filter((g) => g.won).length };

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
            return (
              <Link key={g.id} href={`/game/${g.id}`} className="block rounded-3xl bg-surface p-6 transition active:scale-[0.99]">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
                  {g.label}
                </p>
                <h1 className="mt-2 text-3xl font-bold leading-tight">
                  {g.myTurn ? "Your turn." : `Waiting on ${waitingOnText(g.waitingOn, g.roundLength)}.`}
                </h1>
                {g.others.length > 0 && <p className="mt-2 text-muted">With {listNames(g.others)}</p>}
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

      {past.length > 0 && (
        <section className="mb-8 flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <SectionTitle>Past games</SectionTitle>
            {past.length > RECENT && (
              <Link href="/profile/games" className="text-sm font-semibold text-accent">
                See all {past.length}
              </Link>
            )}
          </div>
          <PastGamesList games={past.slice(0, RECENT)} />
        </section>
      )}

      <form action={logout} className="text-center">
        <SubmitButton variant="secondary" pendingText="Logging out…">
          Log out
        </SubmitButton>
      </form>
    </main>
  );
}
