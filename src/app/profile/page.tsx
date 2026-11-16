import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadProfile } from "@/lib/profiles";
import { MIN_SONGS_FOR_BEST } from "@/lib/profile-stats";
import { Avatar, BackLink, BestGuesses, GroupCard, PastGamesList, SectionTitle, percentRight, secs } from "./parts";

/** How many past games the profile lists before "See all". */
const RECENT = 3;

export default async function ProfilePage() {
  const user = await requireUser();
  const p = await loadProfile(user.id);
  if (!p) notFound();
  const right = percentRight(p);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center justify-between">
        <BackLink href="/">Home</BackLink>
        <span className="text-sm text-muted">Profile</span>
      </header>

      <section className="flex items-center gap-4">
        <Avatar name={p.name} size={64} accent />
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold leading-tight">{p.name}</h1>
          <p className="text-muted">
            Playing since {p.since.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2.5">
        <Tile value={String(p.games)} label="Games played" />
        <Tile value={String(p.wins)} label="Wins" />
        <Tile value={right ?? "—"} label={p.answered ? `Right (${p.right} of ${p.answered})` : "Right"} />
        <Tile value={p.averageMs === null ? "—" : secs(p.averageMs)} label="Average answer" />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Best guesses</SectionTitle>
        <BestGuesses guesses={p.bestGuesses} />
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Genres</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <GroupCard stat={p.genres.best} which="best" kind="genre" />
          <GroupCard stat={p.genres.worst} which="worst" kind="genre" />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionTitle>Decades</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5">
          <GroupCard stat={p.decades.best} which="best" kind="decade" />
          <GroupCard stat={p.decades.worst} which="worst" kind="decade" />
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Ranked by average points a song; a genre or decade needs at least {MIN_SONGS_FOR_BEST} songs. Counts finished
          games (and the finished songs of games ended early), so a game still being played gives nothing away.
        </p>
      </section>

      {p.past.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <SectionTitle>Past games</SectionTitle>
            {p.past.length > RECENT && (
              <Link href="/profile/games" className="text-sm font-semibold text-accent">
                See all {p.past.length}
              </Link>
            )}
          </div>
          <PastGamesList games={p.past.slice(0, RECENT)} />
        </section>
      )}
    </main>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-2xl bg-surface px-4 py-3.5">
      <span className="text-[26px] font-bold tabular-nums">{value}</span>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}
