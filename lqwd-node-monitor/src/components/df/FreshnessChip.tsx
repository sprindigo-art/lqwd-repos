import { Clock } from "lucide-react";

import { cn } from "@/lib/utils";

// =====================================================
// FreshnessChip — honest fresh / stale / no-data chip (Server)
// =====================================================
// DS-01 honest-stale: stale is a FIRST-CLASS, shape-distinct state, never faked
// with a softened-green dot. Mirrors FreshnessStamp's fresh/stale/no-data
// branching (incl. the `asOf === null → "no data yet"` honest early-return) but
// the stale treatment is SHAPE-distinct per the prototype STALE chip (square dot
// radius 2px + dashed border + #A9912F text + a stale clock icon). A fresh chip
// uses a round green dot; a stale chip NEVER renders a green dot.
//
// The label is a RELATIVE age ("4s ago", "4m ago") matching the prototype's
// glanceable "data fresh · 4s" / "last good 4h ago" recency (Ops Center 143/248,
// Node Detail 132) — NOT an absolute wall-clock UTC stamp. Time math only via
// Date deltas; no sat/BTC math here.

interface FreshnessChipProps {
  /** Worst-case oldest timestamp across the node's source tables (D-13). */
  asOf: Date | null;
  /** Past the staleness threshold — drives the shape-distinct stale treatment. */
  stale: boolean;
  /**
   * Reference "now" for the relative-age delta. Defaults to `new Date()`; pass an
   * explicit value for deterministic SSR/tests so the rendered age is stable.
   */
  now?: Date;
  /** Extra classes merged last via `cn()`. */
  className?: string;
}

/**
 * Humanize the delta between `asOf` and `now` into the prototype's glanceable
 * relative form ("4s ago", "4m ago", "4h ago", "4d ago"). Clamps future/equal
 * timestamps to "0s ago" so a clock skew never prints a negative age.
 */
function relativeAge(asOf: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - asOf.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * A freshness chip. `asOf === null` honestly renders "no data yet"; stale renders
 * the shape-distinct gold treatment (square dot + dashed border); fresh renders
 * the round green-dot stamp. Both fresh and stale show a RELATIVE age.
 */
export function FreshnessChip({ asOf, stale, now, className }: FreshnessChipProps) {
  // Honest no-data early-return — never paint a fresh/stale chip without a stamp.
  if (asOf === null) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 font-df-mono text-xs text-df-muted",
          className
        )}
      >
        no data yet
      </span>
    );
  }

  const stamp = relativeAge(asOf, now ?? new Date());
  // When the caller injects an explicit `now` (tests / deterministic SSR) the
  // stamp is stable and reconciles exactly. When it is omitted we fall back to
  // `new Date()`, whose value differs between the SSR render and a client
  // re-render inside a "use client" tree — a benign relative-age drift. Suppress
  // ONLY that fallback so the honest age never triggers a hydration mismatch on
  // the `now` prop (mirrors PollAge). Explicit `now` renders with no suppression.
  const suppressAgeHydration = now === undefined || undefined;

  if (stale) {
    return (
      <span
        suppressHydrationWarning={suppressAgeHydration}
        className={cn(
          // shape-distinct stale: dashed border + gold text + stale icon
          "inline-flex items-center gap-1.5 rounded-df-pill border border-dashed border-df-stale-border bg-df-stale-tint px-2 py-0.5 font-df-mono text-[10px] font-bold tracking-[0.04em] text-df-stale-text uppercase",
          className
        )}
      >
        {/* SQUARE dot, radius 2px — never a round green fresh dot (DS-01). */}
        <span className="size-1.5 flex-none rounded-[2px] bg-df-stale-dot" aria-hidden="true" />
        <Clock className="size-3 flex-none" strokeWidth={2.4} aria-hidden="true" />
        STALE — last good {stamp}
      </span>
    );
  }

  return (
    <span
      suppressHydrationWarning={suppressAgeHydration}
      className={cn(
        "inline-flex items-center gap-1.5 font-df-mono text-xs tabular-nums text-df-muted",
        className
      )}
    >
      {/* round green fresh dot */}
      <span className="size-1.5 flex-none rounded-full bg-df-ok" aria-hidden="true" />
      data fresh · {stamp}
    </span>
  );
}
