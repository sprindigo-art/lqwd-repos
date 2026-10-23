import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import type { DimensionResult } from "@/lib/scorecard/types";

// =====================================================
// Force-close prevention dimension (D-01 #5) + AP-11 close-storm Tier-1 (D-08)
// =====================================================
// Source: `lnd_node_closed_channels` — ONE ROW PER CLOSE (verified 3,238 rows /
// 3,177 distinct chan_id for Canada — near 1:1). Aggregate BY ROW; no DISTINCT ON
// needed (this is NOT an event-duplicated table like lnd_node_channel_info).
//
// Three outputs per node:
//   raw                     = LOCAL_FORCE_CLOSE count in the rolling window (30d default)
//   extras.maxHourlySelfCloses = AP-11 storm input — max self-initiated closes in any
//                             1h bucket of the last 24h. This is THE Tier-1 metric for
//                             D-08's only HIGH-confidence red line (≥50/hr, see
//                             operational-anti-patterns.md AP-11). The extras key string
//                             MUST stay exactly "maxHourlySelfCloses" — it is referenced
//                             by SCORECARD_CONFIG.{lnd,ldk}.forceClose.tier1.metric; a
//                             mismatch silently disables the critical line (T-02-07).
//   extras.coopRemoteShare  = share of cooperative closes initiated by the REMOTE side
//                             (all-time) — omitted when the node has no coop closes.
//
// Window params are NUMBER-TYPED and parameter-bound via the Drizzle `sql`
// template (T-02-01); enum filters are fixed literals from the verified enum set
// (close_type: COOPERATIVE_CLOSE/LOCAL_FORCE_CLOSE/REMOTE_FORCE_CLOSE/ABANDONED/
// BREACH_CLOSE/FUNDING_CANCELED; close_initiator: INITIATOR_LOCAL/REMOTE/BOTH) —
// never user input.

/**
 * Fleet-wide force-close aggregate: windowed LOCAL force-close count, all-time
 * coop-REMOTE share, and latest close timestamp per node. One row per close —
 * plain GROUP BY aggregation, no DISTINCT ON (see banner). `windowDays` is bound.
 */
export function buildForceCloseAggSql(windowDays = 30): SQL {
  return sql`
    SELECT
      local_pubkey,
      COUNT(*) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE'
        AND timestamp > now() - make_interval(days => ${windowDays})) AS local_fc_window,
      COUNT(*) FILTER (WHERE close_type = 'COOPERATIVE_CLOSE'
        AND close_initiator = 'INITIATOR_REMOTE')::float
        / NULLIF(COUNT(*) FILTER (WHERE close_type = 'COOPERATIVE_CLOSE'), 0)
        AS coop_remote_share,
      MAX(timestamp) AS as_of
    FROM lnd_node_closed_channels
    WHERE local_pubkey IS NOT NULL
    GROUP BY local_pubkey
  `;
}

/**
 * AP-11 close-storm input: max self-initiated closes in any 1h bucket within the
 * last `windowHours` (24 default). Bounded read (T-02-05): the inner scan is
 * windowed and hour-bucketed via date_trunc. `windowHours` is bound.
 */
export function buildSelfCloseStormSql(windowHours = 24): SQL {
  return sql`
    SELECT local_pubkey, MAX(hourly) AS max_hourly_self_closes
    FROM (
      SELECT local_pubkey, date_trunc('hour', timestamp) AS h, COUNT(*) AS hourly
      FROM lnd_node_closed_channels
      WHERE local_pubkey IS NOT NULL
        AND close_initiator = 'INITIATOR_LOCAL'
        AND timestamp > now() - make_interval(hours => ${windowHours})
      GROUP BY local_pubkey, date_trunc('hour', timestamp)
    ) b
    GROUP BY local_pubkey
  `;
}

/** Row shapes surfaced by drizzle .execute for the two builders above. */
interface AggRow {
  local_pubkey: string;
  local_fc_window: number | string | bigint;
  coop_remote_share: number | string | null;
  // STRING at runtime: drizzle's postgres-js adapter overrides the driver's
  // timestamp parsers, so raw .execute surfaces MAX(timestamp) as an ISO
  // string — coerce in the mapping below (verified live in the D-14 golden run).
  as_of: Date | string | null;
}

interface StormRow {
  local_pubkey: string;
  max_hourly_self_closes: number | string | bigint;
}

/**
 * Force-close dimension for the whole fleet: raw = LOCAL force-close count in
 * the window; extras carry the AP-11 storm metric (0 when the node had no
 * self-initiated close in the last 24h) and the coop-REMOTE share.
 */
export async function forceCloseForFleet(
  windowDays = 30,
): Promise<Map<string, DimensionResult>> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const [aggResult, stormResult] = await Promise.all([
    dbRouting.execute(buildForceCloseAggSql(windowDays)),
    dbRouting.execute(buildSelfCloseStormSql()),
  ]);

  const aggRows = aggResult as unknown as AggRow[];
  const stormRows = stormResult as unknown as StormRow[];

  const stormByNode = new Map<string, number>();
  for (const row of stormRows) {
    stormByNode.set(row.local_pubkey, Number(row.max_hourly_self_closes));
  }

  const out = new Map<string, DimensionResult>();
  for (const row of aggRows) {
    // Absent from the storm query = zero self-initiated closes in the window.
    const extras: Record<string, number> = {
      maxHourlySelfCloses: stormByNode.get(row.local_pubkey) ?? 0,
    };
    // NULLIF makes the share NULL when a node has no coop closes — omit the key
    // rather than fabricate a 0 share (extras values are numbers only).
    if (row.coop_remote_share != null) {
      extras.coopRemoteShare = Number(row.coop_remote_share);
    }
    out.set(row.local_pubkey, {
      raw: Number(row.local_fc_window),
      // WR-01: offset-less string (UTC wall time) — parse as UTC, never
      // host-local.
      asOf: parseDbTimestampUtc(row.as_of),
      extras,
    });
  }
  return out;
}
