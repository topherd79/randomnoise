import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { myGames } from "@/lib/game-view";
import { Logo } from "@/components/Logo";
import { SubmitButton } from "@/components/SubmitButton";
import { logout } from "./actions";

function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export default async function Home() {
  const user = await requireUser();
  const { active, finished } = await myGames(user.id);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center justify-between">
        <Logo />
        {user.isAdmin && (
          <Link href="/admin" className="text-sm font-medium text-muted underline-offset-4 hover:underline">
            Admin
          </Link>
        )}
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
          <p className="text-muted">Hi {user.name},</p>
          {active.map((g) => {
            return (
              <Link key={g.id} href={`/game/${g.id}`} className="block rounded-3xl bg-surface p-6 transition active:scale-[0.99]">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">
                  Song {g.position} of {g.songCount}
                </p>
                <h1 className="mt-2 text-3xl font-bold leading-tight">
                  {g.myTurn ? "Your turn." : `Waiting on ${names(g.waitingOn)}.`}
                </h1>
                {g.others.length > 0 && <p className="mt-2 text-muted">With {names(g.others)}</p>}
                <span
                  className={`mt-6 block rounded-full py-4 text-center text-lg font-semibold ${
                    g.myTurn ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink"
                  }`}
                >
                  {g.myTurn ? `Play song ${g.position}` : "See the game"}
                </span>
              </Link>
            );
          })}
        </section>
      )}

      {finished.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-muted">Past games</h2>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl bg-surface">
            {finished.slice(0, 5).map((g) => (
              <li key={g.id}>
                <Link href={`/game/${g.id}`} className="flex justify-between px-4 py-3">
                  <span>{g.songCount} songs</span>
                  <span className="text-muted">
                    {g.finishedAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
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
