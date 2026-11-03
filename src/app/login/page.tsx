import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(env(safe-area-inset-top),1.5rem)] pb-[max(env(safe-area-inset-bottom),1.5rem)]">
      <section className="flex flex-1 flex-col justify-center gap-10">
        <div>
          <Logo size="lg" />
          <p className="mt-4 text-lg leading-relaxed text-muted">
            Name the song before the answers finish appearing.
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}
