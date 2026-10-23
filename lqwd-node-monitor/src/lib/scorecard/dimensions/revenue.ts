import { sql, type SQL } from "drizzle-orm";
import type { DimensionResult } from "@/lib/scorecard/types";

// =====================================================
// Revenue dimension — 24h fee-PPM (graded raw) + 7d earnings sats (extras)
// =====================================================
// Source: `lnd_node_forwards` (EVENT log; identity column lnd_pubkey). Time
// column is `timestamp_ns` — NANOSECONDS since epoch (RESEARCH Pitfall 3:
// window math MUST multiply by 1e9; the *1e9 factor stays in the SQL text).
//
// AFM-002 HARD RULE: earnings are SUM(fee_msat)/1000.0 = sats. NEVER reference
// the raw `fee` column (the documented 1000x-off failure). PPM uses fee_msat
// over amt_in_msat — both msat, so the ratio is unit-clean; *1e6 yields PPM.
//
// One fleet-wide query produces BOTH windows via FILTER (7d earnings + 24h PPM)
// — not 26× queries, and not two passes. Dimension functions return
// { raw, asOf, extras } only — no grades, no thresholds (D-02 separation).

const SECONDS_PER_DAY = 86400;

/** Row shape produced by buildRevenueAllSql. */
interface RevenueRow {
  lnd_pubkey: string;
  earnings_7d_sat: string | number | null;
  ppm_24h: string | number | null;
  max_ts_ns: string | number;
}

/**
 * Fleet-wide revenue aggregate: 7d earnings (sats) + 24h fee-PPM per node.
 * Exposed separately so the no-DB shape test can assert the emitted SQL
 * without a live warehouse connection. NULLIF guards the PPM denominator —
 * a node with zero 24h inbound flow yields SQL NULL, not a divide-by-zero.
 */
export function buildRevenueAllSql(): SQL {
  // NOTE on MAX(timestamp_ns): legitimate per-group as-of aggregate, NOT the
  // AFM-001 `WHERE timestamp = MAX(...)` latest-state anti-pattern.
  return sql`
    SELECT
      lnd_pubkey,
      SUM(fee_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - 7 * ${SECONDS_PER_DAY}) * 1e9
      ) / 1000.0 AS earnings_7d_sat,
      SUM(fee_msat) FILTER (
        WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${SECONDS_PER_DAY}) * 1e9
      )::float / NULLIF(
        SUM(amt_in_msat) FILTER (
          WHERE timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${SECONDS_PER_DAY}) * 1e9
        ), 0
      ) * 1e6 AS ppm_24h,
      MAX(timestamp_ns) AS max_ts_ns
    FROM lnd_node_forwards
    WHERE lnd_pubkey IS NOT NULL
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - 7 * ${SECONDS_PER_DAY}) * 1e9
    GROUP BY lnd_pubkey
  `;
}

/**
 * Revenue DimensionResult for every node with ≥1 forward in the last 7d.
 * raw = 24h fee-PPM — stays null (NOT coerced to 0) when the node had zero 24h
 * inbound flow (NULLIF gives SQL NULL): "no flow" is no-data, not "0 PPM", so
 * the fee-crash Tier-1 cannot fire on a routing stall (see config.ts).
 * extras.earnings7dSat = 7d fee earnings in RAW sats.
 */
export async function revenueForFleet(): Promise<Map<string, DimensionResult>> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildRevenueAllSql());
  const rows = result as unknown as RevenueRow[];
  const map = new Map<string, DimensionResult>();
  for (const row of rows) {
    map.set(row.lnd_pubkey, {
      raw: row.ppm_24h === null ? null : Number(row.ppm_24h),
      // timestamp_ns is ns since epoch; Date wants ms → /1e6.
      asOf: new Date(Number(row.max_ts_ns) / 1e6),
      extras: { earnings7dSat: Number(row.earnings_7d_sat ?? 0) },
    });
  }
  return map;
}
