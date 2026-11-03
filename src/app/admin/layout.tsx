import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Logo } from "@/components/Logo";

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-6">
        <div className="flex items-center gap-4">
          <Logo />
          <span className="rounded-full bg-surface-2 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted">
            Admin
          </span>
        </div>
        <nav className="flex items-center gap-6 text-sm">
          <Link href="/admin" className="font-semibold text-ink">
            Players
          </Link>
          <span className="text-muted/60" title="Coming next">
            Catalog
          </span>
          <span className="text-muted/60" title="Coming next">
            Games
          </span>
          <Link href="/" className="text-muted hover:text-ink">
            Back to the game
          </Link>
        </nav>
      </header>
      <main className="pt-8">{children}</main>
    </div>
  );
}
