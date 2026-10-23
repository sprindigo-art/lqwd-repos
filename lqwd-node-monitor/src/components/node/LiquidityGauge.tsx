import { formatPercent, formatSats } from "@/lib/format/units";
import { cn } from "@/lib/utils";

// =====================================================
// LiquidityGauge — G4 capacity-weighted local/remote slider (Server)
// =====================================================
// The operator's at-a-glance "which way does this node's routable liquidity lean"
// instrument (gate feedback G4). A horizontal track splits into a LOCAL segment
// (left) and a REMOTE segment (right) sized by `localShare`, with a center 50%
// reference mark and a thumb at the local-share point — so a heavier-local node reads
// as a thumb past centre and a heavier-remote node as a thumb before it.
//
// COLOR LAW (13-UI-SPEC / DS-01, G12): a liquidity lean is a REFERENCE distinction,
// never a health state. The two sides are marked with reference hues — brand navy
// (df-brand) for the LOCAL side and neutral grey (df-slate) for the REMOTE side — so
// the split reads at a glance. Neither side is "good" or "bad": navy here is the
// sanctioned structural/reference marker for the local segment, NOT navy-as-health.
// The severity ramp (df-crit / df-warn / df-ok / df-watch, red / amber / green) is
// reserved for health and must NEVER appear here — a lean can never masquerade as a
// breach. Centre mark + thumb stay neutral (they mark position, not a side). See the
// DS-01 color law in 13-UI-SPEC § Color for the token boundary.
//
// HONEST-EMPTY: when there is no capacity or no routable balance (`localShare` null)
// there is nothing to lean, so it renders the empty copy and NO thumb — never a
// fabricated centred 50% bar. Server Component: consumes only serializable props,
// performs no reads. Sats render through AFM-002 `formatSats`; share through
// `formatPercent` — no inline unit math.

/** Verbatim honest-empty copy — shown when there is no routable liquidity to lean. */
const EMPTY_COPY = "No channel liquidity to report.";

export interface LiquidityGaugeProps {
  /** Aggregate local balance (sats) — raw, formatted here via AFM-002. */
  localSat: number;
  /** Aggregate remote balance (sats). */
  remoteSat: number;
  /** Aggregate capacity (sats) — 0 triggers the honest-empty state. */
  capacitySat: number;
  /**
   * Routable local share in [0,1], or `null` when there is no routable balance.
   * `null` (or `capacitySat === 0`) renders the honest-empty state (no thumb).
   */
  localShare: number | null;
  /** `"lg"` (overview block, default) or `"sm"` (compact inline, per-peer rows). */
  size?: "lg" | "sm";
  /** Optional caption above the gauge (e.g. "Node liquidity", a peer alias). */
  label?: string;
}

/**
 * Capacity-weighted local/remote liquidity gauge. Navy-local / grey-remote reference
 * chrome (never severity) with an honest-empty state; `lg` renders the labelled
 * overview block, `sm` a compact inline bar for dense per-peer/per-channel rows.
 */
export function LiquidityGauge({
  localSat,
  remoteSat,
  capacitySat,
  localShare,
  size = "lg",
  label,
}: LiquidityGaugeProps) {
  const isEmpty = capacitySat === 0 || localShare === null;
  const compact = size === "sm";

  // Honest-empty: nothing to lean — render the copy, never a fake centred bar.
  if (isEmpty) {
    return (
      <div
        data-testid="liquidity-gauge"
        data-empty="true"
        className={cn(
          "font-df-mono text-df-muted",
          compact ? "text-[11px]" : "rounded-df-card border border-df-border bg-df-surface px-4 py-3 text-[13px]",
        )}
      >
        {label !== undefined && !compact && (
          <div className="mb-1 font-df-mono text-[10.5px] font-bold tracking-[0.06em] text-df-muted uppercase">
            {label}
          </div>
        )}
        {EMPTY_COPY}
      </div>
    );
  }

  // localShare is non-null here; position the local segment + thumb by its percent.
  const localPct = Math.min(100, Math.max(0, localShare * 100));
  const trackHeight = compact ? "h-2" : "h-3";
  const trackWidth = compact ? "w-24" : "w-full";

  return (
    <div
      data-testid="liquidity-gauge"
      data-empty="false"
      className={cn(
        !compact && "rounded-df-card border border-df-border bg-df-surface px-4 py-3",
      )}
    >
      {label !== undefined && !compact && (
        <div className="mb-2 font-df-mono text-[10.5px] font-bold tracking-[0.06em] text-df-muted uppercase">
          {label}
        </div>
      )}

      {/* The track: local (left, navy) | remote (right, grey) with a centre mark. */}
      <div className={cn("relative flex items-center", compact ? "gap-2" : "gap-3")}>
        <div
          aria-hidden="true"
          className={cn(
            "relative flex overflow-hidden rounded-df-pill bg-df-border",
            trackHeight,
            trackWidth,
          )}
        >
          {/* Local segment — brand navy (df-brand) REFERENCE fill sized by the local share. */}
          <span
            data-testid="liquidity-local-segment"
            className="h-full bg-df-brand"
            style={{ width: `${localPct.toFixed(1)}%` }}
          />
          {/* Remote segment — neutral grey (df-slate) so the navy/grey split reads. */}
          <span className="h-full flex-1 bg-df-slate/40" />
          {/* Centre 50% reference mark. */}
          <span
            data-testid="liquidity-center-mark"
            className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-df-surface/70"
          />
          {/* Thumb at the local-share point — the glanceable lean indicator. */}
          <span
            data-testid="liquidity-thumb"
            className={cn(
              "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-df-slate bg-df-surface",
              compact ? "size-2.5" : "size-3.5",
            )}
            style={{ left: `${localPct.toFixed(1)}%` }}
          />
        </div>

        {/* Share readout (AFM-002). Compact keeps it to the share; lg adds sat legend. */}
        <span className="font-df-mono text-[11px] tabular-nums whitespace-nowrap text-df-muted">
          {formatPercent(localShare)}
        </span>
      </div>

      {/* Full sat legend on the overview block only (local vs remote sats). */}
      {!compact && (
        <div className="mt-2 flex items-center justify-between font-df-mono text-[10.5px] tabular-nums text-df-muted">
          <span>local {formatSats(localSat)} sat</span>
          <span>remote {formatSats(remoteSat)} sat</span>
        </div>
      )}
    </div>
  );
}
