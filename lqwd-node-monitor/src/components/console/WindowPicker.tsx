import Link from "next/link";

import { WINDOW_PRESETS, type WindowKey } from "@/lib/console/config";
import { cn } from "@/lib/utils";

// =====================================================
// D-06 — the window picker (24h | 7d | 30d | 90d)
// =====================================================
// "Build, don't install" (UI-SPEC): a segmented control of four next/link
// anchors writing ?window={key} — no client component, no select/toggle-group
// block. The selected segment carries the navy accent (the second of the two
// new brand surfaces this phase). Segments come straight from WINDOW_PRESETS
// so the picker and the SQL window can never disagree on the preset set.

interface WindowPickerProps {
  basePath: string;
  selected: WindowKey;
}

export function WindowPicker({ basePath, selected }: WindowPickerProps) {
  return (
    <nav
      aria-label="Time window"
      // gap-px on a border ground = hairline separators (summary-strip grammar).
      className="inline-flex w-fit items-stretch gap-px overflow-hidden rounded-lg border border-border bg-border"
    >
      {(Object.keys(WINDOW_PRESETS) as WindowKey[]).map((key) => {
        const isSelected = key === selected;
        return (
          <Link
            key={key}
            href={`${basePath}?window=${key}`}
            aria-current={isSelected ? "true" : undefined}
            className={cn(
              "inline-flex items-center px-3 py-1.5 font-mono text-xs font-semibold tracking-[0.14em] whitespace-nowrap uppercase transition-colors",
              "outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
              isSelected
                ? // Navy = selection chrome, never a health signal (UI-SPEC §Color).
                  // White on navy — text-foreground is near-black in NOC Light (WR-02).
                  "bg-brand text-white"
                : "bg-card text-foreground/45 hover:text-foreground"
            )}
          >
            {key}
          </Link>
        );
      })}
    </nav>
  );
}
