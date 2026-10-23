import Link from "next/link";

import type { DimensionKey, GradedDimension, PeerRelative } from "@/lib/scorecard/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CriticalChip } from "./CriticalChip";
import { GradeBadge } from "./GradeBadge";
import { OutlierMarker } from "./OutlierMarker";

interface DimensionRowProps {
  dimension: GradedDimension;
  peerRelative: PeerRelative | null;
  backend: "lnd" | "ldk";
  /** Pre-formatted by the page (AFM-002) — this component does NO unit math. */
  rawDisplay: string;
  /** D-02 evidence deep link — when set, the WHOLE tile is the affordance
      (next/link wrap, hover border + text-brand-glow cue, fleet-row pattern).
      Dimensions whose evidence lives on the scorecard itself stay unlinked. */
  href?: string;
}

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  routing: "Routing",
  revenue: "Revenue",
  liquidity: "Liquidity",
  channelHealth: "Channel health",
  forceClose: "Force-close prevention",
  restart: "Restart",
  peer: "Peer",
  stability: "Stability",
  pgHealth: "PG health",
  visibility: "Visibility",
};

function LabeledTooltip({ label, body }: { label: React.ReactNode; body: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center">{label}</span>
        </TooltipTrigger>
        <TooltipContent>{body}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Dimension tile — three aligned slots: mono console-label (top-left),
 * severity-tinted grade chip (top-right, right-aligned), raw-value evidence
 * (bottom-left, Heading role); peer-relative/partial notes keep their slot.
 * The dimension percentage lives ONLY in the grade unit's tooltip, paired with
 * the grade-band explanation — it never renders inline (D-14 rules 1-3).
 * State precedence is STRICT, first match wins: nodata > partial > peer-relative
 * (checker I-1) — a no-data dimension short-circuits via early return and can
 * never render "No peer baseline yet" or an outlier marker.
 */
export function DimensionRow({
  dimension,
  peerRelative,
  backend,
  rawDisplay,
  href,
}: DimensionRowProps) {
  const name = DIMENSION_LABELS[dimension.key];

  // STATE 1 — no data (D-01): dashed tile, greyed, excluded from rollup. EARLY
  // RETURN — a no-data tile is never linked (no evidence tab to point at).
  if (dimension.color === "nodata") {
    return (
      <div className="flex min-h-[5.5rem] flex-col justify-between gap-3 rounded-lg border border-dashed border-border bg-card/40 p-3.5">
        <span className="font-mono text-xs font-semibold tracking-[0.14em] text-foreground/35 uppercase">
          {name}
        </span>
        <LabeledTooltip
          label={<span className="text-sm text-status-nodata">No data — needs log ingestion</span>}
          body="This signal lives in node/PG logs, not the warehouse. Excluded from the health rollup until log ingestion is added."
        />
      </div>
    );
  }

  const isPartial = dimension.note?.toLowerCase().includes("partial") ?? false;
  const linked = href !== undefined;

  const tile = (
    <div
      className={cn(
        "flex min-h-[5.5rem] flex-col justify-between gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors hover:border-foreground/20",
        // D-02 affordance cue: linked tiles answer hover with the brand border
        // (navy = structural chrome only — never a health signal).
        linked && "group-hover:border-brand-light/60 group-focus-visible:border-brand-light/60"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "font-mono text-xs font-semibold tracking-[0.14em] text-foreground/45 uppercase",
            linked && "transition-colors group-hover:text-brand-glow"
          )}
        >
          {name}
        </span>
        {/* The pct survives here ONLY — in the chip's title tooltip with the band explanation. */}
        <span className="text-right">
          <GradeBadge
            color={dimension.color}
            letter={dimension.letter}
            title={
              dimension.pct !== null
                ? `${dimension.pct}% — grade bands: A ≥90 · B ≥80 · C ≥70 · D ≥60 · F below 60.`
                : undefined
            }
          />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-base font-semibold tabular-nums">{rawDisplay}</span>

        {/* Tier-1 breach renders the SEPARATE chip inline (D-07) — never folded into the grade. */}
        {dimension.tier1Breach !== null && <CriticalChip label={dimension.tier1Breach.label} />}

        {/* STATE 2 — partial (peer dim, D-01) beats peer-relative; STATE 3 — peer-relative. */}
        {isPartial ? (
          <LabeledTooltip
            label={
              <span className="text-sm text-foreground/70">
                Partial — flap-rate needs event history
              </span>
            }
            body="Current peer count is live; per-peer flap rate needs disconnect-event history we don't yet collect."
          />
        ) : peerRelative === null || peerRelative.suppressed ? (
          <LabeledTooltip
            label={<span className="text-sm text-foreground/70">No peer baseline yet</span>}
            body="Too few nodes of this backend for a stable peer comparison."
          />
        ) : (
          peerRelative.isOutlier && <OutlierMarker backend={backend} />
        )}
      </div>
    </div>
  );

  if (!linked) return tile;

  // D-02: the whole tile is clickable — the evidence tab is one hop away.
  return (
    <Link
      href={href}
      className="group block rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {tile}
    </Link>
  );
}
