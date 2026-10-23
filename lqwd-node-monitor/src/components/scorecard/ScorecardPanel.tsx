import type { DimensionKey, GradedDimension, ScorecardView } from "@/lib/scorecard/types";
import type { TabKey } from "@/lib/console/config";
import { formatSats } from "@/lib/format/units";
import { cn } from "@/lib/utils";
import { BackendBadge } from "./BackendBadge";
import { CriticalChip } from "./CriticalChip";
import { DimensionRow } from "./DimensionRow";
import { FreshnessStamp } from "./FreshnessStamp";
import { GradeBadge } from "./GradeBadge";

// =====================================================
// FLEET-02/03 — the modal quick-look scorecard body
// =====================================================
// Server Component serving ONLY the @modal interception route (in-app row
// click) — the console scorecard tab moved to the 03-15 signals/rail/evidence
// composition in [tab]/page.tsx. It receives a pre-computed ScorecardView and
// renders it VERBATIM — no grading, no color re-derivation (T-02-07), no db
// imports. Signals are SEVERED from the composite strip (sketch 003 rule:
// never mix signals into the grade list) — chips render in their own
// red-bordered block between header and dimension grid.

interface ScorecardPanelProps {
  node: ScorecardView;
  /** Grid column classes — the modal caps at 2 columns, the full page opens to 3. */
  gridClassName?: string;
}

function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

/**
 * D-02: the dimension → evidence-tab index. Tiles for mapped dimensions become
 * next/link affordances into the console tab carrying their evidence; the rest
 * (stability/restart/PG health/visibility) self-evidence on the scorecard and
 * render unlinked — a link to the page you're on is noise, not navigation.
 * Named export: the console scorecard tab (03-15) reuses this map for its
 * signals/evidence deep links — single source of truth.
 */
export const EVIDENCE_TAB: Partial<Record<DimensionKey, TabKey>> = {
  liquidity: "liquidity",
  forceClose: "closes",
  revenue: "forwards",
  routing: "forwards",
  channelHealth: "channels",
  peer: "peers",
};

/** Human dimension names — mirrors DimensionRow's display labels.
    Named export: the source of truth the console surfaces consume. */
export const DIMENSION_NAMES: Record<DimensionKey, string> = {
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

/**
 * AFM-002: rawDisplay strings are built HERE, at the render layer — DimensionRow
 * does NO unit math. Every sat value routes through formatSats; ratios/PPM/counts
 * are display formatting only (not sat conversions). Named export: the console
 * scorecard tab (03-15) builds its evidence lines through this same function.
 */
export function rawDisplayFor(dim: GradedDimension): string {
  if (dim.raw === null) return "";
  switch (dim.key) {
    case "routing":
      return `${dim.raw} fwds / 7d`;
    case "revenue": {
      const ppm = `${dim.raw.toFixed(1)} PPM`;
      const earnings = dim.extras?.earnings7dSat;
      return earnings === undefined ? ppm : `${ppm} (earned ${formatSats(earnings)} sats / 7d)`;
    }
    case "liquidity":
      return `${Math.round(dim.raw * 100)}% outbound`;
    case "channelHealth":
      return `${(dim.raw * 100).toFixed(1)}% inactive`;
    case "forceClose":
      return `${dim.raw} local FC / 30d`;
    case "restart":
      return `${(dim.raw / 24).toFixed(1)} d ago`;
    case "peer":
      return `${dim.raw} peers`;
    default:
      return ""; // no-data dims (stability/pgHealth/visibility) render their own state
  }
}

/**
 * D-13 freshness breakdown (checker W-2): one entry per dimension with a
 * non-null asOf, INCLUDING restart — its legitimately old timestamp stays
 * VISIBLE to the operator here even though fleet.ts excludes it from the floor
 * that drives the headline asOf/stale. No restart filter in this construction.
 */
function freshnessBreakdown(node: ScorecardView): Array<{ table: string; asOf: Date | null }> {
  return node.dimensions
    .filter((d) => d.asOf !== null)
    .map((d) => ({ table: DIMENSION_NAMES[d.key], asOf: d.asOf }));
}

export function ScorecardPanel({ node, gridClassName }: ScorecardPanelProps) {
  return (
    <section className="flex flex-col gap-5">
      {/* Composite header (D-06): alias + backend + composite grade + reason + chips + freshness. */}
      <header className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-3 pr-8">
          <h2 className="text-2xl font-semibold tracking-tight">
            {node.alias ?? shortPubkey(node.pubkey)}
          </h2>
          <BackendBadge backend={node.backend} />
        </div>
        <p className="font-mono text-xs break-all text-foreground/40">{node.pubkey}</p>

        {/* The composite strip: chip + reason + the D-13 stamp whose headline
            excludes restart while the breakdown shows it. ms-auto is acceptable
            HERE: the modal strip has no buttons to collide with, and the chip
            title carries the pct (inline pct lives in the console header only). */}
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-card/60 px-4 py-3">
          <GradeBadge
            size="lg"
            color={node.dot}
            letter={node.compositeLetter}
            title={node.compositePct !== null ? `${node.compositePct}% composite` : undefined}
          />
          {node.reason !== null && (
            <span className="text-sm text-foreground/70">{node.reason}</span>
          )}
          <span className="ms-auto">
            <FreshnessStamp
              asOf={node.asOf}
              stale={node.stale}
              breakdown={freshnessBreakdown(node)}
            />
          </span>
        </div>
      </header>

      {/* SEVERED signals block (sketch 003): Tier-1 chips never share the grade
          strip. Healthy nodes render no block at all — absence IS the signal. */}
      {node.criticalChips.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-status-critical/40 px-3 py-2">
          <span className="font-mono text-xs font-semibold tracking-[0.14em] text-status-critical uppercase">
            Active signals
          </span>
          {node.criticalChips.map((label) => (
            <CriticalChip key={label} label={label} />
          ))}
        </div>
      )}

      {/* The 10-dimension grid (D-01): 7 graded + peer partial + 3 no-data, canonical order. */}
      <div className="flex flex-col gap-3">
        <span className="font-mono text-xs font-semibold tracking-[0.18em] text-foreground/45 uppercase">
          Health dimensions · 7 graded + 3 awaiting log ingestion
        </span>
        <div
          className={cn("grid gap-3", gridClassName ?? "grid-cols-1 md:grid-cols-2 xl:grid-cols-3")}
        >
          {node.dimensions.map((dim) => {
            const evidenceTab = EVIDENCE_TAB[dim.key];
            return (
              <DimensionRow
                key={dim.key}
                dimension={dim}
                peerRelative={dim.peerRelative}
                backend={node.backend}
                rawDisplay={rawDisplayFor(dim)}
                href={evidenceTab && `/${node.pubkey}/${evidenceTab}`}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
