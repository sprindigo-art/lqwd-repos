import { sql, type SQL } from "drizzle-orm";
import { DEFAULT_WINDOW, WINDOW_PRESETS, type WindowKey } from "@/lib/console/config";

// =====================================================
// Console trend series — daily-bucket aggregates for sparklines
// =====================================================
// These series feed DISPLAY-ONLY sparklines in the evidence panels (sketch
// 003 synthesis winner: mono evidence line + 160x40 navy sparkline SVG). No
// grading, no thresholds — the scorecard owns judgment; this module only
// surfaces shape-over-time for the event-backed dimensions:
//   routing  → daily forward count        (lnd_node_forwards)
//   revenue  → daily forward fees in sats (lnd_node_forwards)
//   force-close prevention → daily close count (lnd_node_closed_channels)
// Latest-state dimensions (liquidity, channel health, peer, restart) have no
// sanctioned history reader — their panels carry the mono line alone.
//
// AFM-002 HARD RULE: fee math is SUM(fee_msat)/1000.0 = sats — NEVER the raw
// `fee` column (the documented 1000x-off failure).
//
// D-06: `days` is the BOUND INTEGER from WINDOW_PRESETS — the URL window key
// is whitelist-mapped before it gets near SQL (T-03-22). Every builder is
// windowed (max 90d preset; closes fixed 30d) and GROUP BY day caps result
// rows at window length (T-03-23: no unbounded scan).

// Both window factors are parameter-bound, so each carries an explicit ::int
// cast — `$n * $m` with two untyped params is `unknown * unknown`, which
// Postgres rejects with "operator is not unique" (42725; found live, 03-07).
const SECONDS_PER_DAY = 86400;

/** One day-bucket of a trend series. `day` stays the verbatim Postgres date string (no timezone math). */
export interface TrendPoint {
  day: string;
  n: number;
  feesSat?: number;
}

/** Raw daily forwards row as surfaced by raw .execute. */
interface ForwardsDailyRow {
  day: string;
  n: number;
  fees_sat: string | number | null;
}

/** Raw daily closes row as surfaced by raw .execute. */
interface ClosesDailyRow {
  day: string;
  n: number;
}

/**
 * Daily forward count + fees for one node's window. Nanosecond window
 * predicate (Pitfall 6: timestamp_ns × 1e9); day bucket converts back via
 * to_timestamp(timestamp_ns / 1e9)::date. ORDER BY day ASC — sparklines draw
 * left-to-right oldest-first.
 */
export function buildForwardsDailySql(pubkey: string, days: number): SQL {
  return sql`
    SELECT to_timestamp(timestamp_ns / 1e9)::date AS day,
           COUNT(*)::int        AS n,
           SUM(fee_msat)/1000.0 AS fees_sat
    FROM lnd_node_forwards
    WHERE lnd_pubkey = ${pubkey}
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
    GROUP BY 1
    ORDER BY 1 ASC
  `;
}

/**
 * Daily close count for one node's window. `timestamp` is an offset-less UTC
 * wall-time column — windowed via make_interval with the bound days integer,
 * compared against `now() AT TIME ZONE 'UTC'` so the boundary never depends on
 * the session TimeZone (closes.ts precedent, WR-04). ORDER BY day ASC for
 * left-to-right sparklines.
 */
export function buildClosesDailySql(pubkey: string, days: number): SQL {
  return sql`
    SELECT timestamp::date AS day,
           COUNT(*)::int   AS n
    FROM lnd_node_closed_channels
    WHERE local_pubkey = ${pubkey}
      AND timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => ${days})
    GROUP BY 1
    ORDER BY 1 ASC
  `;
}

/**
 * Daily forwards series for the routing/revenue sparklines. The window key
 * maps to bound integer days via WINDOW_PRESETS (D-06). Empty window → empty
 * array (not null).
 */
export async function forwardsDailySeries(
  pubkey: string,
  windowKey: WindowKey = DEFAULT_WINDOW,
): Promise<TrendPoint[]> {
  const days = WINDOW_PRESETS[windowKey];
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const result = await dbRouting.execute(buildForwardsDailySql(pubkey, days));
  const rows = result as unknown as ForwardsDailyRow[];

  // Postgres date arrives as a string from raw execute — keep verbatim.
  return rows.map((row) => ({
    day: row.day,
    n: Number(row.n),
    feesSat: Number(row.fees_sat ?? 0),
  }));
}

/**
 * Daily closes series for the force-close sparkline. Defaults to 30 days to
 * match the scorecard force-close dimension window. Empty window → empty
 * array (not null).
 */
export async function closesDailySeries(pubkey: string, days: number = 30): Promise<TrendPoint[]> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const result = await dbRouting.execute(buildClosesDailySql(pubkey, days));
  const rows = result as unknown as ClosesDailyRow[];

  return rows.map((row) => ({
    day: row.day,
    n: Number(row.n),
  }));
}
