import { sql, type SQL } from "drizzle-orm";
import { DEFAULT_WINDOW, ROW_CAP, WINDOW_PRESETS, type WindowKey } from "@/lib/console/config";
import { DEFAULT_PAGE_SIZE, parsePageParam, type PageParam } from "@/lib/console/paginate";

// =====================================================
// Forwards console tab — windowed event reads (D-05/D-06/D-07/D-09)
// =====================================================
// Source: `lnd_node_forwards` (EVENT log; identity column lnd_pubkey). Time
// column is `timestamp_ns` — NANOSECONDS since epoch (Pitfall 6 / Phase-2
// Pitfall 3): every window predicate multiplies by 1e9, and the *1e9 factor
// stays in the SQL text. asOf converts back via max_ts_ns / 1e6 → Date(ms).
//
// AFM-002 HARD RULE: fee math is SUM(fee_msat)/1000.0 = sats — NEVER the raw
// `fee` column (the documented 1000x-off failure). Rows pass through raw
// (`SELECT *`, bigints surface as STRINGS from raw .execute) so the CSV export
// stays lossless; Number() coercion happens only on summary display values.
//
// D-06: `days` is the BOUND INTEGER from WINDOW_PRESETS — the URL window key
// is whitelist-mapped before it gets near SQL; never bind a user string into
// an interval. D-07: rendered rows are LIMIT-capped at ROW_CAP beneath the
// summary strip. D-09: the full-window builder (no LIMIT) feeds the CSV export
// route — still bounded by the 90d preset maximum (T-03-08).

// Both window factors are parameter-bound, so each carries an explicit ::int
// cast — `$n * $m` with two untyped params is `unknown * unknown`, which
// Postgres rejects with "operator is not unique" (42725; found live, 03-07).
const SECONDS_PER_DAY = 86400;

/** Raw forward row as surfaced by raw .execute — bigint columns are STRINGS (lossless for CSV). */
export interface ForwardRow {
  id: number;
  chan_id_in: string | null;
  chan_id_out: string | null;
  amt_in: string | null;
  amt_out: string | null;
  /** FORBIDDEN for math (AFM-002) — present only because rows pass through raw for export. */
  fee: string | null;
  fee_msat: string | null;
  amt_in_msat: string | null;
  amt_out_msat: string | null;
  /** Nanoseconds since epoch, as a string. */
  timestamp_ns: string;
  lnd_pubkey: string;
  peer_alias_in: string | null;
  peer_alias_out: string | null;
}

/** Raw summary row produced by buildForwardsSummarySql. */
interface ForwardsSummaryRow {
  n: number;
  total_amt_out_sat: string | number | null;
  total_fees_sat: string | number | null;
  avg_fee_sat: string | number | null;
  max_ts_ns: string | number | null;
}

/** Raw busiest-channel row produced by buildBusiestChannelSql. */
interface BusiestRow {
  chan_id_out: string | null;
  n: number;
  peer_alias_out: string | null;
}

/** Summary-strip aggregates (display values — Number()-coerced). */
export interface ForwardsSummary {
  n: number;
  totalAmtOutSat: number;
  totalFeesSat: number;
  /** null when the window holds zero forwards (AVG of nothing is no-data, not 0). */
  avgFeeSat: number | null;
}

/** Busiest channel of the window for the summary strip. */
export interface BusiestChannel {
  chanIdOut: string | null;
  count: number;
  peerAliasOut: string | null;
}

/** The Forwards tab view consumed by the page (03-06) and export route (03-07). */
export interface ForwardsTabView {
  summary: ForwardsSummary;
  /** Newest ROW_CAP rows, raw strings (lossless). */
  rows: ForwardRow[];
  busiest: BusiestChannel | null;
  /** Full-window count — powers the "showing newest X of N" banner (D-07). */
  totalCount: number;
  asOf: Date | null;
}

/** ForwardsTabView plus the clamped pagination frame for the forwards sub-route. */
export interface ForwardsPageView extends ForwardsTabView {
  /** The clamped page frame (page/offset/pageCount/pageSize) from parsePageParam. */
  pagination: PageParam;
}

/**
 * Summary-strip aggregate for one node's window. NOTE on MAX(timestamp_ns):
 * legitimate as-of aggregate, NOT the AFM-001 `WHERE timestamp =` anti-pattern.
 */
export function buildForwardsSummarySql(pubkey: string, days: number): SQL {
  return sql`
    SELECT COUNT(*)::int AS n,
           SUM(amt_out)         AS total_amt_out_sat,
           SUM(fee_msat)/1000.0 AS total_fees_sat,
           AVG(fee_msat)/1000.0 AS avg_fee_sat,
           MAX(timestamp_ns)    AS max_ts_ns
    FROM lnd_node_forwards
    WHERE lnd_pubkey = ${pubkey}
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
  `;
}

/** Newest `cap` rows of the window (D-07 capped render set). */
export function buildForwardsRowsSql(pubkey: string, days: number, cap: number = ROW_CAP): SQL {
  return sql`
    SELECT * FROM lnd_node_forwards
    WHERE lnd_pubkey = ${pubkey}
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
    ORDER BY timestamp_ns DESC
    LIMIT ${cap}
  `;
}

/**
 * Full-window rows — NO cap — for the CSV export route (D-09). Still bounded
 * by the 90d preset maximum (T-03-08: D-06 is the security control).
 */
export function buildForwardsFullSql(pubkey: string, days: number): SQL {
  return sql`
    SELECT * FROM lnd_node_forwards
    WHERE lnd_pubkey = ${pubkey}
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
    ORDER BY timestamp_ns DESC
  `;
}

/**
 * OFFSET-paginated window slice for the forwards sub-route (G1 server-side
 * pagination). Mirrors buildForwardsRowsSql but adds a bound `OFFSET`AFTER the
 * `LIMIT` so a large event log can be paged server-side. Both `limit` and
 * `offset` carry an explicit `::int` cast — a bare `$n` param in LIMIT/OFFSET
 * is `unknown`, which Postgres rejects (42725, the same "unknown * unknown"
 * class the window factors guard against). The nanosecond window predicate and
 * newest-first order are preserved verbatim.
 */
export function buildForwardsPageSql(
  pubkey: string,
  days: number,
  limit: number,
  offset: number,
): SQL {
  return sql`
    SELECT * FROM lnd_node_forwards
    WHERE lnd_pubkey = ${pubkey}
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
    ORDER BY timestamp_ns DESC
    LIMIT ${limit}::int
    OFFSET ${offset}::int
  `;
}

/** Busiest outgoing channel of the window — the summary strip's "busiest" cell. */
export function buildBusiestChannelSql(pubkey: string, days: number): SQL {
  return sql`
    SELECT chan_id_out, COUNT(*)::int AS n, MAX(peer_alias_out) AS peer_alias_out
    FROM lnd_node_forwards
    WHERE lnd_pubkey = ${pubkey}
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
    GROUP BY chan_id_out
    ORDER BY COUNT(*) DESC
    LIMIT 1
  `;
}

/**
 * Forwards tab data for one node: summary strip + capped newest rows + busiest
 * channel, all in one Promise.all pass (force-close.ts pattern). The window
 * key maps to bound integer days via WINDOW_PRESETS (D-06).
 */
export async function forwardsTabData(
  pubkey: string,
  windowKey: WindowKey = DEFAULT_WINDOW,
): Promise<ForwardsTabView> {
  const days = WINDOW_PRESETS[windowKey];
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const [summaryResult, rowsResult, busiestResult] = await Promise.all([
    dbRouting.execute(buildForwardsSummarySql(pubkey, days)),
    dbRouting.execute(buildForwardsRowsSql(pubkey, days, ROW_CAP)),
    dbRouting.execute(buildBusiestChannelSql(pubkey, days)),
  ]);

  const summaryRow = (summaryResult as unknown as ForwardsSummaryRow[])[0];
  const rows = rowsResult as unknown as ForwardRow[];
  const busiestRow = (busiestResult as unknown as BusiestRow[])[0];

  const n = Number(summaryRow?.n ?? 0);
  return {
    summary: {
      n,
      totalAmtOutSat: Number(summaryRow?.total_amt_out_sat ?? 0),
      totalFeesSat: Number(summaryRow?.total_fees_sat ?? 0),
      avgFeeSat: summaryRow?.avg_fee_sat == null ? null : Number(summaryRow.avg_fee_sat),
    },
    rows,
    busiest: busiestRow
      ? {
          chanIdOut: busiestRow.chan_id_out,
          count: Number(busiestRow.n),
          peerAliasOut: busiestRow.peer_alias_out,
        }
      : null,
    totalCount: n,
    // timestamp_ns is ns since epoch; Date wants ms → /1e6 (revenue.ts precedent).
    asOf: summaryRow?.max_ts_ns == null ? null : new Date(Number(summaryRow.max_ts_ns) / 1e6),
  };
}

/**
 * OFFSET-paginated forwards data for the forwards sub-route (G1). Two-step read
 * (CR-01): the summary runs FIRST so the authoritative total is known before any
 * OFFSET is derived; `parsePageParam` (T-13-11-01) then clamps the raw ?page
 * against the TRUE total, and that same frame's `offset` is what gets bound into
 * the page SQL. The rendered rows and the "page X of N" banner therefore always
 * agree — an over-range ?page serves the real last page's rows, never a silent
 * page-1 repeat. Costs one extra sequential round-trip; correctness over speed
 * on an audit-relevant surface.
 *
 * `page` is the raw, untrusted ?page URL value — it only ever reaches SQL as the
 * clamped integer `offset` (never a raw string). The ns→ms `asOf` conversion and
 * AFM-002 fee math are preserved verbatim from the summary.
 */
export async function forwardsPageData(
  pubkey: string,
  windowKey: WindowKey = DEFAULT_WINDOW,
  page: string | null | undefined,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<ForwardsPageView> {
  const days = WINDOW_PRESETS[windowKey];
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  // Step 1 — the authoritative total (and summary aggregates) for the window.
  const summaryResult = await dbRouting.execute(buildForwardsSummarySql(pubkey, days));
  const summaryRow = (summaryResult as unknown as ForwardsSummaryRow[])[0];
  const n = Number(summaryRow?.n ?? 0);

  // Step 2 — the clamped frame from the TRUE total; its offset is the one and
  // only OFFSET bound into the page query (frame and rows cannot disagree).
  const pagination = parsePageParam(page, { total: n, pageSize });
  const rowsResult = await dbRouting.execute(
    buildForwardsPageSql(pubkey, days, pagination.pageSize, pagination.offset),
  );
  const rows = rowsResult as unknown as ForwardRow[];

  return {
    summary: {
      n,
      totalAmtOutSat: Number(summaryRow?.total_amt_out_sat ?? 0),
      totalFeesSat: Number(summaryRow?.total_fees_sat ?? 0),
      avgFeeSat: summaryRow?.avg_fee_sat == null ? null : Number(summaryRow.avg_fee_sat),
    },
    rows,
    // buildForwardsPageSql does not compute the busiest cell — that is a summary
    // strip concern owned by forwardsTabData; the paginated sub-route reader
    // stays lean and leaves it null.
    busiest: null,
    totalCount: n,
    // timestamp_ns is ns since epoch; Date wants ms → /1e6 (revenue.ts precedent).
    asOf: summaryRow?.max_ts_ns == null ? null : new Date(Number(summaryRow.max_ts_ns) / 1e6),
    pagination,
  };
}
