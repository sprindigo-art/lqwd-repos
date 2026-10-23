import { sql, type SQL } from "drizzle-orm";
import type { DimensionResult } from "@/lib/scorecard/types";

// =====================================================
// Routing dimension — 7d forwards count + volume per node (fleet-wide)
// =====================================================
// Source: `lnd_node_forwards` (EVENT log, one row per forward; identity column
// lnd_pubkey). Time column is `timestamp_ns` — NANOSECONDS since epoch (BIGINT).
// RESEARCH Pitfall 3: window math MUST multiply by 1e9; a window built in
// seconds/ms silently selects nothing or everything. The *1e9 factor stays in
// the SQL text (the verified working idiom); only windowDays is a bound param.
//
// AFM-002: volume is SUM(amt_out_msat)/1000.0 = sats. Raw sats stay raw — the
// formatter applies at render only. Never reference the raw `fee` column.
//
// One fleet-wide GROUP BY query (not 26×): feeds both the overview and the
// per-node scorecard, and the cohort medians (D-10/D-11) need the whole fleet.
// Dimension functions return { raw, asOf, extras } only — no grades, no
// thresholds (D-02 separation).

/** Row shape produced by buildRoutingAllSql. */
interface RoutingRow {
  lnd_pubkey: string;
  forwards: string | number;
  volume_sat: string | number | null;
  max_ts_ns: string | number;
}

/**
 * Fleet-wide 7d (default) routing aggregate. Exposed separately so the no-DB
 * shape test can assert the emitted SQL without a live warehouse connection.
 * `windowDays` is number-typed and parameter-bound ($1) — never interpolated.
 */
export function buildRoutingAllSql(windowDays: number = 7): SQL {
  // NOTE on MAX(timestamp_ns): this is a legitimate per-group as-of aggregate
  // (the newest forward we counted), NOT the AFM-001 `WHERE timestamp = MAX(...)`
  // latest-state anti-pattern — no row selection depends on it.
  return sql`
    SELECT
      lnd_pubkey,
      COUNT(*) AS forwards,
      SUM(amt_out_msat) / 1000.0 AS volume_sat,
      MAX(timestamp_ns) AS max_ts_ns
    FROM lnd_node_forwards
    WHERE lnd_pubkey IS NOT NULL
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${windowDays} * 86400) * 1e9
    GROUP BY lnd_pubkey
  `;
}

/**
 * Routing DimensionResult for every node with ≥1 forward in the window.
 * raw = forwards count; extras.volumeSat = outbound volume in RAW sats.
 * Nodes absent from the Map had zero forwards in the window.
 */
export async function routingForFleet(
  windowDays: number = 7,
): Promise<Map<string, DimensionResult>> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildRoutingAllSql(windowDays));
  const rows = result as unknown as RoutingRow[];
  const map = new Map<string, DimensionResult>();
  for (const row of rows) {
    map.set(row.lnd_pubkey, {
      raw: Number(row.forwards),
      // timestamp_ns is ns since epoch; Date wants ms → /1e6.
      asOf: new Date(Number(row.max_ts_ns) / 1e6),
      extras: { volumeSat: Number(row.volume_sat ?? 0) },
    });
  }
  return map;
}
