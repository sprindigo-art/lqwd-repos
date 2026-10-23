import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { buildDeepLink } from "@/lib/insight/deeplink";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { CARD_SCHEMA_VERSION, type InsightCard, type SuggestedAction } from "@/lib/insight/types";

// buildDeepLink throws on a non-`^[0-9a-f]{66}$` pubkey; assembleCards is not
// degrade()-wrapped, so one malformed requesting_node_pubkey would reject the
// whole insight view (review I2). Pre-check and skip that node — fail-soft.
const PUBKEY_RE = /^[0-9a-f]{66}$/;

// =====================================================
// Rebalance-success detector (INSIGHT-02 detector 6)
// =====================================================
// Source: `internal_rebalance_invoices` — ONE ROW PER REBALANCE INVOICE.
// Identity column (per-node partition): requesting_node_pubkey (Pitfall 6 —
// NOT local_pubkey / lnd_pubkey). No DISTINCT ON: plain per-(node, partner)
// GROUP BY aggregation over the bound rolling window. Success-rate idiom is
// the live-verified `COUNT(*) FILTER (WHERE paid_status) / NULLIF(COUNT(*),0)`
// (Canada 7d reference: 37 paid / 143 total ~= 26%).
//
// Two signals (cross-node-monitoring-matrix.md Tier-2 + healthy-range-bands.md):
//  (a) Partner-binary failure — per (node, partner): 0% success with at least
//      `rebalanceBinaryMinAttempts` 7d attempts → warn, `investigate` (state
//      remediation OR closing is a human call — never an automatic rebalance).
//      The SQL `HAVING COUNT(*) >= rebalancePartnerMinAttempts` floor only
//      bounds the scan; the 20-attempt knob is the firing line.
//  (b) Node-level degradation — 7d success rate < `rebalanceSuccessWarnRate`
//      with >= `rebalanceMinAttempts` attempts → info (chronic fleet-wide
//      condition; warn would page on every node today).
//
// `rebalance` suggestedAction is emitted ONLY when a viable partner exists
// (success > 0 in window) AND the caller supplies a nonzero liquidity
// imbalance; amountSat is capped by `rebalanceMaxAmountSat` (T-04-15).
// Both source tables are LND-internal — node.backend is "lnd" by source.

/** Window the builder and the evidence string share — keep in lockstep. */
export const REBALANCE_WINDOW_DAYS = 7;

/**
 * Fleet-wide per-(node, partner) rebalance aggregate over the rolling window.
 * Both the window and the HAVING floor are NUMBER-typed bound params (T-04-13)
 * — never interpolated. The floor reads the D-13 knob; it is not restated here.
 */
export function buildRebalanceSql(
  windowDays = REBALANCE_WINDOW_DAYS,
  partnerMinAttempts = INSIGHT_CONFIG.lnd.rebalancePartnerMinAttempts,
): SQL {
  return sql`
    SELECT
      requesting_node_pubkey,
      MAX(requesting_node_alias) AS requesting_node_alias,
      remote_pubkey,
      MAX(remote_alias) AS remote_alias,
      COUNT(*) AS attempts,
      COUNT(*) FILTER (WHERE paid_status) AS paid,
      COUNT(*) FILTER (WHERE paid_status)::float / NULLIF(COUNT(*), 0) AS success_rate,
      MAX(timestamp) AS as_of
    FROM internal_rebalance_invoices
    WHERE requesting_node_pubkey IS NOT NULL
      AND timestamp > now() - make_interval(days => ${windowDays})
    GROUP BY requesting_node_pubkey, remote_pubkey
    HAVING COUNT(*) >= ${partnerMinAttempts}
  `;
}

/** Raw row shape surfaced by drizzle .execute for the builder above. */
export interface RebalanceAggRow {
  requesting_node_pubkey: string;
  requesting_node_alias: string | null;
  remote_pubkey: string | null;
  remote_alias: string | null;
  attempts: number | string | bigint;
  paid: number | string | bigint;
  success_rate: number | string | null;
  // STRING at runtime: drizzle's postgres-js adapter surfaces MAX(timestamp)
  // as an ISO string from raw .execute — coerce via parseDbTimestampUtc.
  as_of: Date | string | null;
}

interface PartnerAgg {
  partnerPubkey: string | null;
  // EXPORT-01 context echo: remote_alias straight from the aggregate row —
  // ZERO new SQL. null when the warehouse row carried no alias (unknown ≠ fake).
  partnerAlias: string | null;
  attempts: number;
  paid: number;
  asOf: Date | null;
}

const EPOCH_ISO = new Date(0).toISOString();

function isoOf(asOf: Date | null): string {
  return asOf?.toISOString() ?? EPOCH_ISO;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (a == null) return b;
  if (b == null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Pure detection over coerced aggregate rows (fixture-testable, no DB).
 *
 * `liquidityImbalanceByPubkey` values are signed `localSat - remoteSat` sats
 * supplied by the engine from the fleet liquidity dimension extras: positive
 * (excess local) sizes an "out" rebalance, negative an "in".
 */
export function detectRebalance(
  rows: RebalanceAggRow[],
  config: InsightKnobs,
  liquidityImbalanceByPubkey?: Map<string, number>,
): InsightCard[] {
  const cards: InsightCard[] = [];

  // Coerce once at the mapping layer, then group per node.
  const byNode = new Map<string, { alias: string | null; partners: PartnerAgg[] }>();
  for (const row of rows) {
    const pubkey = row.requesting_node_pubkey;
    let node = byNode.get(pubkey);
    if (!node) {
      node = { alias: row.requesting_node_alias, partners: [] };
      byNode.set(pubkey, node);
    }
    if (node.alias == null && row.requesting_node_alias != null) {
      node.alias = row.requesting_node_alias;
    }
    node.partners.push({
      partnerPubkey: row.remote_pubkey,
      partnerAlias: row.remote_alias,
      attempts: Number(row.attempts),
      paid: Number(row.paid),
      asOf: parseDbTimestampUtc(row.as_of),
    });
  }

  for (const [pubkey, node] of byNode) {
    // I2 fail-soft: skip a node whose pubkey can't build a deep link.
    if (!PUBKEY_RE.test(pubkey)) continue;
    const deepLink = buildDeepLink(pubkey, "liquidity");
    const nodeMeta = { pubkey, alias: node.alias, backend: "lnd" as const };

    // (a) Partner-binary failure — warn, investigate.
    for (const partner of node.partners) {
      if (partner.partnerPubkey == null) continue; // unattributable partner — node aggregate only
      if (partner.paid !== 0 || partner.attempts < config.rebalanceBinaryMinAttempts) continue;
      // EXPORT-01: echo the partner alias when the row supplied one (conditional
      // add — unknown ≠ fake; aliases ride the open detail record, no schema bump).
      const detail: Record<string, string | number> = {
        attempts: partner.attempts,
        paid: 0,
        partnerPubkey: partner.partnerPubkey,
      };
      if (partner.partnerAlias != null) detail.partnerAlias = partner.partnerAlias;
      cards.push({
        schemaVersion: CARD_SCHEMA_VERSION,
        id: `rebalance_partner_failure:${pubkey}:${partner.partnerPubkey}`,
        severity: "warn",
        node: nodeMeta,
        target: {
          kind: "channel",
          chanId: null,
          channelPoint: null,
          remotePubkey: partner.partnerPubkey,
        },
        signal: "rebalance_partner_failure",
        evidence: {
          metric: "partnerSuccessRate",
          observed: 0,
          threshold: 0, // the binary line IS 0% success
          unit: "ratio",
          window: `${REBALANCE_WINDOW_DAYS}d`,
          asOf: isoOf(partner.asOf),
          deepLink,
          detail,
        },
        suggestedAction: { type: "investigate", params: {} },
        suppressed: { active: false, reason: null },
        provenance: "deterministic",
        rateLimitGuidance: null,
      });
    }

    // (b) Node-level success-rate degradation — info.
    const attempts = node.partners.reduce((sum, p) => sum + p.attempts, 0);
    const paid = node.partners.reduce((sum, p) => sum + p.paid, 0);
    const asOf = node.partners.reduce<Date | null>((acc, p) => maxDate(acc, p.asOf), null);
    if (attempts < config.rebalanceMinAttempts) continue;
    const rate = paid / attempts;
    if (rate >= config.rebalanceSuccessWarnRate) continue;

    const { action, bestPartner } = rebalanceActionFor(
      node.partners,
      config,
      liquidityImbalanceByPubkey?.get(pubkey),
    );
    // EXPORT-01: echo the SELECTED partner's alias (same partner the action
    // names) when both an action was chosen and that partner carried an alias —
    // conditional add, no re-derivation, no schema bump.
    const detail: Record<string, string | number> = { attempts, paid };
    if (bestPartner?.partnerAlias != null) detail.partnerAlias = bestPartner.partnerAlias;

    cards.push({
      schemaVersion: CARD_SCHEMA_VERSION,
      id: `rebalance_degraded:${pubkey}:node`,
      severity: "info",
      node: nodeMeta,
      target: { kind: "node" },
      signal: "rebalance_degraded",
      evidence: {
        metric: "rebalanceSuccessRate",
        observed: rate,
        threshold: config.rebalanceSuccessWarnRate,
        unit: "ratio",
        window: `${REBALANCE_WINDOW_DAYS}d`,
        asOf: isoOf(asOf),
        deepLink,
        detail,
      },
      suggestedAction: action,
      suppressed: { active: false, reason: null },
      provenance: "deterministic",
      rateLimitGuidance: null,
    });
  }

  return cards;
}

/**
 * Conditional `rebalance` action — only when a viable partner exists (success
 * > 0 in window) AND a nonzero liquidity imbalance was supplied; otherwise
 * `investigate`. Sizing rule [ASSUMED A5]: half the absolute imbalance, capped
 * at `rebalanceMaxAmountSat` (Phase 6 re-enforces bounds node-side).
 *
 * Returns the chosen `bestPartner` alongside the action so the EXPORT-01
 * partnerAlias echo on the degraded card matches the SAME partner the action
 * selected — never re-derived with a second sort (which could drift on ties).
 */
function rebalanceActionFor(
  partners: PartnerAgg[],
  config: InsightKnobs,
  imbalanceSat: number | undefined,
): { action: SuggestedAction; bestPartner: PartnerAgg | null } {
  const investigate = { action: { type: "investigate", params: {} } as SuggestedAction, bestPartner: null };
  if (imbalanceSat === undefined || !Number.isFinite(imbalanceSat) || imbalanceSat === 0) {
    return investigate;
  }
  const viable = partners.filter(
    (p): p is PartnerAgg & { partnerPubkey: string } => p.partnerPubkey != null && p.paid > 0,
  );
  if (viable.length === 0) return investigate;

  const amountSat = Math.min(
    Math.floor(Math.abs(imbalanceSat) / 2),
    config.rebalanceMaxAmountSat,
  );
  if (amountSat <= 0) return investigate;

  // Best viable partner: highest success rate, ties by attempts desc, then
  // pubkey lexicographic — deterministic for any input permutation.
  const best = [...viable].sort((a, b) => {
    const byRate = b.paid / b.attempts - a.paid / a.attempts;
    if (byRate !== 0) return byRate;
    if (a.attempts !== b.attempts) return b.attempts - a.attempts;
    return a.partnerPubkey < b.partnerPubkey ? -1 : 1;
  })[0];

  return {
    action: {
      type: "rebalance",
      params: {
        partnerPubkey: best.partnerPubkey,
        amountSat,
        direction: imbalanceSat > 0 ? "out" : "in",
      },
    },
    bestPartner: best,
  };
}
