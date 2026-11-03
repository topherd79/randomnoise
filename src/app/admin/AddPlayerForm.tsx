"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPlayer, type FormResult } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";

export const inputClass =
  "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink placeholder:text-muted/60 focus:border-accent focus:outline-none";

export function AddPlayerForm() {
  const [result, formAction] = useActionState<FormResult, FormData>(addPlayer, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (result?.ok) formRef.current?.reset();
  }, [result]);

  return (
    <form ref={formRef} action={formAction} className="mt-4 flex flex-col gap-3">
      <input name="name" required placeholder="Name" maxLength={40} className={inputClass} />
      <input
        name="email"
        type="email"
        required
        placeholder="Email"
        autoCapitalize="none"
        className={inputClass}
      />
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" name="sendInvite" defaultChecked className="size-4 accent-[#d6ff3f]" />
        Email them an invite with a login link
      </label>
      <SubmitButton pendingText="Adding…">Add player</SubmitButton>
      {result && (
        <p className={`text-sm ${result.ok ? "text-accent" : "text-danger"}`} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}
