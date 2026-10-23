// =====================================================
// Scorecard type contracts (Phase 2 — FLEET-02/FLEET-03)
// =====================================================
// The interface-first surface every scorecard plan codes against. Pure types +
// constants only — no imports, no runtime dependencies, safe everywhere.
//
// Invariants encoded here:
//  - raw values stay RAW (sats, ratios, counts, PPM) — the AFM-002 formatter
//    applies at render only; nothing in this layer converts units.
//  - D-01: 7 computable dimensions + 3 explicit "no data" dimensions (stability,
//    pgHealth, visibility need log/pg_stat ingestion not in the warehouse).
//  - D-07: critical is a SEPARATE signal (tier1Breach / dot), never folded into
//    the composite grade.
//  - D-12: peer-relative (MAD outlier) is a SEPARATE signal that never alters
//    the absolute grade.

export type DimensionKey =
  | "routing"
  | "revenue"
  | "liquidity"
  | "channelHealth"
  | "forceClose"
  | "restart"
  | "peer"
  | "stability"
  | "pgHealth"
  | "visibility";

/** The 7 dimensions computable from the `routing_vm` warehouse (D-01 "solid 6" + partial peer). */
export const COMPUTABLE_DIMENSIONS: readonly DimensionKey[] = [
  "routing",
  "revenue",
  "liquidity",
  "channelHealth",
  "forceClose",
  "restart",
  "peer",
];

/** D-01: no warehouse source (logs / pg_stat / meta) — rendered greyed, excluded from rollup. */
export const NO_DATA_DIMENSIONS: readonly DimensionKey[] = [
  "stability",
  "pgHealth",
  "visibility",
];

export type Letter = "A" | "B" | "C" | "D" | "F";

export type StatusColor = "ok" | "warn" | "critical" | "nodata";

/** A computed dimension value BEFORE grading — raw units, no thresholds applied. */
export interface DimensionResult {
  raw: number | null; // RAW units (sats, ratio, count, PPM) — formatter at render only (AFM-002)
  asOf: Date | null;
  note?: string;
  extras?: Record<string, number>; // e.g. maxHourlySelfCloses, earnings7dSat, rebalanceSuccessRate
}

/** A Tier-1 critical breach (D-07/D-08) — the ONLY thing that can turn a node red. */
export interface Tier1Breach {
  label: string; // e.g. "fee crash"
}

/** A dimension after grading against its DimConfig band (D-05 display contract). */
export interface GradedDimension {
  key: DimensionKey;
  raw: number | null;
  pct: number | null; // null for no-data dims
  letter: Letter | null;
  color: StatusColor;
  tier1Breach: Tier1Breach | null;
  note?: string;
  asOf: Date | null;
  extras?: Record<string, number>; // RAW detail passthrough (e.g. earnings7dSat) — formatter at render only
}

/** Peer-relative MAD comparison result (D-10/D-11/D-12) — a SEPARATE signal, never a grade input. */
export interface PeerRelative {
  suppressed: boolean; // true → "no peer baseline yet" (D-11 small-cohort suppression)
  median?: number;
  deltaFromMedian?: number;
  isOutlier?: boolean; // D-12 — NEVER alters the absolute grade
}

/** The per-node view the overview + scorecard UI renders (D-05/D-06/D-07/D-09). */
export interface ScorecardView {
  pubkey: string;
  alias: string | null;
  backend: "lnd" | "ldk";
  compositePct: number | null;
  compositeLetter: Letter | null;
  dot: "ok" | "warn" | "critical"; // D-07: critical iff ≥1 Tier-1 breach
  reason: string | null; // D-06 reason subtext
  criticalChips: string[]; // tier1 labels, rendered as "critical: {label}"
  dimensions: Array<GradedDimension & { peerRelative: PeerRelative | null }>;
  asOf: Date | null; // D-13 worst-case stamp
  stale: boolean;
}

export interface FleetView {
  nodes: ScorecardView[];
  fetchedAt: Date;
}
