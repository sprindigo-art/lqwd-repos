// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// vitals.ts — the proportional fleet-vitals rollup (OVW-03 / D-07)
// =====================================================
// Behind each of the 5 `FleetVitals` cards is one health bar whose segment
// widths are STRICTLY proportional: a segment's width = `count / total`, where
// `count` is the number of entities in that df `Severity` state and `total` is
// EVERY entity in the layer (healthy ones included — D-07). There is NO severity
// weighting here: a single critical of four entities is a 0.25-wide segment, no
// more. `stale` carries its own segment and is NEVER folded into `healthy`
// (D-08) — a no-data entity must read as "no fresh fact", not as "fine".
//
// SINGLE-COUNT CONTRACT (Pitfall 4): a multi-signal entity — e.g. a host with
// independent cpu / mem / disk ramps — MUST be reduced to ONE df `Severity` rung
// by the CALLER (via `worstSeverity`) BEFORE it is passed in, so it contributes
// exactly 1 to `total`. This module deliberately accepts only an array of
// already-reduced per-entity severities; it does not see raw multi-signal rows
// and so cannot double-count one entity across its signals.

import type { Severity } from "@/components/df/Severity";
import { worstSeverity } from "@/lib/overview/severity-map";

/** Layers the overview fleet-vitals bar reports on — one card per layer. */
export type VitalsLayer = "nodes" | "hosts" | "services" | "bitcoind" | "storage";

export interface LayerVitals {
  /** Which fleet layer this rollup describes. */
  layer: VitalsLayer;
  /** Per-state entity tally; every df state keyed so the bar can render all 5 segments. */
  counts: Record<Severity, number>;
  /** Denominator for every segment width = ALL entities in the layer (healthy included, D-07). */
  total: number;
  /** Worst active rung present (stale orthogonal — never promotes; D-08). */
  worst: Severity;
}

/**
 * Roll up one layer's already-reduced per-entity severities into strictly
 * count-proportional per-state tallies.
 *
 * @param layer       which fleet layer this describes
 * @param severities  ONE df `Severity` per entity — the caller has already
 *                    reduced any multi-signal entity to a single rung (Pitfall 4)
 *
 * `total` = `severities.length` (every entity counts, healthy included — D-07).
 * `counts.stale` is its own bucket, never folded into `healthy` (D-08).
 * `worst` = `worstSeverity(severities)` (filters stale before reducing). Empty
 * layer → all counts 0, `total` 0, `worst` "healthy"; the caller guards the
 * divide-by-zero when computing segment widths. Never mutates `severities`.
 */
export function rollupLayer(layer: VitalsLayer, severities: Severity[]): LayerVitals {
  // All five df states keyed at 0 (mirrors facetCounts' Record accumulator shape).
  const counts: Record<Severity, number> = {
    critical: 0,
    warning: 0,
    watch: 0,
    healthy: 0,
    stale: 0,
  };

  for (const sev of severities) {
    counts[sev] += 1;
  }

  return {
    layer,
    counts,
    total: severities.length,
    worst: worstSeverity(severities),
  };
}
