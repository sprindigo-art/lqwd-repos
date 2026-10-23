import Link from "next/link";

import { TAB_KEYS, type TabKey } from "@/lib/console/config";
import { cn } from "@/lib/utils";

// =====================================================
// D-01/D-03 — the console tab bar at /{pubkey}
// =====================================================
// Server Component, zero client tab state: the URL is the source of truth.
// Each trigger is a next/link anchor to /{pubkey}/{tab}; the vendored Radix
// tabs block (src/components/ui/tabs.tsx) is VISUAL CHROME ONLY — its
// line-variant grammar (quiet triggers, hairline ground, underline indicator)
// is restyled here onto plain anchors because Radix Tabs manages client
// state we deliberately don't want. Active tab carries the navy indicator —
// one of the two new brand surfaces this phase (UI-SPEC §Color: navy is
// structural chrome, NEVER a health signal).

interface ConsoleTabsProps {
  pubkey: string;
  active: TabKey;
  /** In-flight channel count for the pending tab — navy (structural: the count
      is information, not severity). Zero/null renders nothing (D-12 zero-quiet). */
  pendingCount?: number | null;
}

export function ConsoleTabs({ pubkey, active, pendingCount }: ConsoleTabsProps) {
  return (
    // Horizontal scroll on narrow screens; the active tab stays reachable.
    <nav aria-label="Console tabs" className="no-scrollbar overflow-x-auto">
      <div className="flex w-max min-w-full items-stretch gap-1 border-b border-border">
        {TAB_KEYS.map((key) => {
          const isActive = key === active;
          return (
            <Link
              key={key}
              href={`/${pubkey}/${key}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                // Console-label voice: mono, micro, tracked, uppercase.
                "relative inline-flex items-center px-3 py-2 font-mono text-xs font-semibold tracking-[0.14em] whitespace-nowrap uppercase transition-colors",
                "rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                isActive
                  ? // Active: full-strength foreground + the navy underline marker
                    // (brand-light reads against the void bg; same family as --ring).
                    "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand-light"
                  : "text-foreground/45 hover:text-foreground"
              )}
            >
              {key}
              {key === "pending" && typeof pendingCount === "number" && pendingCount > 0 && (
                <span className="ms-1.5 font-mono tabular-nums text-brand-light">
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
