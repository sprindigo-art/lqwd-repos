import type { ScorecardView } from "@/lib/scorecard/types";
import { GradeBadge } from "@/components/scorecard/GradeBadge";
import { DIMENSION_NAMES } from "@/components/scorecard/ScorecardPanel";
import { cn } from "@/lib/utils";

// =====================================================
// ConsoleRail — sticky summary rail (sketch 003 synthesis)
// =====================================================
// Server Component. Variant B's sticky left rail: composite chip on top, then
// a compact worst-first dimension index of the evidence panels. Renders a
// pre-computed ScorecardView VERBATIM — no grading, no color re-derivation
// (T-02-07). NO inline pct text anywhere: the 3-slot console header (03-15)
// owns the single on-page inline %; every pct here lives in chip title
// tooltips only. No-data dimensions sit last, inert at half opacity.

interface ConsoleRailProps {
  node: ScorecardView;
}

/** Worst-first: graded dims by pct ascending (nulls last), nodata dims last. */
function worstFirst(dimensions: ScorecardView["dimensions"]): ScorecardView["dimensions"] {
  return [...dimensions].sort((a, b) => {
    const aNodata = a.color === "nodata";
    const bNodata = b.color === "nodata";
    if (aNodata !== bNodata) return aNodata ? 1 : -1;
    if (a.pct === null && b.pct === null) return 0;
    if (a.pct === null) return 1;
    if (b.pct === null) return -1;
    return a.pct - b.pct;
  });
}

export function ConsoleRail({ node }: ConsoleRailProps) {
  return (
    <aside className="sticky top-6 flex flex-col gap-4">
      <div className="flex flex-col rounded-lg border border-border bg-card p-4">
        {/* Composite chip — pct in the title tooltip ONLY (inline-pct rule). */}
        <div className="pb-2">
          <GradeBadge
            size="lg"
            color={node.dot}
            letter={node.compositeLetter}
            title={node.compositePct !== null ? `${node.compositePct}% composite` : undefined}
          />
        </div>

        {/* Worst-first dimension index — a mini map of the evidence panels. */}
        {worstFirst(node.dimensions).map((dim) => {
          const nodata = dim.color === "nodata";
          return (
            <div
              key={dim.key}
              className={cn(
                "flex items-center justify-between border-b border-border py-2 last:border-b-0",
                // Inert at half opacity — deliberately quiet, not broken; no link.
                nodata && "opacity-50"
              )}
            >
              <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/45 uppercase">
                {DIMENSION_NAMES[dim.key]}
              </span>
              <GradeBadge
                size="sm"
                color={dim.color}
                letter={dim.letter}
                title={dim.pct !== null ? `${dim.pct}%` : undefined}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
}
