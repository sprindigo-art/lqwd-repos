import { sql, type SQL } from "drizzle-orm";
import { feeMsatToSat } from "@/lib/format/units";
import { buildDeepLink } from "@/lib/insight/deeplink";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { SCORECARD_CONFIG } from "@/lib/scorecard/config";
import { CARD_SCHEMA_VERSION, type InsightCard } from "@/lib/insight/types";

// buildDeepLink throws on a non-`^[0-9a-f]{66}$` pubkey; assembleCards is not
// degrade()-wrapped, so one malformed lnd_pubkey would reject the whole insight
// view (review I2). Pre-check and skip that node's card — fail-soft.
const PUBKEY_RE = /^[0-9a-f]{66}$/;

// =====================================================
// Detector 7 — fee-crash / earnings step-down (D-09, INSIGHT-04)
// =====================================================
// Source: `lnd_node_forwards` (EVENT log; identity column lnd_pubkey —
// Pitfall 6). Time column `timestamp_ns` is NANOSECONDS — every window bound
// is `(EXTRACT(EPOCH FROM now()) - N::int * 86400::int) * 1e9` (Pitfall 2:
// the baseline needs BOTH bounds in this form; ::int casts prevent the 42725
// "operator is not unique" failure found live in 03-07).
//
// Three Tier-1 rules (cross-node-monitoring-matrix.md, France-derived), any
// one fires a CRITICAL card:
//   1. PPM-LOW       — 24h PPM below the scorecard revenue tier-1 band. The
//                      threshold is READ from SCORECARD_CONFIG[backend]
//                      .revenue.tier1.value at the use-site (D-13 — never
//                      restated here; config.test.ts enforces no fork). The
//                      24h sub-window is its own FILTER in the same single
//                      query so this rule matches the matrix exactly.
//   2. PPM-DRIFT     — ppm7d < ppmDriftRatio × ppmBaseline.
//   3. EARNINGS-DROP — earnings7dSat < earningsDropRatio × weekly baseline.
//
// Baseline = trailing 28 days ENDING 7 days ago (now-35d … now-7d), aggregated
// as ONE window — absorbs France's healthy week-to-week PPM variance.
//
// AFM-002: fee math is SUM(fee_msat); msat→sat only via feeMsatToSat. PPM is
// fee_msat over amt_in_msat (both msat — unit-clean ratio) × 1e6.
//
// Null-PPM discipline (Pitfall 4): zero flow → NULL ppm, never 0. A node with
// no current-7d flow is a routing stall (staleness/peer domain), NOT a fee
// crash — it emits no card here. Noise floors: the baseline needs at least
// baselineForwardsMin forwards AND ppmBaselineMin PPM — a near-idle or
// already-crashed node has no baseline to step down from.
//
// Suggested action: investigate — NEVER update_fee (T-04-11). The France
// post-mortem is explicit that restoring fees before fixing the underlying
// instability re-crashes the config; evidence.detail carries the restoration
// target (ppmBaseline) but no write param. Golden-validated against the
// France routing-pnl.md weekly series in fee-stepdown.test.ts.

const SECONDS_PER_DAY = 86400;
const CURRENT_WINDOW_DAYS = 7;
const DAY_WINDOW_DAYS = 1;
const BASELINE_START_DAYS = 35; // baseline lower bound: now-35d
// Baseline upper bound is now-7d (same value as the current window start).

/**
 * Fleet-wide step-down aggregates: one pass over lnd_node_forwards with three
 * FILTER windows (24h, 7d, baseline now-35d…now-7d) per lnd_pubkey. The outer
 * predicate bounds the scan at the baseline start (no unbounded scan).
 */
export function buildStepdownSql(): SQL {
  return sql`
    SELECT
      lnd_pubkey,
      SUM(fee_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${CURRENT_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ) AS fees_7d_msat,
      SUM(amt_in_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${CURRENT_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ) AS amt_in_7d_msat,
      (COUNT(*) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${CURRENT_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ))::int AS forwards_7d,
      SUM(fee_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${DAY_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ) AS fees_24h_msat,
      SUM(amt_in_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${DAY_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ) AS amt_in_24h_msat,
      SUM(fee_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${BASELINE_START_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
          AND timestamp_ns <= (EXTRACT(EPOCH FROM now()) - ${CURRENT_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ) AS fees_baseline_msat,
      SUM(amt_in_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${BASELINE_START_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
          AND timestamp_ns <= (EXTRACT(EPOCH FROM now()) - ${CURRENT_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ) AS amt_in_baseline_msat,
      (COUNT(*) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${BASELINE_START_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
          AND timestamp_ns <= (EXTRACT(EPOCH FROM now()) - ${CURRENT_WINDOW_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
      ))::int AS forwards_baseline,
      MAX(timestamp_ns) AS max_ts_ns
    FROM lnd_node_forwards
    WHERE lnd_pubkey IS NOT NULL
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${BASELINE_START_DAYS}::int * ${SECONDS_PER_DAY}::int) * 1e9
    GROUP BY lnd_pubkey
  `;
}

/** Raw row as surfaced by raw .execute (numerics arrive as strings or numbers). */
interface StepdownRawRow {
  lnd_pubkey: string;
  fees_7d_msat: string | number | null;
  amt_in_7d_msat: string | number | null;
  forwards_7d: string | number | null;
  fees_24h_msat: string | number | null;
  amt_in_24h_msat: string | number | null;
  fees_baseline_msat: string | number | null;
  amt_in_baseline_msat: string | number | null;
  forwards_baseline: string | number | null;
  max_ts_ns: string | number | null;
}

/** Per-node msat aggregates (engine joins alias/backend → StepdownNodeRow). */
export interface StepdownAggregates {
  pubkey: string;
  fees7dMsat: number;
  amtIn7dMsat: number;
  forwards7d: number;
  fees24hMsat: number;
  amtIn24hMsat: number;
  feesBaselineMsat: number;
  amtInBaselineMsat: number;
  forwardsBaseline: number;
  asOf: Date | null;
}

/** Fleet-wide step-down aggregates (lazy DB import — shape tests stay no-DB). */
export async function stepdownForFleet(): Promise<StepdownAggregates[]> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildStepdownSql());
  const rows = result as unknown as StepdownRawRow[];
  return rows.map((row) => ({
    pubkey: row.lnd_pubkey,
    fees7dMsat: Number(row.fees_7d_msat ?? 0),
    amtIn7dMsat: Number(row.amt_in_7d_msat ?? 0),
    forwards7d: Number(row.forwards_7d ?? 0),
    fees24hMsat: Number(row.fees_24h_msat ?? 0),
    amtIn24hMsat: Number(row.amt_in_24h_msat ?? 0),
    feesBaselineMsat: Number(row.fees_baseline_msat ?? 0),
    amtInBaselineMsat: Number(row.amt_in_baseline_msat ?? 0),
    forwardsBaseline: Number(row.forwards_baseline ?? 0),
    // timestamp_ns is ns since epoch; Date wants ms → /1e6 (revenue.ts precedent).
    asOf: row.max_ts_ns == null ? null : new Date(Number(row.max_ts_ns) / 1e6),
  }));
}

/** Node identity attached to each card (engine resolves alias/backend). */
export type CardNode = NonNullable<InsightCard["node"]>;

/** Pure-detector input: one node's aggregates plus identity. */
export interface StepdownNodeRow {
  node: CardNode;
  fees7dMsat: number;
  amtIn7dMsat: number;
  forwards7d: number;
  fees24hMsat: number;
  amtIn24hMsat: number;
  feesBaselineMsat: number;
  amtInBaselineMsat: number;
  forwardsBaseline: number;
}

/** PPM = fee_msat / amt_in_msat × 1e6 — NULL on zero flow, never 0 (Pitfall 4). */
function ppmOf(feesMsat: number, amtInMsat: number): number | null {
  return amtInMsat > 0 ? (feesMsat / amtInMsat) * 1e6 : null;
}

interface RuleCandidate {
  metric: "ppm_24h_low" | "ppm_7d_vs_baseline" | "earnings_7d_vs_baseline";
  observed: number;
  threshold: number;
  unit: "ppm" | "ratio";
}

/**
 * Pure D-09 detector. One CRITICAL card per node max; the worst fired rule
 * (smallest observed/threshold ratio) provides the evidence headline; the
 * other derivations ride in evidence.detail. Fixture-drivable — no DB, no
 * env; `now` injectable for deterministic asOf.
 */
export function detectStepdown(
  rows: StepdownNodeRow[],
  config: Record<"lnd" | "ldk", InsightKnobs> = INSIGHT_CONFIG,
  now: Date = new Date(),
): InsightCard[] {
  const asOfIso = now.toISOString();
  const cards: InsightCard[] = [];

  for (const row of rows) {
    const knobs = config[row.node.backend];

    const ppm7d = ppmOf(row.fees7dMsat, row.amtIn7dMsat);
    const ppm24h = ppmOf(row.fees24hMsat, row.amtIn24hMsat);
    const ppmBaseline = ppmOf(row.feesBaselineMsat, row.amtInBaselineMsat);

    // Zero current flow → null PPM → routing-stall domain, not fee-crash.
    if (ppm7d === null) continue;
    // Noise floors: no meaningful baseline → nothing to step down from.
    if (row.forwardsBaseline < knobs.baselineForwardsMin) continue;
    if (ppmBaseline === null || ppmBaseline < knobs.ppmBaselineMin) continue;

    const earnings7dSat = feeMsatToSat(row.fees7dMsat);
    const baselineWeeklyEarningsSat = feeMsatToSat(row.feesBaselineMsat) / 4;

    const candidates: RuleCandidate[] = [];

    // Rule 1 — PPM-LOW: the scorecard revenue tier-1 band, READ at use-site
    // (D-13). This is the card counterpart of the existing "fee crash" chip.
    const tier1 = SCORECARD_CONFIG[row.node.backend].revenue.tier1;
    if (tier1 !== undefined && ppm24h !== null && ppm24h < tier1.value) {
      candidates.push({
        metric: "ppm_24h_low",
        observed: ppm24h,
        threshold: tier1.value,
        unit: "ppm",
      });
    }

    // Rule 2 — PPM-DRIFT: 7d PPM vs the 28d-ending-7d-ago baseline.
    const driftRatio = ppm7d / ppmBaseline;
    if (driftRatio < knobs.ppmDriftRatio) {
      candidates.push({
        metric: "ppm_7d_vs_baseline",
        observed: driftRatio,
        threshold: knobs.ppmDriftRatio,
        unit: "ratio",
      });
    }

    // Rule 3 — EARNINGS-DROP: catches volume-loss collapse at unchanged PPM.
    if (baselineWeeklyEarningsSat > 0) {
      const earningsRatio = earnings7dSat / baselineWeeklyEarningsSat;
      if (earningsRatio < knobs.earningsDropRatio) {
        candidates.push({
          metric: "earnings_7d_vs_baseline",
          observed: earningsRatio,
          threshold: knobs.earningsDropRatio,
          unit: "ratio",
        });
      }
    }

    if (candidates.length === 0) continue;
    // I2 fail-soft: skip a node whose pubkey can't build a deep link.
    if (!PUBKEY_RE.test(row.node.pubkey)) continue;

    // Worst rule wins: smallest observed/threshold (deepest under its line).
    const worst = candidates.reduce((a, b) =>
      b.observed / b.threshold < a.observed / a.threshold ? b : a,
    );

    cards.push({
      schemaVersion: CARD_SCHEMA_VERSION,
      // D-08 dedupe id: one node-scope card per node while the condition persists.
      id: `fee_stepdown:${row.node.pubkey}:node`,
      severity: "critical",
      node: row.node,
      target: { kind: "node" },
      signal: "fee_stepdown",
      evidence: {
        metric: worst.metric,
        observed: worst.observed,
        threshold: worst.threshold,
        unit: worst.unit,
        window: "7d vs 28d-prior",
        asOf: asOfIso,
        deepLink: buildDeepLink(row.node.pubkey, "forwards"),
        // detail carries the restoration target (ppmBaseline) — a human reads
        // it; it never becomes an update_fee param (France post-mortem).
        detail: {
          ppm7d,
          ppmBaseline,
          earnings7dSat,
          baselineWeeklyEarningsSat,
        },
      },
      // T-04-11: investigate, hard-coded — restoring fees before fixing the
      // underlying instability re-crashes the config.
      suggestedAction: { type: "investigate", params: {} },
      suppressed: { active: false, reason: null },
      provenance: "deterministic",
      rateLimitGuidance: null,
    });
  }

  return cards;
}
