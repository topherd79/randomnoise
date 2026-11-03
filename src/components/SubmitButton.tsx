"use client";

import { useFormStatus } from "react-dom";

type Props = {
  children: React.ReactNode;
  pendingText?: string;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
};

/** A form submit button that disables itself while the form is sending. */
export function SubmitButton({ children, pendingText, variant = "primary", className = "" }: Props) {
  const { pending } = useFormStatus();
  const styles = {
    primary: "bg-accent text-accent-ink hover:brightness-95",
    secondary: "bg-surface-2 text-ink hover:bg-line",
    danger: "bg-transparent text-danger hover:bg-danger/10",
  }[variant];
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-full px-5 py-3 font-semibold transition disabled:opacity-60 ${styles} ${className}`}
    >
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
