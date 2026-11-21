"use client";

import Link from "next/link";
import { createContext, useContext } from "react";

// Nothing in a side panel takes you to another page: a link inside one opens
// its page in the panel (with a back arrow), and closing the panel leaves you
// where you were. The same link anywhere else is an ordinary link.

/** A page a side panel can show: a past game's results, or someone's short profile. */
export type PanelPage = {
  kind: "game" | "profile";
  id: string;
  /** The panel's heading for it, and its back arrow's label on the page after it. */
  title: string;
  subtitle?: string;
};

const PanelNav = createContext<((page: PanelPage) => void) | null>(null);

/** The side panel gives what's inside it a way to open a page in the panel. */
export const PanelNavProvider = PanelNav.Provider;

/** A link that opens its page in the side panel when it's in one, and goes to `href` anywhere else. */
export function PanelLink({
  href,
  page,
  className = "",
  children,
}: {
  href: string;
  page: PanelPage;
  className?: string;
  children: React.ReactNode;
}) {
  const open = useContext(PanelNav);
  if (!open) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={() => open(page)} className={`w-full text-left ${className}`}>
      {children}
    </button>
  );
}
