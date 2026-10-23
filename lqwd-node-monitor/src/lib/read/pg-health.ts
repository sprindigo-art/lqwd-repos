import { sql, type SQL } from "drizzle-orm";
import { clampCounterDelta } from "@/lib/read/counter-delta";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { deriveStale } from "@/lib/read/host-metrics";
import { TELEMETRY_BANDS, evaluateBand, type BandSeverity } from "@/lib/read/telemetry-bands";

// =====================================================
// COL-02 — pg_health latest-per-host + read-time AP-12a/b discriminator
// =====================================================
// `pg_health` is an APPEND-HISTORY fact table (Plan 15-01): every collector
// tick emits a new row per host of RAW cumulative pg_stat_* counters + PG-log
// grep counts. The latest PG state of each host is its NEWEST row.
//
//   ✅  SELECT DISTINCT ON (host_id) ... ORDER BY host_id, collected_at DESC
//   ❌  WHERE collected_at = (SELECT MAX(collected_at) ...)  ← AFM-001 failure
//
// D-14: NO a/b verdict, band, or severity is ever stored or read from the DB —
// everything below `derivePgHealthVerdict` is computed at READ time from RAW
// counters (T-15-08: nothing stored to poison). The AP-12a-vs-b discriminator
// (AP-12 runbook step 5):
//   - high `too_many_clients_count` (or conn saturation ≥ 0.8) ⇒ AP-12a
//   - high 40001 rate (≥10× the 400–800/day chronic-benign baseline, BP-005)
//     WITH low too-many-clients ⇒ AP-12b
//   - otherwise null (healthy / benign-baseline — a chronic 500/day 40001
//     node must NEVER page).
// Cumulative counters (serialization_40001_count, xact_rollback) are Δ-clamped
// via clampCounterDelta across stats_reset boundaries (Pitfall 7) so a PG
// restart can never yield a negative rate. `host_id` is ALWAYS parameter-bound
// (T-15-01), never concatenated.

/** BP-005 chronic-benign 40001 baseline (400–800/day band midpoint). */
const DEFAULT_40001_BASELINE_PER_DAY = 600;

/** Saturation ratio at/above which AP-12a exhaustion is considered imminent. */
const AP12A_SATURATION_FLOOR = 0.8;

const MS_PER_DAY = 86_400_000;

/** Latest-per-host row shape from `pg_health` (raw-execute column names). */
export interface LatestPgHealthRow {
  host_id: string;
  collected_at: Date | string | null;
  datname: string | null;
  max_connections: number | null;
  active_connections: number | null;
  numbackends: number | null;
  xact_commit: bigint | number | null;
  xact_rollback: bigint | number | null;
  deadlocks: bigint | number | null;
  too_many_clients_count: bigint | number | null;
  serialization_40001_count: bigint | number | null;
  fatal_count: bigint | number | null;
  blocked_queries: number | null;
  slow_query_gt_1s: number | null;
  stats_reset: Date | string | null;
}

/** A graded signal: the raw read-time value plus its D-14 band severity. */
export interface PgBandEvidence {
  value: number;
  band: BandSeverity;
}

/** Read-time PG verdict — ALL derived here from RAW counters, never stored. */
export interface PgHealthVerdict {
  /** active_connections / max_connections, banded (pg_conn_saturation). */
  connSaturation: PgBandEvidence | null;
  /** Current tick's `FATAL: too many clients` grep count (AP-12a signature). */
  tooManyClients: number | null;
  /** Δ-clamped 40001 count scaled to per-day; null without a prior sample. */
  serialization40001PerDay: number | null;
  /** per-day rate ÷ baseline, banded (pg_40001_rate_multiple — BP-005 ≥10×). */
  rateMultiple: PgBandEvidence | null;
  /** Δ-clamped xact_rollback across the sample interval (Pitfall 7). */
  xactRollbackDelta: number | null;
  /** The read-time AP-12 discriminator; null = healthy / benign baseline. */
  ap12Variant: "ap12a" | "ap12b" | null;
}

/** Per-host PG health view: latest raw row + the read-time verdict. */
export interface PgHealthView {
  hostId: string;
  collectedAt: Date | null;
  stale: boolean;
  hasData: boolean;
  health: LatestPgHealthRow | null;
  verdict: PgHealthVerdict | null;
}

/** Fleet variant: adds the hosts-dimension metadata + node mapping. */
export interface FleetPgHealthView extends PgHealthView {
  hostname: string | null;
  /** Node pubkeys declared on this host (hosts.node_pubkeys). */
  nodePubkeys: string[];
}

/**
 * Build the AFM-001 DISTINCT ON (host_id) latest-pg_health fragment for one
 * host. Exposed for the no-DB shape test. `hostId` is bound ($1), never
 * interpolated (T-15-01).
 */
export function buildLatestPgHealthSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM pg_health
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
    ORDER BY host_id, collected_at DESC
  `;
}

/**
 * The sample immediately BEFORE the latest one — the Δ side of the read-time
 * counter-rate math. Parameter-bound like the latest fragment.
 */
function buildPreviousPgHealthSql(hostId: string): SQL {
  return sql`
    SELECT *
    FROM pg_health
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
    ORDER BY collected_at DESC
    OFFSET 1 LIMIT 1
  `;
}

// PERF-01 recency bound (T-18-15). The fleet ROW_NUMBER scan partitions ALL of
// pg_health across every host over all retained time — the unbounded
// full-partition scan. Bounding the inner scan to the last 30 days (tied by value
// to STALENESS_CUTOFF_DAYS) keeps only samples within the window; a host with no
// pg_health row in 30 days is eliminated from monitoring anyway. The single-host
// `buildLatestPgHealthSql` stays UNBOUNDED as the single-entity fallback.
const PG_HEALTH_WINDOW_DAYS = 30;

/**
 * Fleet-wide latest + previous pg_health rows, driven from the `hosts`
 * DIMENSION via LEFT JOIN so a declared-but-never-probed host reads as
 * no-data. rn=1 is the latest sample, rn=2 the previous (Δ baseline) —
 * latest-per-host via partition ordering, never MAX(collected_at). The inner
 * scan is bounded by a UTC recency window (PERF-01 / T-18-15). Exposed for the
 * no-DB shape test. `PG_HEALTH_WINDOW_DAYS` is bound, never interpolated.
 */
export function buildFleetRecentPgHealthSql(): SQL {
  return sql`
    SELECT
      h.host_id, h.hostname, h.node_pubkeys,
      p.rn, p.collected_at, p.datname, p.max_connections, p.active_connections,
      p.numbackends, p.xact_commit, p.xact_rollback, p.deadlocks,
      p.too_many_clients_count, p.serialization_40001_count, p.fatal_count,
      p.blocked_queries, p.slow_query_gt_1s, p.stats_reset
    FROM hosts h
    LEFT JOIN (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY host_id ORDER BY collected_at DESC) AS rn
      FROM pg_health
      WHERE host_id IS NOT NULL
        AND collected_at > (now() AT TIME ZONE 'UTC') - make_interval(days => ${PG_HEALTH_WINDOW_DAYS})
    ) p ON p.host_id = h.host_id AND p.rn <= 2
    ORDER BY h.host_id, p.rn
  `;
}

function toNum(v: bigint | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return typeof v === "bigint" ? Number(v) : v;
}

/** Normalize a stats_reset stamp for epoch comparison inside the Δ clamp. */
function resetStamp(v: Date | string | null | undefined): string | null {
  if (v == null) return null;
  const parsed = parseDbTimestampUtc(v as Date | string);
  return parsed == null ? String(v) : parsed.toISOString();
}

/** ms between two samples' collected_at, or null when either is unparseable. */
function intervalMs(
  prevAt: Date | string | null,
  currAt: Date | string | null,
): number | null {
  const prev = parseDbTimestampUtc(prevAt);
  const curr = parseDbTimestampUtc(currAt);
  if (prev == null || curr == null) return null;
  const ms = curr.getTime() - prev.getTime();
  return ms > 0 ? ms : null;
}

/**
 * PURE read-time AP-12 discriminator + band derivation from RAW pg_health rows
 * (mirrors buildChainEvidence — D-14: nothing here is ever stored).
 *
 * - connSaturation = active/max → pg_conn_saturation band.
 * - 40001 per-day rate = clampCounterDelta across stats_reset (Pitfall 7)
 *   scaled by the sample interval; rateMultiple = rate ÷ baseline →
 *   pg_40001_rate_multiple band (BP-005: <10× is chronic-benign).
 * - variant: too-many-clients > 0 OR saturation ≥ 0.8 ⇒ "ap12a"; else
 *   rate ≥ 10× baseline ⇒ "ap12b"; else null.
 */
export function derivePgHealthVerdict(
  current: LatestPgHealthRow,
  previous?: LatestPgHealthRow | null,
  baseline40001PerDay: number = DEFAULT_40001_BASELINE_PER_DAY,
): PgHealthVerdict {
  const maxConn = toNum(current.max_connections);
  const active = toNum(current.active_connections);
  const saturation = maxConn != null && maxConn > 0 && active != null ? active / maxConn : null;
  const connSaturation: PgBandEvidence | null =
    saturation == null
      ? null
      : { value: saturation, band: evaluateBand(saturation, TELEMETRY_BANDS.pg_conn_saturation) };

  const tooManyClients = toNum(current.too_many_clients_count);

  // Δ-clamped counter rates (Pitfall 7) — only derivable with a prior sample.
  let serialization40001PerDay: number | null = null;
  let xactRollbackDelta: number | null = null;
  if (previous != null) {
    const prevStamp = resetStamp(previous.stats_reset);
    const currStamp = resetStamp(current.stats_reset);
    const serializationDelta =
      current.serialization_40001_count == null
        ? null
        : clampCounterDelta(
            previous.serialization_40001_count,
            current.serialization_40001_count,
            prevStamp,
            currStamp,
          );
    xactRollbackDelta =
      current.xact_rollback == null
        ? null
        : clampCounterDelta(previous.xact_rollback, current.xact_rollback, prevStamp, currStamp);
    const dtMs = intervalMs(previous.collected_at, current.collected_at);
    if (serializationDelta != null && dtMs != null) {
      serialization40001PerDay = (serializationDelta * MS_PER_DAY) / dtMs;
    }
  }

  const rateMultipleValue =
    serialization40001PerDay == null || baseline40001PerDay <= 0
      ? null
      : serialization40001PerDay / baseline40001PerDay;
  const rateMultiple: PgBandEvidence | null =
    rateMultipleValue == null
      ? null
      : {
          value: rateMultipleValue,
          band: evaluateBand(rateMultipleValue, TELEMETRY_BANDS.pg_40001_rate_multiple),
        };

  // Discriminator (AP-12 runbook step 5): a beats b when both fire.
  let ap12Variant: "ap12a" | "ap12b" | null = null;
  const tooManyClientsHigh = (tooManyClients ?? 0) > 0;
  const saturationHigh = saturation != null && saturation >= AP12A_SATURATION_FLOOR;
  if (tooManyClientsHigh || saturationHigh) {
    ap12Variant = "ap12a";
  } else if (
    rateMultipleValue != null &&
    rateMultipleValue > TELEMETRY_BANDS.pg_40001_rate_multiple.warn
  ) {
    // Fire ap12b only when the rate multiple is actually in the CRITICAL band
    // (value > warn boundary), matching the band's ">10× is the hard page"
    // convention. Using >= 10 previously fired at exactly 10.0×, where the band
    // still grades healthy, emitting an info-severity "hard page" card (WR-03).
    ap12Variant = "ap12b";
  }

  return {
    connSaturation,
    tooManyClients,
    serialization40001PerDay,
    rateMultiple,
    xactRollbackDelta,
    ap12Variant,
  };
}

/** Coerce a raw-execute row's collected_at to a real UTC Date. */
function coerceRow(row: LatestPgHealthRow): LatestPgHealthRow {
  return { ...row, collected_at: parseDbTimestampUtc(row.collected_at as Date | string | null) };
}

/**
 * Latest pg_health for ONE host: latest row via the DISTINCT ON fragment, the
 * prior sample for Δ rates, and the read-time verdict.
 */
export async function getPgHealth(hostId: string): Promise<PgHealthView> {
  // Lazy import keeps the server-only dbNodemon client (postgres() pool +
  // requireEnv at module load) out of the no-DB shape test's import graph.
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const latestRows = (await dbNodemon.execute(
    buildLatestPgHealthSql(hostId),
  )) as unknown as LatestPgHealthRow[];
  const previousRows = (await dbNodemon.execute(
    buildPreviousPgHealthSql(hostId),
  )) as unknown as LatestPgHealthRow[];

  const current = latestRows[0] != null ? coerceRow(latestRows[0]) : null;
  const previous = previousRows[0] != null ? coerceRow(previousRows[0]) : null;
  const collectedAt = (current?.collected_at as Date | null) ?? null;

  return {
    hostId,
    collectedAt,
    stale: deriveStale(collectedAt),
    hasData: current != null,
    health: current,
    verdict: current == null ? null : derivePgHealthVerdict(current, previous),
  };
}

/** Raw fleet row shape (hosts LEFT JOIN two-most-recent pg_health). */
interface FleetRecentPgHealthRow extends LatestPgHealthRow {
  hostname: string | null;
  node_pubkeys: string[] | null;
  rn: number | string | null;
}

/**
 * Latest + previous pg_health for every DECLARED host (hosts dimension), with
 * the read-time verdict and the host→node pubkey mapping the deterministic
 * AP-12 detector fans over. Never-probed hosts surface as no-data.
 */
export async function getFleetPgHealth(): Promise<FleetPgHealthView[]> {
  // Lazy import — same no-DB import-graph posture as getPgHealth.
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const rows = (await dbNodemon.execute(
    buildFleetRecentPgHealthSql(),
  )) as unknown as FleetRecentPgHealthRow[];

  const byHost = new Map<
    string,
    { hostname: string | null; nodePubkeys: string[]; current: LatestPgHealthRow | null; previous: LatestPgHealthRow | null }
  >();
  for (const row of rows) {
    const entry = byHost.get(row.host_id) ?? {
      hostname: row.hostname ?? null,
      nodePubkeys: row.node_pubkeys ?? [],
      current: null,
      previous: null,
    };
    const rn = row.rn == null ? null : Number(row.rn);
    if (rn === 1) {
      const { hostname: _h, node_pubkeys: _n, rn: _r, ...cols } = row;
      entry.current = coerceRow({ ...cols, host_id: row.host_id });
    } else if (rn === 2) {
      const { hostname: _h, node_pubkeys: _n, rn: _r, ...cols } = row;
      entry.previous = coerceRow({ ...cols, host_id: row.host_id });
    }
    byHost.set(row.host_id, entry);
  }

  return [...byHost.entries()].map(([hostId, entry]) => {
    const collectedAt = (entry.current?.collected_at as Date | null) ?? null;
    return {
      hostId,
      hostname: entry.hostname,
      nodePubkeys: entry.nodePubkeys,
      collectedAt,
      stale: deriveStale(collectedAt),
      hasData: entry.current != null,
      health: entry.current,
      verdict:
        entry.current == null ? null : derivePgHealthVerdict(entry.current, entry.previous),
    };
  });
}
