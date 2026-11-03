"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Players", exact: true },
  { href: "/admin/catalog", label: "Catalog" },
  { href: "/admin/games", label: "Games" },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-6 text-sm">
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? "font-semibold text-ink" : "text-muted hover:text-ink"}
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
      <Link href="/" className="text-muted hover:text-ink">
        Back to the game
      </Link>
    </nav>
  );
}
