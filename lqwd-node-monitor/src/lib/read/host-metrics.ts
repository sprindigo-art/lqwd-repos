import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// TEL-01 — AFM-001 latest-per-host vitals + storage (host_metrics / host_storage)
// =====================================================
// `host_metrics` and `host_storage` are APPEND-HISTORY fact tables (Plan 01):
// every collector tick emits a new row per host (and per mount for storage). The
// latest state of each host is its NEWEST row PER entity key.
//
//   ✅  SELECT DISTINCT ON (host_id) ... ORDER BY host_id, collected_at DESC
//   ❌  WHERE collected_at = (SELECT MAX(collected_at) ...)  ← AFM-001 480-as-1 failure
//
// This module is the single centralized latest-host read so the greatest-timestamp
// landmine cannot reappear in a consumer. `host_id` is ALWAYS parameter-bound via
// the Drizzle `sql` template, never string-concatenated (SQL-injection mitigation,
// T-11-08). Telemetry reads the RW `dbNodemon` client (NOT `dbRouting`).
//
// Staleness is DERIVED at read time from `collected_at` against the ~15-min
// collector-freshness window (D-13) — NO stored stale flag exists or is read.
// bigint columns are surfaced raw (typed `bigint | number | null`); all byte/percent
// conversion happens through AFM-002 units.ts at the DISPLAY boundary, never here.

// ~15-min collector-freshness window (D-13). Rows older than this read stale.
const COLLECTOR_WINDOW_MS = 15 * 60 * 1000;

/** Latest-per-host row shape from `host_metrics` (raw-execute column names). */
export interface LatestHostMetricsRow {
  host_id: string;
  collected_at: Date | null;
  cpu_pct: string | number | null;
  load_1: string | number | null;
  load_5: string | number | null;
  load_15: string | number | null;
  mem_total_kb: bigint | number | null;
  mem_available_kb: bigint | number | null;
  swap_total_kb: bigint | number | null;
  swap_free_kb: bigint | number | null;
  uptime_seconds: bigint | number | null;
  net_rx_bytes: bigint | number | null;
  net_tx_bytes: bigint | number | null;
}

/** Latest-per-mount row shape from `host_storage`. */
export interface LatestHostStorageRow {
  host_id: string;
  collected_at: Date | null;
  mount_point: string | null;
  total_bytes: bigint | number | null;
  used_bytes: bigint | number | null;
  avail_bytes: bigint | number | null;
}

/** Per-host view: latest vitals + per-mount storage, with read-time staleness. */
export interface HostMetricsView {
  hostId: string;
  hostname: string | null;
  collectedAt: Date | null;
  /** Read-time D-13 derivation; true when no fact row exists (no-data). */
  stale: boolean;
  /** False for a declared-but-never-reported host (no fact row; SC#4 no-data). */
  hasData: boolean;
  metrics: LatestHostMetricsRow | null;
  storage: LatestHostStorageRow[];
}

/**
 * Build the AFM-001 DISTINCT ON (host_id) latest-per-host fragment for one host.
 * Exposed separately so the no-DB shape test asserts the emitted SQL without a
 * live nodemon connection. `hostId` is bound ($1), never interpolated.
 */
export function buildLatestHostMetricsSql(hostId: string): SQL {
  // `host_id IS NOT NULL` keeps every real host distinct under DISTINCT ON even
  // if a keyless row is ever emitted (AFM-001 key-dimension guard).
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM host_metrics
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
    ORDER BY host_id, collected_at DESC
  `;
}

/**
 * Build the latest-per-mount storage fragment for one host. Storage is 1:N per
 * tick (one row per mount), so the entity key is (host_id, mount_point).
 */
export function buildLatestHostStorageSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id, mount_point) *
    FROM host_storage
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
    ORDER BY host_id, mount_point, collected_at DESC
  `;
}

/**
 * Fleet-wide latest host vitals, driven from the `hosts` DIMENSION via LEFT JOIN
 * so a declared-but-never-reported host returns a row with NULL facts → reads as
 * no-data (SC#4), not silently absent. The inner DISTINCT ON keeps latest-per-host.
 */
function buildFleetLatestHostMetricsSql(): SQL {
  return sql`
    SELECT
      h.host_id, h.hostname,
      m.collected_at, m.cpu_pct, m.load_1, m.load_5, m.load_15,
      m.mem_total_kb, m.mem_available_kb, m.swap_total_kb, m.swap_free_kb,
      m.uptime_seconds, m.net_rx_bytes, m.net_tx_bytes
    FROM hosts h
    LEFT JOIN (
      SELECT DISTINCT ON (host_id) *
      FROM host_metrics
      WHERE host_id IS NOT NULL
      ORDER BY host_id, collected_at DESC
    ) m ON m.host_id = h.host_id
    ORDER BY h.host_id
  `;
}

/** Fleet-wide latest per-mount storage (DISTINCT ON (host_id, mount_point)). */
function buildFleetLatestHostStorageSql(): SQL {
  return sql`
    SELECT DISTINCT ON (host_id, mount_point) *
    FROM host_storage
    WHERE host_id IS NOT NULL
    ORDER BY host_id, mount_point, collected_at DESC
  `;
}

/**
 * Read-time D-13 staleness: a row older than the collector window is stale; a
 * host with no fact row (null `collectedAt`) is treated as stale / no-data. Pure
 * (no DB) so it is unit-tested directly. NO stored stale flag is consulted.
 */
export function deriveStale(collectedAt: Date | null, maxAgeMs = COLLECTOR_WINDOW_MS): boolean {
  if (collectedAt == null) return true;
  return Date.now() - collectedAt.getTime() > maxAgeMs;
}

/**
 * Latest host vitals + per-mount storage for every DECLARED host. One entry per
 * host_id (latest-per-host via DISTINCT ON); never-reported hosts surface as
 * no-data; staleness derived at read time. Reads the RW `dbNodemon` client.
 */
export async function getLatestHostMetrics(): Promise<HostMetricsView[]> {
  // Lazy import keeps the server-only `dbNodemon` client (postgres() pool +
  // requireEnv at module load) out of the no-DB shape test's import graph.
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const metricRows = (await dbNodemon.execute(
    buildFleetLatestHostMetricsSql(),
  )) as unknown as (LatestHostMetricsRow & { hostname: string | null })[];
  const storageRows = (await dbNodemon.execute(
    buildFleetLatestHostStorageSql(),
  )) as unknown as LatestHostStorageRow[];

  // Group latest storage rows per host (coercing collected_at to a real Date).
  const storageByHost = new Map<string, LatestHostStorageRow[]>();
  for (const s of storageRows) {
    const coerced: LatestHostStorageRow = {
      ...s,
      collected_at: parseDbTimestampUtc(s.collected_at as Date | string | null),
    };
    const arr = storageByHost.get(s.host_id) ?? [];
    arr.push(coerced);
    storageByHost.set(s.host_id, arr);
  }

  return metricRows.map((row) => {
    const { hostname, ...metricCols } = row;
    const collectedAt = parseDbTimestampUtc(row.collected_at as Date | string | null);
    const hasData = collectedAt != null;
    const metrics: LatestHostMetricsRow | null = hasData
      ? { ...metricCols, collected_at: collectedAt }
      : null;
    return {
      hostId: row.host_id,
      hostname: hostname ?? null,
      collectedAt,
      stale: deriveStale(collectedAt),
      hasData,
      metrics,
      storage: storageByHost.get(row.host_id) ?? [],
    };
  });
}
