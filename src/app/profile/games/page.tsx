import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { pastGames, type PastGame } from "@/lib/profiles";
import { BackLink, PastGamesList, SectionTitle } from "../parts";

const STEP = 20;

export default async function PastGamesPage(props: PageProps<"/profile/games">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const asked = Number.parseInt(String(sp.show ?? ""), 10);
  const show = Number.isFinite(asked) && asked > STEP ? asked : STEP;
  const all = await pastGames(user.id);
  const finished = all.filter((g) => g.status === "finished");
  const wins = finished.filter((g) => g.won).length;
  const shown = all.slice(0, show);
  const older = all.length - shown.length;

  // Grouped by month, newest first.
  const months: { title: string; games: PastGame[] }[] = [];
  for (const g of shown) {
    const title = g.date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const last = months[months.length - 1];
    if (last?.title === title) last.games.push(g);
    else months.push({ title, games: [g] });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center">
        <BackLink href="/profile">Profile</BackLink>
      </header>

      <section>
        <h1 className="text-3xl font-bold">Past games</h1>
        <p className="mt-1.5 text-muted">
          {all.length === 0
            ? "Games you've played show up here once they're over."
            : `${finished.length} ${finished.length === 1 ? "game" : "games"} · ${wins} ${wins === 1 ? "win" : "wins"} · tap one for its song-by-song results`}
        </p>
      </section>

      {months.map((m) => (
        <section key={m.title} className="flex flex-col gap-3">
          <SectionTitle>{m.title}</SectionTitle>
          <PastGamesList games={m.games} />
        </section>
      ))}

      {older > 0 && (
        <Link
          href={`/profile/games?show=${show + STEP}`}
          scroll={false}
          className="self-center rounded-full bg-surface-2 px-7 py-3.5 font-semibold"
        >
          Show {Math.min(older, STEP)} older {Math.min(older, STEP) === 1 ? "game" : "games"}
        </Link>
      )}
    </main>
  );
}
