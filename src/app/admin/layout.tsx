import { requireAdmin } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { AdminNav } from "./AdminNav";

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
        <AdminNav />
      </header>
      <main className="pt-8">{children}</main>
    </div>
  );
}
