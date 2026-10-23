import type { ReactNode } from "react";

// =====================================================
// D-07 — the capped-rendering banner
// =====================================================
// Server Component. Renders ONLY when the window holds more rows than the
// table shows (total > shown) — copy locked in UI-SPEC §Copywriting. The
// shown count comes from props (whatever the page actually rendered), never
// a hardcoded 500. Counts are plain integers — locale separators only, no
// unit math (AFM-002 is about sat/BTC values; these are row counts).

interface CapBannerProps {
  shown: number;
  total: number;
  /**
   * Copy variant (WR-03): "newest" only for windowed event tabs whose rows are
   * time-ordered; latest-state tabs (capacity-ordered) must use "largest" —
   * "newest" would be a factual misstatement of what got truncated.
   */
  variant?: "newest" | "largest";
  /** The right-aligned Export CSV affordance (page passes <ExportButton/>). */
  exportSlot?: ReactNode;
}

export function CapBanner({ shown, total, variant = "newest", exportSlot }: CapBannerProps) {
  if (total <= shown) return null;
  const tail =
    variant === "newest"
      ? " — Export CSV for the full window."
      : exportSlot
        ? " by capacity — Export CSV for all rows."
        : " by capacity.";
  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-lg border border-border bg-card/40 px-4 py-2">
      <p className="text-sm text-foreground/60">
        Showing {variant}{" "}
        <span className="font-mono tabular-nums">{shown.toLocaleString("en-US")}</span> of{" "}
        <span className="font-mono tabular-nums">{total.toLocaleString("en-US")}</span>
        {tail}
      </p>
      {exportSlot}
    </div>
  );
}
