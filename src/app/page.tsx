import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { SubmitButton } from "@/components/SubmitButton";
import { logout } from "./actions";

export default async function Home() {
  const user = await requireUser();

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

      <section className="flex flex-1 flex-col justify-center py-10">
        <p className="text-muted">Hi {user.name},</p>
        <h1 className="mt-2 text-3xl font-bold leading-tight">No game is running yet.</h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          When a game starts, you&apos;ll get an email and the first song will be waiting here.
        </p>
      </section>

      <form action={logout} className="text-center">
        <SubmitButton variant="secondary" pendingText="Logging out…">
          Log out
        </SubmitButton>
      </form>
    </main>
  );
}
