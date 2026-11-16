import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { loadProfile, maySeeProfile } from "@/lib/profiles";
import { Avatar, BackLink, BestGuesses, GroupCard, SectionTitle, gamesAndWins, percentRight, secs } from "../../profile/parts";

const UUID = /^[0-9a-f-]{36}$/;

/**
 * A friend's profile: the short version (no list of past games). Anyone you've
 * played a game with can see it; only games that are over count.
 */
export default async function PlayerPage(props: PageProps<"/players/[id]">) {
  const me = await requireUser();
  const { id } = await props.params;
  if (!UUID.test(id)) notFound();
  if (id === me.id) redirect("/profile");
  if (!(await maySeeProfile(me, id))) notFound();
  const p = await loadProfile(id);
  if (!p) notFound();

  const from = (await props.searchParams).from;
  const back = typeof from === "string" && UUID.test(from) ? { href: `/game/${from}`, label: "Back to the game" } : { href: "/", label: "Home" };
  const right = percentRight(p);
  const line = [
    gamesAndWins(p),
    right && `${right} right`,
    p.averageMs !== null && `${secs(p.averageMs)} average`,
  ].filter(Boolean);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center">
        <BackLink href={back.href}>{back.label}</BackLink>
      </header>

      <section className="flex items-center gap-3.5">
        <Avatar name={p.name} size={52} />
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-bold leading-tight">{p.name}</h1>
          <p className="text-sm text-muted">{line.join(" · ")}</p>
        </div>
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>Best guesses</SectionTitle>
        <BestGuesses guesses={p.bestGuesses} compact />
      </section>

      <section className="flex flex-col gap-2.5">
        <SectionTitle>Best and worst</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <GroupCard stat={p.genres.best} which="best" kind="genre" label="Best genre" compact />
          <GroupCard stat={p.genres.worst} which="worst" kind="genre" label="Worst genre" compact />
          <GroupCard stat={p.decades.best} which="best" kind="decade" label="Best decade" compact />
          <GroupCard stat={p.decades.worst} which="worst" kind="decade" label="Worst decade" compact />
        </div>
      </section>

      <p className="text-xs leading-relaxed text-muted">Only games that are over count.</p>
    </main>
  );
}
