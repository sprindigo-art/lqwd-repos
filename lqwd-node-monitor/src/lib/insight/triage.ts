import type { DetectorId, InsightCard, Severity } from "@/lib/insight/types";

// =====================================================
// triage — pure partition / facet / series-kind transforms (Phase 7, INBOX-01/02/03)
// =====================================================
// Pure module: NO server-side-only imports, NO DB, NO React — test-imported and
// safe anywhere. The functions here re-shape the FROZEN, pre-ranked InsightCard[]
// from loadInsightView() into the inbox's severity spine + collapsed info
// groups + suppressed block, and classify a card's evidence to one of the
// three sanctioned sparkline series.
//
// Invariants encoded here (locked by triage.test.ts BEFORE any UI is built):
//  - Engine order is LAW (InsightCardList.tsx header): we ONLY partition a
//    pre-ranked array — never re-sort within a partition.
//  - Partition driver is `card.severity` (D-01), NOT signal-type:
//      critical || warn (and !suppressed) → spine
//      info && !suppressed                → groups (signal → pubkey|"fleet", D-02)
//      suppressed.active                  → suppressed block (D-03; suppression wins)
//    A critical is NEVER folded into a group (Pitfall 6).
//  - No card is dropped: count-in === count-out across {spine, groups, suppressed}.
//  - `facetCounts(cards)` runs over the UNFILTERED set; `applyFacets(cards, state)`
//    narrows only the rendered set — two separate functions (Pitfall 2).

// ── Action-type vocabulary (for the facet codec + counts) ────────────────────
/** The 5 suggestedAction types, plus the synthetic "none" bucket for null actions. */
export type ActionFacetKey =
  | "update_fee"
  | "close_channel"
  | "rebalance"
  | "remediate_pending"
  | "investigate"
  | "none";

/** A card's action bucket: its `suggestedAction.type`, or "none" when null. */
export function actionKeyFor(card: InsightCard): ActionFacetKey {
  return card.suggestedAction?.type ?? "none";
}

// ── Partition (severity spine vs collapsed info groups vs suppressed) ─────────

/** signal → (node.pubkey ?? "fleet") → cards, all engine-ordered. */
export type InfoGroups = Map<DetectorId, Map<string, InsightCard[]>>;

export interface TriagePartition {
  /** critical + warn, non-suppressed — individual rows, never folded. */
  spine: InsightCard[];
  /** info, non-suppressed — two-level nested collapsed groups (D-02). */
  groups: InfoGroups;
  /** any suppressed card — always-visible block (D-03; suppression wins). */
  suppressed: InsightCard[];
}

/**
 * Partition the pre-ranked card array. Suppression takes precedence over
 * severity: a suppressed card (even critical) goes to the suppressed block and
 * never to the spine or a group. Engine order is preserved within each
 * partition (single pass, no sort).
 */
export function partitionTriage(cards: InsightCard[]): TriagePartition {
  const spine: InsightCard[] = [];
  const groups: InfoGroups = new Map();
  const suppressed: InsightCard[] = [];

  for (const card of cards) {
    if (card.suppressed.active) {
      suppressed.push(card);
      continue;
    }
    if (card.severity === "critical" || card.severity === "warn") {
      spine.push(card);
      continue;
    }
    // info, non-suppressed → nest signal → pubkey|"fleet" (D-02)
    const key = card.node?.pubkey ?? "fleet";
    const byNode = groups.get(card.signal) ?? new Map<string, InsightCard[]>();
    const list = byNode.get(key) ?? [];
    list.push(card);
    byNode.set(key, list);
    groups.set(card.signal, byNode);
  }

  return { spine, groups, suppressed };
}

// ── Facet counts (over the UNFILTERED set — Pitfall 2) ───────────────────────

export interface FacetCounts {
  severity: Record<Severity, number>;
  node: Record<string, { alias: string | null; count: number }>;
  signal: Partial<Record<DetectorId, number>>;
  action: Partial<Record<ActionFacetKey, number>>;
}

/**
 * Count cards per facet dimension over the FULL array. Takes ONLY the card
 * array (no facet-state argument) so counts can never be derived from a
 * post-filter subset — the rail always shows fleet-wide totals.
 */
export function facetCounts(cards: InsightCard[]): FacetCounts {
  const severity: Record<Severity, number> = { critical: 0, warn: 0, info: 0 };
  const node: Record<string, { alias: string | null; count: number }> = {};
  const signal: Partial<Record<DetectorId, number>> = {};
  const action: Partial<Record<ActionFacetKey, number>> = {};

  for (const card of cards) {
    severity[card.severity] += 1;

    if (card.node !== null) {
      const entry = node[card.node.pubkey] ?? { alias: card.node.alias, count: 0 };
      entry.count += 1;
      node[card.node.pubkey] = entry;
    }

    signal[card.signal] = (signal[card.signal] ?? 0) + 1;

    const actionKey = actionKeyFor(card);
    action[actionKey] = (action[actionKey] ?? 0) + 1;
  }

  return { severity, node, signal, action };
}

// ── Facet application (narrows the rendered set only) ─────────────────────────

/** Active facet selections — empty array on a dimension means "no filter". */
export interface FacetState {
  sev: Severity[];
  node: string[];
  signal: DetectorId[];
  action: ActionFacetKey[];
}

/**
 * Narrow the card array to the active facets. AND across dimensions, OR within a
 * dimension. An empty dimension is a no-op. Engine order is preserved.
 */
export function applyFacets(cards: InsightCard[], state: FacetState): InsightCard[] {
  return cards.filter((card) => {
    if (state.sev.length > 0 && !state.sev.includes(card.severity)) return false;
    if (state.node.length > 0) {
      const pubkey = card.node?.pubkey ?? null;
      if (pubkey === null || !state.node.includes(pubkey)) return false;
    }
    if (state.signal.length > 0 && !state.signal.includes(card.signal)) return false;
    if (state.action.length > 0 && !state.action.includes(actionKeyFor(card))) return false;
    return true;
  });
}

// ── Sparkline series classification (D-13 / OQ-4) ─────────────────────────────

/**
 * Which of the three sanctioned daily series (if any) backs a card's evidence:
 *   - "forwards-fees" — fee/revenue-evidence signals (forwardsDailySeries → feesSat)
 *   - "forwards-count" — routing-volume-evidence signals (forwardsDailySeries → n)
 *   - "closes" — close-evidence signals (closesDailySeries → count)
 *   - null — latest-state dims (stuck/rebalance/liquidity) ⇒ honest "no trend data"
 */
export type SeriesKind = "forwards-fees" | "forwards-count" | "closes" | null;

const FEE_REVENUE_SIGNALS: ReadonlySet<DetectorId> = new Set<DetectorId>([
  "fee_raise",
  "fee_lower",
  "fee_stepdown",
  "channel_close_candidate",
]);

const CLOSE_SIGNALS: ReadonlySet<DetectorId> = new Set<DetectorId>([
  "ap11_close_storm",
  "fleet_close_cluster",
  "htlc_timeout_fc",
]);

/**
 * Classify a card to its backing series. Fleet-target cards (node === null) have
 * no single pubkey to read a per-node series for, so they always map to null
 * (honest fallback) — checked first.
 */
export function seriesKindFor(card: InsightCard): SeriesKind {
  if (card.node === null) return null; // fleet target → no single pubkey
  if (FEE_REVENUE_SIGNALS.has(card.signal)) return "forwards-fees";
  if (CLOSE_SIGNALS.has(card.signal)) return "closes";
  return null;
}
