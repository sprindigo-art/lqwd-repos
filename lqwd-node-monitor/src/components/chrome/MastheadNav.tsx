"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// =====================================================
// Masthead navigation — structural chrome (sketch contract)
// =====================================================
// Navy does structure: the active page gets a brand underline + full-ink text;
// inactive links sit muted and hover to full ink. No severity color here, ever.
// Client Component only for usePathname — no data, no state.

const LINKS = [
  { href: "/", label: "FLEET" },
  { href: "/inbox", label: "INBOX" },
  { href: "/pending", label: "PENDING" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MastheadNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex items-center gap-5">
      {LINKS.map(({ href, label }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 pb-1 font-mono text-xs font-semibold tracking-[0.16em] uppercase transition-colors",
              active
                ? "border-brand text-foreground"
                : "border-transparent text-foreground/45 hover:text-foreground",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
