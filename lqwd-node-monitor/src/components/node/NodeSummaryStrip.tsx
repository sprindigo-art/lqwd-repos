import { formatSats } from "@/lib/format/units";

// =====================================================
// NodeSummaryStrip — the lean overview counts glance (Server)
// =====================================================
// The compact, tightly-aligned counts strip at the top of the lean /{pubkey}
// overview (gate feedback G3 — high density, no dead columns). Mirrors the console
// SummaryStrip grammar (micro mono kicker over a tabular value, gap-px cells on a
// border ground) but tuned to a FIXED four-cell set — Channels · Peers · Capacity ·
// Local share — so the overview reads at a glance with no free-floating rows.
//
// COLOR LAW (13-UI-SPEC § Color / DS-01): these are DATA figures, so they render in
// NEUTRAL tokens only — never a severity ramp hue and never navy (navy is structure/
// action, the severity ramp is state; a raw count is neither). All figures are mono +
// tabular-nums.
//
// HONEST UNKNOWNS (D-08 / AFM-002): counts are `number | null`; a null count renders
// "—", never a fabricated 0. Capacity routes through `formatSats` and the local share
// through `formatPercent` (which already renders "—" for a null share) — no inline
// unit math. Server Component: consumes only serializable props, performs no reads.

export interface NodeSummaryStripProps {
  /** Active channel count, or `null` when unknown (renders "—", never a fake 0). */
  channelCount: number | null;
  /** Connected peer count, or `null` when unknown (renders "—"). */
  peerCount: number | null;
  /** Aggregate capacity (sats). */
  capacitySat: number;
}

/** A count → display string with an honest "—" for a null (never a fabricated 0). */
function countLabel(count: number | null): string {
  return count === null ? "—" : count.toLocaleString("en-US");
}

/**
 * The lean overview counts strip: a FIXED three-cell set (Channels · Peers · Capacity)
 * in a bounded, aligned grid. Neutral mono figures with honest "—" for unknowns; no
 * severity/navy on the data. Local-share is deliberately NOT shown — the LiquidityGauge
 * directly below owns every liquidity figure (audit E, no duplicated readouts).
 */
export function NodeSummaryStrip({
  channelCount,
  peerCount,
  capacitySat,
}: NodeSummaryStripProps) {
  const cells: { label: string; value: string }[] = [
    { label: "Channels", value: countLabel(channelCount) },
    { label: "Peers", value: countLabel(peerCount) },
    { label: "Capacity", value: `${formatSats(capacitySat)} sat` },
  ];

  return (
    <div
      data-testid="node-summary-strip"
      className="grid grid-cols-3 gap-px overflow-hidden rounded-df-card border border-df-border bg-df-border"
    >
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-1 bg-df-surface px-4 py-2.5">
          <span className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
            {cell.label}
          </span>
          {/* Never `truncate` a financial sat figure — allow it to wrap rather than
              silently clip a capacity value (audit E). */}
          <span className="font-df-mono text-[17px] leading-tight font-semibold tabular-nums text-df-ink">
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}
