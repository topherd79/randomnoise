import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { profileCard } from "@/lib/profiles";
import { BackLink, ProfileSummary } from "../../profile/parts";

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
  const p = await profileCard(me, id);
  if (!p) notFound();

  const from = (await props.searchParams).from;
  const back = typeof from === "string" && UUID.test(from) ? { href: `/game/${from}`, label: "Back to the game" } : { href: "/", label: "Home" };

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <header className="flex items-center">
        <BackLink href={back.href}>{back.label}</BackLink>
      </header>
      <ProfileSummary p={p} />
    </main>
  );
}
