import { sql, type SQL } from "drizzle-orm";
import { DEFAULT_WINDOW, ROW_CAP, WINDOW_PRESETS, type WindowKey } from "@/lib/console/config";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// Closes console tab — windowed event reads (D-05/D-06/D-07/D-09)
// =====================================================
// Source: `lnd_node_closed_channels` — ONE ROW PER CLOSE (verified near-1:1
// rows:chan_id; force-close.ts precedent). Aggregate BY ROW; NO DISTINCT ON.
// Identity column: local_pubkey. Time column: `timestamp` (offset-less UTC
// wall time) — window via make_interval(days => $bound_integer), asOf via
// parseDbTimestampUtc (WR-01: never host-local parse). The window boundary
// compares against `now() AT TIME ZONE 'UTC'` (a UTC wall-time timestamp), so
// the predicate never implicitly casts the column via the session TimeZone
// (WR-04: a non-UTC session would shift every boundary by the offset).
//
// D-06: `days` is the BOUND INTEGER from WINDOW_PRESETS — never a user string
// in an interval. D-07: rendered rows are LIMIT-capped at ROW_CAP beneath the
// summary strip. D-09: the full-window builder (no LIMIT) feeds the CSV export
// route — still bounded by the 90d preset maximum (T-03-08).
//
// close_type FILTER literals are the verified enum from the schema doc
// (COOPERATIVE_CLOSE / LOCAL_FORCE_CLOSE / REMOTE_FORCE_CLOSE / ABANDONED /
// BREACH_CLOSE / FUNDING_CANCELED) — fixed SQL text, never user input.

/** Raw closed-channel row as surfaced by raw .execute — bigints are STRINGS (lossless for CSV). */
export interface ClosedChannelRow {
  id: number;
  channel_point: string | null;
  chan_id: string | null;
  chain_hash: string | null;
  closing_tx_hash: string | null;
  remote_pubkey: string | null;
  capacity: string | null;
  close_height: string | null;
  settled_balance: string | null;
  time_locked_balance: string | null;
  close_type: string | null;
  open_initiator: string | null;
  close_initiator: string | null;
  local_pubkey: string;
  lnd_alias: string | null;
  /** Offset-less UTC wall-time string — parse via parseDbTimestampUtc only. */
  timestamp: string | null;
}

/** Raw summary row produced by buildClosesSummarySql. */
interface ClosesSummaryRow {
  n: number;
  total_capacity_sat: string | number | null;
  total_settled_sat: string | number | null;
  coop_count: string | number;
  local_fc_count: string | number;
  remote_fc_count: string | number;
  abandoned_count: string | number;
  breach_count: string | number;
  funding_canceled_count: string | number;
  as_of: Date | string | null;
}

/** Summary-strip aggregates (display values — Number()-coerced). */
export interface ClosesSummary {
  n: number;
  totalCapacitySat: number;
  totalSettledSat: number;
  /** Per-close_type counts keyed by the verified enum literals. */
  byCloseType: {
    COOPERATIVE_CLOSE: number;
    LOCAL_FORCE_CLOSE: number;
    REMOTE_FORCE_CLOSE: number;
    ABANDONED: number;
    BREACH_CLOSE: number;
    FUNDING_CANCELED: number;
  };
}

/** The Closes tab view consumed by the page (03-06) and export route (03-07). */
export interface ClosesTabView {
  summary: ClosesSummary;
  /** Newest ROW_CAP rows, raw strings (lossless). */
  rows: ClosedChannelRow[];
  /** Full-window count — powers the "showing newest X of N" banner (D-07). */
  totalCount: number;
  asOf: Date | null;
}

/**
 * Summary-strip aggregate for one node's window. NOTE on MAX(timestamp):
 * legitimate as-of aggregate over the windowed row set (force-close.ts
 * precedent) — NOT the AFM-001 `WHERE timestamp = MAX(...)` anti-pattern.
 */
export function buildClosesSummarySql(pubkey: string, days: number): SQL {
  return sql`
    SELECT COUNT(*)::int AS n,
           SUM(capacity)        AS total_capacity_sat,
           SUM(settled_balance) AS total_settled_sat,
           COUNT(*) FILTER (WHERE close_type = 'COOPERATIVE_CLOSE')  AS coop_count,
           COUNT(*) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE')  AS local_fc_count,
           COUNT(*) FILTER (WHERE close_type = 'REMOTE_FORCE_CLOSE') AS remote_fc_count,
           COUNT(*) FILTER (WHERE close_type = 'ABANDONED')          AS abandoned_count,
           COUNT(*) FILTER (WHERE close_type = 'BREACH_CLOSE')       AS breach_count,
           COUNT(*) FILTER (WHERE close_type = 'FUNDING_CANCELED')   AS funding_canceled_count,
           MAX(timestamp) AS as_of
    FROM lnd_node_closed_channels
    WHERE local_pubkey = ${pubkey}
      AND timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => ${days})
  `;
}

/** Newest `cap` rows of the window (D-07 capped render set). */
export function buildClosesRowsSql(pubkey: string, days: number, cap: number = ROW_CAP): SQL {
  return sql`
    SELECT * FROM lnd_node_closed_channels
    WHERE local_pubkey = ${pubkey}
      AND timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => ${days})
    ORDER BY timestamp DESC
    LIMIT ${cap}
  `;
}

/**
 * Full-window rows — NO cap — for the CSV export route (D-09). Still bounded
 * by the 90d preset maximum (T-03-08: D-06 is the security control).
 */
export function buildClosesFullSql(pubkey: string, days: number): SQL {
  return sql`
    SELECT * FROM lnd_node_closed_channels
    WHERE local_pubkey = ${pubkey}
      AND timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => ${days})
    ORDER BY timestamp DESC
  `;
}

/**
 * Closes tab data for one node: summary strip + capped newest rows in one
 * Promise.all pass. The window key maps to bound integer days via
 * WINDOW_PRESETS (D-06).
 */
export async function closesTabData(
  pubkey: string,
  windowKey: WindowKey = DEFAULT_WINDOW,
): Promise<ClosesTabView> {
  const days = WINDOW_PRESETS[windowKey];
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const [summaryResult, rowsResult] = await Promise.all([
    dbRouting.execute(buildClosesSummarySql(pubkey, days)),
    dbRouting.execute(buildClosesRowsSql(pubkey, days, ROW_CAP)),
  ]);

  const summaryRow = (summaryResult as unknown as ClosesSummaryRow[])[0];
  const rows = rowsResult as unknown as ClosedChannelRow[];

  const n = Number(summaryRow?.n ?? 0);
  return {
    summary: {
      n,
      totalCapacitySat: Number(summaryRow?.total_capacity_sat ?? 0),
      totalSettledSat: Number(summaryRow?.total_settled_sat ?? 0),
      byCloseType: {
        COOPERATIVE_CLOSE: Number(summaryRow?.coop_count ?? 0),
        LOCAL_FORCE_CLOSE: Number(summaryRow?.local_fc_count ?? 0),
        REMOTE_FORCE_CLOSE: Number(summaryRow?.remote_fc_count ?? 0),
        ABANDONED: Number(summaryRow?.abandoned_count ?? 0),
        BREACH_CLOSE: Number(summaryRow?.breach_count ?? 0),
        FUNDING_CANCELED: Number(summaryRow?.funding_canceled_count ?? 0),
      },
    },
    rows,
    totalCount: n,
    // WR-01: offset-less string (UTC wall time) — parse as UTC, never host-local.
    asOf: parseDbTimestampUtc(summaryRow?.as_of ?? null),
  };
}
