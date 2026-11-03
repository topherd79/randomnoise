import Link from "next/link";
import { findLoginToken, getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { SubmitButton } from "@/components/SubmitButton";
import { confirmLogin } from "./actions";

/**
 * The page a magic link opens. Opening it changes nothing; only tapping
 * "Log in" uses the link up. That way email scanners and iMessage link
 * previews (which open links automatically) can't burn it.
 */
export default async function AuthPage(props: PageProps<"/auth/[token]">) {
  const { token } = await props.params;
  const [link, current] = await Promise.all([findLoginToken(token), getCurrentUser()]);

  let body: React.ReactNode;

  if (link && current?.id === link.userId) {
    // Already logged in as this player: no need to use up the link.
    body = (
      <>
        <h1 className="text-3xl font-bold">You&apos;re already logged in.</h1>
        <Link
          href="/"
          className="mt-8 block rounded-full bg-accent py-4 text-center text-lg font-semibold text-accent-ink"
        >
          Go to the game
        </Link>
      </>
    );
  } else if (link && !link.usedAt) {
    body = (
      <>
        <p className="text-muted">Hi {link.name},</p>
        <h1 className="mt-2 text-3xl font-bold">Tap to log in.</h1>
        <form action={confirmLogin.bind(null, token)} className="mt-8">
          <SubmitButton pendingText="Logging in…" className="w-full py-4 text-lg">
            Log in
          </SubmitButton>
        </form>
        <p className="mt-4 text-sm text-muted">You&apos;ll stay logged in on this phone for a year.</p>
      </>
    );
  } else {
    body = (
      <>
        <h1 className="text-3xl font-bold">
          {link ? "This link has already been used." : "This link doesn't work."}
        </h1>
        <p className="mt-4 leading-relaxed text-muted">Each login link works once. Ask for a fresh one.</p>
        <Link
          href="/login"
          className="mt-8 block rounded-full bg-accent py-4 text-center text-lg font-semibold text-accent-ink"
        >
          Get a new login link
        </Link>
      </>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <Logo />
      <section className="flex flex-1 flex-col justify-center">{body}</section>
    </main>
  );
}
