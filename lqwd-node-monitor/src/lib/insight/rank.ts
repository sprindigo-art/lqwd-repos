import type { DetectorId, InsightCard } from "@/lib/insight/types";

// =====================================================
// D-06 — deterministic card ranking (Phase 4)
// =====================================================
// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// There is deliberately NO tuning knob here: the rank is a fixed, total,
// deterministic order so the inbox and the engine always agree.
//
// D-06 reading (documented choice): within a severity band, stuck-pending
// cards rank by limbo-balance-at-risk and all other cards rank by normalized
// breach magnitude. Those two keys are NOT on a comparable scale (sats vs a
// unitless ratio), so rather than interleave them on incomparable numbers,
// stuck-pending cards sort FIRST within the band (funds physically locked
// on-chain outrank threshold breaches of equal severity), ordered by
// evidence.detail.limboSat descending; the remaining cards follow, ordered by
// |observed − threshold| / max(|threshold|, 1) descending (normalized breach
// distance — deterministic and unit-independent). All ties break by card id
// lexicographically for a total order.

const SEVERITY_ORDER: Record<InsightCard["severity"], number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/** The three stuck-pending signals whose rank key is limbo balance at risk. */
const STUCK_SIGNALS: ReadonlySet<DetectorId> = new Set<DetectorId>([
  "stuck_fc_past_maturity",
  "stuck_sweep",
  "stuck_open",
]);

/**
 * The ONE place evidence.detail.limboSat is numeric-coerced. Returns null when
 * missing or non-numeric — null sorts last within the stuck group.
 */
function limboSatOf(card: InsightCard): number | null {
  const raw = card.evidence.detail?.limboSat;
  if (raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Normalized breach distance — unit-independent magnitude for non-stuck cards. */
function magnitudeOf(card: InsightCard): number {
  const { observed, threshold } = card.evidence;
  return Math.abs(observed - threshold) / Math.max(Math.abs(threshold), 1);
}

/**
 * D-06 deterministic sort (pure, non-mutating). Order:
 *  1. severity band: critical, then warn, then info;
 *  2. within a band: stuck-pending cards first, by limboSat descending
 *     (missing/non-numeric limboSat last among stuck cards);
 *  3. then all other cards by normalized breach magnitude descending;
 *  4. every tie breaks by id lexicographic — same input (any permutation)
 *     always yields the identical output sequence.
 */
export function rankCards(cards: InsightCard[]): InsightCard[] {
  return [...cards].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;

    const aStuck = STUCK_SIGNALS.has(a.signal);
    const bStuck = STUCK_SIGNALS.has(b.signal);
    if (aStuck !== bStuck) return aStuck ? -1 : 1;

    if (aStuck && bStuck) {
      const la = limboSatOf(a);
      const lb = limboSatOf(b);
      if (la !== null && lb !== null && la !== lb) return lb - la;
      if (la === null && lb !== null) return 1;
      if (la !== null && lb === null) return -1;
    } else {
      const ma = magnitudeOf(a);
      const mb = magnitudeOf(b);
      if (ma !== mb) return mb - ma;
    }

    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
