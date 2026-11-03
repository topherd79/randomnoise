"use client";

import { useActionState } from "react";
import { requestLoginLink, type LoginState } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(requestLoginLink, {
    status: "idle",
  });

  if (state.status === "sent") {
    return (
      <div className="rounded-2xl bg-surface p-6">
        <h2 className="text-xl font-bold">Check your email</h2>
        <p className="mt-2 leading-relaxed text-muted">
          A login link is on its way to <span className="text-ink">{state.email}</span>. Open it on
          this phone and tap “Log in”.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label htmlFor="email" className="text-sm font-medium text-muted">
        Your email
      </label>
      <input
        id="email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        placeholder="you@example.com"
        className="w-full rounded-2xl border border-line bg-surface px-4 py-4 text-base text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none"
      />
      <SubmitButton pendingText="Sending…" className="w-full py-4 text-lg">
        Email me a login link
      </SubmitButton>

      {state.status === "unknown" && (
        <p className="text-sm leading-relaxed text-danger">
          {state.email} isn&apos;t on the player list. Ask Topher to add you.
        </p>
      )}
      {state.status === "invalid" && (
        <p className="text-sm text-danger">That doesn&apos;t look like an email address.</p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-danger">Something went wrong sending the email. Try again in a minute.</p>
      )}
    </form>
  );
}
