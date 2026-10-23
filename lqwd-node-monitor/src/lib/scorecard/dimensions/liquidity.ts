import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import type { DimensionResult } from "@/lib/scorecard/types";

// =====================================================
// Liquidity dimension — outbound ratio over LATEST channel state (fleet-wide)
// =====================================================
// Source: `lnd_node_channel_info` — EVENT-DRIVEN (AFM-001). Latest channel
// state ONLY via DISTINCT ON, NEVER `WHERE timestamp = MAX(...)` (the
// documented 480-channels-as-1 failure). The table is partitioned per node by
// local_pubkey, and an INTRA-FLEET channel (node A ↔ node B) shares ONE
// chan_id across TWO partition rows (each side carries its own
// local_balance). The single-node idiom in src/lib/read/latest.ts may key on
// chan_id alone because it first filters WHERE local_pubkey = $x; this
// FLEET-WIDE builder must key on (local_pubkey, chan_id) — CR-01: a bare
// DISTINCT ON (chan_id) across all partitions keeps only one node's
// perspective of an intra-fleet channel and silently drops the other side
// from its liquidity sums. The WR-01 NULL-key guard still applies: DISTINCT
// ON collapses every NULL-key row into ONE output row, so chan_id IS NOT NULL
// (and local_pubkey IS NOT NULL) are REQUIRED to keep real channels distinct.
//
// AFM-002: balances stay RAW sats (no /1e8, no BTC conversion) — the formatter
// applies at render only. Dimension functions return { raw, asOf, extras }
// only — no grades, no thresholds (D-02 separation).
//
// Extras also surface the 7d rebalance success rate from
// `internal_rebalance_invoices` (per-node identity: requesting_node_pubkey;
// verified read: COUNT FILTER (paid_status) / NULLIF(COUNT(*),0) — Canada 7d
// 37/143 ≈ 26%).

/** Row shape produced by buildLiquidityAllSql. */
interface LiquidityRow {
  local_pubkey: string;
  local_sat: string | number | null;
  remote_sat: string | number | null;
  capacity_sat: string | number | null;
  outbound_ratio: string | number | null;
  as_of: Date | string | null;
}

/** Row shape produced by buildRebalanceSuccessAllSql. */
interface RebalanceRow {
  requesting_node_pubkey: string;
  success_rate: string | number | null;
}

/**
 * Fleet-wide latest-state liquidity aggregate: AFM-001 DISTINCT ON
 * (local_pubkey, chan_id) subquery (per-node partition key — CR-01), then
 * per-node sums over ACTIVE, non-closed channels. Exposed separately so the
 * no-DB shape test can assert the emitted SQL without a live warehouse
 * connection. NULLIF guards the zero-capacity denominator.
 */
export function buildLiquidityAllSql(): SQL {
  // NOTE on MAX(timestamp): legitimate per-group as-of aggregate over rows
  // ALREADY selected by DISTINCT ON — not the AFM-001 row-selection
  // anti-pattern (`WHERE timestamp = MAX(...)`).
  return sql`
    SELECT
      local_pubkey,
      SUM(local_balance) AS local_sat,
      SUM(remote_balance) AS remote_sat,
      SUM(capacity) AS capacity_sat,
      SUM(local_balance)::float / NULLIF(SUM(capacity), 0) AS outbound_ratio,
      MAX(timestamp) AS as_of
    FROM (
      SELECT DISTINCT ON (local_pubkey, chan_id) *
      FROM lnd_node_channel_info
      WHERE chan_id IS NOT NULL
        AND local_pubkey IS NOT NULL
      ORDER BY local_pubkey, chan_id, timestamp DESC
    ) latest
    WHERE active AND NOT closed
    GROUP BY local_pubkey
  `;
}

/**
 * Fleet-wide 7d (default) rebalance success rate per node over
 * `internal_rebalance_invoices` (one row per rebalance invoice; per-node
 * identity column requesting_node_pubkey, time column timestamp — a real
 * timestamptz, NOT nanoseconds). `windowDays` is number-typed and
 * parameter-bound, never interpolated.
 */
export function buildRebalanceSuccessAllSql(windowDays: number = 7): SQL {
  return sql`
    SELECT
      requesting_node_pubkey,
      COUNT(*) FILTER (WHERE paid_status)::float / NULLIF(COUNT(*), 0) AS success_rate
    FROM internal_rebalance_invoices
    WHERE requesting_node_pubkey IS NOT NULL
      AND timestamp > now() - ${windowDays} * interval '1 day'
    GROUP BY requesting_node_pubkey
  `;
}

/**
 * Liquidity DimensionResult for every node with ≥1 active channel in the
 * latest state. raw = outbound ratio 0..1 (null when capacity sums to 0);
 * extras carry RAW sats (localSat/remoteSat/capacitySat) plus
 * rebalanceSuccessRate when the node issued rebalance invoices in the window.
 */
export async function liquidityForFleet(): Promise<Map<string, DimensionResult>> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const [liquidityResult, rebalanceResult] = await Promise.all([
    dbRouting.execute(buildLiquidityAllSql()),
    dbRouting.execute(buildRebalanceSuccessAllSql()),
  ]);
  const liquidityRows = liquidityResult as unknown as LiquidityRow[];
  const rebalanceRows = rebalanceResult as unknown as RebalanceRow[];

  const rebalanceByPubkey = new Map<string, number>();
  for (const row of rebalanceRows) {
    if (row.success_rate !== null) {
      rebalanceByPubkey.set(row.requesting_node_pubkey, Number(row.success_rate));
    }
  }

  const map = new Map<string, DimensionResult>();
  for (const row of liquidityRows) {
    const extras: Record<string, number> = {
      localSat: Number(row.local_sat ?? 0),
      remoteSat: Number(row.remote_sat ?? 0),
      capacitySat: Number(row.capacity_sat ?? 0),
    };
    const rebalanceSuccessRate = rebalanceByPubkey.get(row.local_pubkey);
    if (rebalanceSuccessRate !== undefined) {
      extras.rebalanceSuccessRate = rebalanceSuccessRate;
    }
    map.set(row.local_pubkey, {
      raw: row.outbound_ratio === null ? null : Number(row.outbound_ratio),
      // WR-01: raw .execute surfaces MAX(timestamp) as an OFFSET-LESS string
      // (UTC wall time in a `timestamp without time zone` column) — parse as
      // UTC, never host-local.
      asOf: parseDbTimestampUtc(row.as_of),
      extras,
    });
  }
  return map;
}
