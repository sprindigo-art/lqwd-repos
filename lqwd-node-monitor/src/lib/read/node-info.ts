import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// AFM-001 — the ONLY sanctioned latest-node-info read
// =====================================================
// `lnd_node_info` is APPEND-ONLY (verified 8.05M rows / 26 nodes; Canada alone
// 371,545 rows). The latest state of each node is its newest row PER pubkey.
//
//   ✅  SELECT DISTINCT ON (pubkey) ... ORDER BY pubkey, timestamp DESC
//   ❌  SELECT ... WHERE pubkey = $x                ← returns ~371k rows, NOT 1
//   ❌  WHERE timestamp = (SELECT greatest-timestamp ...)  ← AFM-001 failure
//
// This module is the single centralized path so the bare-select landmine
// (RESEARCH Pitfall 1, the highest-risk failure of Phase 2) cannot reappear in
// a consumer. D-13 freshness consumers also read the returned `timestamp` as
// the per-node lnd_node_info staleness floor. `pubkey` is ALWAYS parameter-
// bound (Drizzle `sql` template), never string-concatenated (SQL-injection
// mitigation, T-02-01).

/** Latest-per-node row shape returned by both helpers. */
export interface LatestNodeInfoRow {
  pubkey: string;
  alias: string | null;
  active_channels: number | null;
  inactive_channels: number | null;
  pending_channels: number | null;
  num_peers: number | null;
  local_channel_balance: bigint | number | null;
  remote_channel_balance: bigint | number | null;
  timestamp: Date | null;
}

// PERF-01 recency bound. `lnd_node_info` is 8.1M rows with its ONLY index on
// the pkey(id): the unbounded DISTINCT ON (pubkey) is a parallel seq-scan +
// external merge sort (~6.5s measured). Bounding to the last 30 days turns it
// into a ~0.8s read returning exactly the nodes alive in the window. The window
// is tied to STALENESS_CUTOFF_DAYS (freshness-cutoff.ts): any node with NO row
// in 30 days is already ELIMINATED from the overview/vitals, so dropping it from
// the fleet snapshot changes nothing THERE — the one exception (a >30d-stale
// node's /[pubkey] detail page + modal) is preserved by the single-node
// latestNodeInfo fallback wired in the pages (NO 404 regression, PERF-01).
// Kept in sync with STALENESS_CUTOFF_DAYS = 30 by value (this module stays free
// of the pure freshness-cutoff import to keep the no-DB shape test's graph tiny).
const NODE_INFO_WINDOW_DAYS = 30;

/**
 * Build the AFM-001 DISTINCT ON (pubkey) latest-per-node fragment for the whole
 * fleet, bounded to the last NODE_INFO_WINDOW_DAYS (PERF-01). Exposed separately
 * so the no-DB shape test can assert the emitted SQL without a live warehouse
 * connection.
 */
export function buildLatestNodeInfoAllSql(): SQL {
  // `pubkey IS NOT NULL` is REQUIRED: DISTINCT ON (pubkey) collapses every
  // NULL-key row into ONE output row — the AFM-001 "N-read-as-1" failure moved
  // from the timestamp dimension to the key dimension. Excluding NULL keys
  // keeps each real node distinct even if the warehouse emits keyless rows (WR-01).
  // The `AT TIME ZONE 'UTC'` + make_interval idiom matches buildFeeHistorySql
  // (fee-history.ts) and the WR-04 timezone posture. The DISTINCT ON shape is
  // UNCHANGED — this only ADDS a recency predicate (never the MAX-timestamp form).
  return sql`
    SELECT DISTINCT ON (pubkey)
      pubkey, alias, active_channels, inactive_channels, pending_channels,
      num_peers, local_channel_balance, remote_channel_balance, timestamp
    FROM lnd_node_info
    WHERE pubkey IS NOT NULL
      AND timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => ${NODE_INFO_WINDOW_DAYS})
    ORDER BY pubkey, timestamp DESC
  `;
}

/**
 * Build the latest-row fragment for a single node. Same column list as the
 * fleet builder; the single-key case needs only ORDER BY timestamp DESC LIMIT 1.
 * `pubkey` is bound, not interpolated.
 */
export function buildLatestNodeInfoSql(pubkey: string): SQL {
  return sql`
    SELECT
      pubkey, alias, active_channels, inactive_channels, pending_channels,
      num_peers, local_channel_balance, remote_channel_balance, timestamp
    FROM lnd_node_info
    WHERE pubkey = ${pubkey}
    ORDER BY timestamp DESC
    LIMIT 1
  `;
}

/**
 * Driver-boundary coercion: drizzle's postgres-js adapter OVERRIDES the
 * driver's timestamp parsers, so raw `.execute()` surfaces `timestamp` as an
 * ISO STRING (drizzle only maps types in schema-typed queries — verified live
 * in the D-14 golden run). Coerce here so the declared `Date | null` contract
 * holds for every consumer (freshness floor, channel-health/peer asOf).
 * The column is `timestamp WITHOUT time zone` storing UTC wall time, so the
 * string is OFFSET-LESS — parseDbTimestampUtc pins the UTC interpretation
 * (WR-01: host-local parse skewed the D-13 stale flag by the host's offset).
 */
function coerceTimestamp(row: LatestNodeInfoRow): LatestNodeInfoRow {
  const ts = row.timestamp as Date | string | null;
  if (ts == null || ts instanceof Date) return row;
  return { ...row, timestamp: parseDbTimestampUtc(ts) };
}

/**
 * Latest lnd_node_info row for every node — the only sanctioned fleet-wide
 * read of this APPEND-ONLY table (AFM-001 / RESEARCH Pitfall 1).
 */
export async function latestNodeInfoAll(): Promise<LatestNodeInfoRow[]> {
  // Lazy import keeps the server-only `dbRouting` client (which constructs a
  // postgres() pool + requires env at module load) out of the no-DB shape
  // test's import graph. Importing this module for the builders alone must
  // NOT spin up a warehouse connection.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildLatestNodeInfoAllSql());
  // postgres-js returns the rows array directly; drizzle .execute surfaces it as-is.
  return (result as unknown as LatestNodeInfoRow[]).map(coerceTimestamp);
}

/**
 * Latest lnd_node_info row for one node, or null if the pubkey is unknown.
 */
export async function latestNodeInfo(pubkey: string): Promise<LatestNodeInfoRow | null> {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildLatestNodeInfoSql(pubkey));
  const rows = result as unknown as LatestNodeInfoRow[];
  return rows[0] ? coerceTimestamp(rows[0]) : null;
}
