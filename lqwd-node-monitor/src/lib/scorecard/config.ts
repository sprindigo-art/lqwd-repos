import type { DimensionKey } from "@/lib/scorecard/types";

// =====================================================
// D-02 — the SINGLE tuning surface
// =====================================================
// STARTING VALUES, NOT CONTRACT — the operator retunes here as fleet data
// accumulates; computation code (grade.ts, compare.ts, freshness.ts) never
// embeds thresholds. Per-dimension AND per-backend (lnd vs ldk) since the
// backends differ in services/recovery (D-04/D-08). Phase 4's insight engine
// reads these SAME bands — do not fork a second threshold table.
//
// Pure module: NO server-only import — test-imported and safe anywhere.
//
// Band semantics (consumed by grade.ts pctFor):
//  - direction "higher-better": raw graded as-is; a/b/c/d are descending cutoffs.
//  - direction "lower-better":  raw graded on badness; a/b/c/d are ascending cutoffs.
//  - direction "mid-better":    raw first transformed to |raw − center| (deviation),
//    then the cutoffs act as lower-better deviation cutoffs.
// Anchors: raw at cutoff a → 90 (A), b → 80, c → 70, d → 60; linear between.

export type Direction = "higher-better" | "lower-better" | "mid-better";

export interface Band {
  a: number;
  b: number;
  c: number;
  d: number;
  direction: Direction;
  center?: number; // mid-better only; defaults to 0.5 in grade.ts
}

/** The SINGLE critical (red) line per dimension (D-07/D-08). Everything else caps at yellow. */
export interface Tier1Line {
  metric: "raw" | string; // "raw" or a DimensionResult.extras key (e.g. "maxHourlySelfCloses")
  op: ">" | "<" | ">=" | "<=";
  value: number;
  label: string; // rendered as the critical chip, e.g. "fee crash"
}

export interface DimConfig {
  band: Band;
  tier1?: Tier1Line;
  reasonLabel: string; // D-06 reason subtext for the lowest-grade driver
}

/** Config covers only the computable dimensions — no-data dims (D-01) have no bands. */
export type BackendConfig = Record<
  Exclude<DimensionKey, "stability" | "pgHealth" | "visibility">,
  DimConfig
>;

export const SCORECARD_CONFIG: Record<"lnd" | "ldk", BackendConfig> = {
  lnd: {
    // raw = forwards count over 7d. provisional — LOW confidence (no absolute band
    // documented; operator practice is "non-zero, judged relative to peers via MAD").
    routing: {
      band: { a: 1000, b: 250, c: 50, d: 1, direction: "higher-better" },
      reasonLabel: "low routing volume",
    },
    // raw = 24h fee-PPM. Bands from cross-node-monitoring-matrix.md (France fee-crash)
    // — MEDIUM confidence. Tier-1 fee crash < 10 PPM is the best-supported red line.
    revenue: {
      band: { a: 100, b: 50, c: 30, d: 10, direction: "higher-better" },
      // Null-PPM semantics (checker I-3): revenueForFleet returns raw = null
      // (NOT 0) when a node has zero 24h flow — the PPM denominator's NULLIF
      // yields SQL NULL, and gradeDimension short-circuits null raw to no-data
      // before Tier-1 evaluation. So this fee-crash Tier-1 can only fire when
      // there IS nonzero 24h flow at a crashed fee rate; a TOTAL routing stall
      // does NOT trip fee-crash — it is backstopped by the peer-unreachable
      // Tier-1 below and the D-13 stale marker.
      tier1: { metric: "raw", op: "<", value: 10, label: "fee crash" },
      reasonLabel: "low revenue",
    },
    // raw = outbound ratio 0..1, graded on |raw − 0.5| (lower deviation better).
    // provisional — LOW confidence (no firm band; 0.2–0.8 "balanced" guidance).
    liquidity: {
      band: { a: 0.15, b: 0.25, c: 0.3, d: 0.4, direction: "mid-better", center: 0.5 },
      reasonLabel: "unbalanced liquidity",
    },
    // raw = inactive-channel ratio. France-derived 8% warn line — MEDIUM confidence.
    channelHealth: {
      band: { a: 0.02, b: 0.05, c: 0.08, d: 0.15, direction: "lower-better" },
      reasonLabel: "high inactive channels",
    },
    // raw = LOCAL force-closes in 30d. Tier-1 = AP-11 close storm
    // (≥50 self-closes/hr, operational-anti-patterns.md) — HIGH confidence.
    forceClose: {
      band: { a: 0, b: 1, c: 2, d: 4, direction: "lower-better" },
      tier1: { metric: "maxHourlySelfCloses", op: ">=", value: 50, label: "close storm" },
      reasonLabel: "force closes",
    },
    // raw = hours since last_restart (longer uptime better) — MEDIUM confidence.
    // restart-loop Tier-1 deferred: lnd_restart stores only the LATEST restart,
    // so a ≥2-in-window loop detector has no history to count (see RESEARCH).
    restart: {
      band: { a: 720, b: 168, c: 48, d: 24, direction: "higher-better" },
      reasonLabel: "recent restart",
    },
    // raw = num_peers (latest lnd_node_info). Tier-1 unreachable when < 1.
    // derived — LOW confidence.
    peer: {
      band: { a: 20, b: 10, c: 5, d: 1, direction: "higher-better" },
      tier1: { metric: "raw", op: "<", value: 1, label: "unreachable" },
      reasonLabel: "low peer count",
    },
  },
  // LDK starts IDENTICAL to LND pending LDK-specific data — but it is its own
  // object literal so the per-backend tuning surface exists from day one
  // (D-02/D-08): retune ldk values here without touching lnd or any code.
  ldk: {
    routing: {
      band: { a: 1000, b: 250, c: 50, d: 1, direction: "higher-better" },
      reasonLabel: "low routing volume",
    },
    revenue: {
      band: { a: 100, b: 50, c: 30, d: 10, direction: "higher-better" },
      // Null-PPM semantics: same as the lnd revenue tier1 above — zero 24h flow
      // → raw null (no-data), so fee-crash requires nonzero 24h flow.
      tier1: { metric: "raw", op: "<", value: 10, label: "fee crash" },
      reasonLabel: "low revenue",
    },
    liquidity: {
      band: { a: 0.15, b: 0.25, c: 0.3, d: 0.4, direction: "mid-better", center: 0.5 },
      reasonLabel: "unbalanced liquidity",
    },
    channelHealth: {
      band: { a: 0.02, b: 0.05, c: 0.08, d: 0.15, direction: "lower-better" },
      reasonLabel: "high inactive channels",
    },
    forceClose: {
      band: { a: 0, b: 1, c: 2, d: 4, direction: "lower-better" },
      tier1: { metric: "maxHourlySelfCloses", op: ">=", value: 50, label: "close storm" },
      reasonLabel: "force closes",
    },
    restart: {
      band: { a: 720, b: 168, c: 48, d: 24, direction: "higher-better" },
      reasonLabel: "recent restart",
    },
    peer: {
      band: { a: 20, b: 10, c: 5, d: 1, direction: "higher-better" },
      tier1: { metric: "raw", op: "<", value: 1, label: "unreachable" },
      reasonLabel: "low peer count",
    },
  },
};

/** D-11/D-12 MAD comparison knobs — tunable, not contract. */
export const COMPARE_CONFIG = { madN: 3, minCohortForMedian: 3 };

/** D-13 staleness threshold — ~6h covers a couple missed channel_info snapshots (~3.7/day). */
export const STALENESS = { warnAfterHours: 6 };
