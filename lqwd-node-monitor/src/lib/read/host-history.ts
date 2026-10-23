import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import type { StorageGrowthSample } from "@/lib/read/storage-growth";

// =====================================================
// HOST-02 — bounded time-window history reads (host_metrics / host_storage)
// =====================================================
// These are the HISTORY complements to the latest-per-entity reads in
// host-metrics.ts: plain BOUNDED SCANS ordered ascending by `collected_at`,
// feeding the HOST-02 vitals sparklines and the storage growth projection
// (`computeStorageGrowth` in storage-growth.ts).
//
//   ✅  WHERE host_id = $1 AND collected_at > (now() AT TIME ZONE 'UTC') - make_interval(...) ORDER BY collected_at ASC
//   ❌  DISTINCT ON — that is the LATEST pattern (host-metrics.ts), not history
//   ❌  WHERE collected_at = (SELECT MAX(...)) — the AFM-001 480-read-as-1 landmine
//
// `hostId` is ALWAYS parameter-bound via the Drizzle `sql` template, never
// string-concatenated (T-14-03). The window is MANDATORY and bound as seconds
// (T-14-05 — no unbounded full-table scan is expressible through this module).
// Reads go through the RW `dbNodemon` client via LAZY import so the no-DB
// shape test's import graph stays clean of the postgres() pool.

/** Default history window: 24h (UI-SPEC B3 sparkline window; A2 row-count bound). */
const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** One vitals observation for sparkline series (coerced: Date + numbers). */
export interface HostMetricsHistoryPoint {
  collectedAt: Date;
  cpuPct: number | null;
  memTotalKb: number | null;
  memAvailableKb: number | null;
}

/** Raw-execute row shape from `host_metrics` (Pitfall 3: strings surface raw). */
interface RawMetricsHistoryRow {
  host_id: string;
  collected_at: Date | string | null;
  cpu_pct: string | number | null;
  mem_total_kb: bigint | string | number | null;
  mem_available_kb: bigint | string | number | null;
}

/** Raw-execute row shape from `host_storage`. */
interface RawStorageHistoryRow {
  host_id: string;
  collected_at: Date | string | null;
  mount_point: string | null;
  used_bytes: bigint | string | number | null;
  total_bytes: bigint | string | number | null;
}

/**
 * Build the bounded vitals-history scan for one host. Exposed separately so
 * the no-DB shape test asserts the emitted SQL without a live connection.
 * `hostId` is bound ($1); the window is bound as seconds — never interpolated.
 */
export function buildHostMetricsHistorySql(hostId: string, windowMs: number): SQL {
  return sql`
    SELECT host_id, collected_at, cpu_pct, mem_total_kb, mem_available_kb
    FROM host_metrics
    WHERE host_id = ${hostId}
      AND collected_at > (now() AT TIME ZONE 'UTC') - make_interval(secs => ${windowMs / 1000})
    ORDER BY collected_at ASC
  `;
}

/**
 * Build the bounded per-mount storage-history scan for one host. Same bounded
 * plain-scan properties over `host_storage` (mount_point / used / total bytes).
 */
export function buildHostStorageHistorySql(hostId: string, windowMs: number): SQL {
  return sql`
    SELECT host_id, collected_at, mount_point, used_bytes, total_bytes
    FROM host_storage
    WHERE host_id = ${hostId}
      AND collected_at > (now() AT TIME ZONE 'UTC') - make_interval(secs => ${windowMs / 1000})
    ORDER BY collected_at ASC
  `;
}

/** Number() coercion preserving null (raw .execute() surfaces numeric strings). */
function toNumberOrNull(v: bigint | string | number | null): number | null {
  return v == null ? null : Number(v);
}

/**
 * Vitals history for one host over the window (default 24h), ascending —
 * ready for the HOST-02 CPU/memory sparklines. Rows without a parseable
 * `collected_at` are dropped (a point without a time cannot chart).
 */
export async function getHostMetricsHistory(
  hostId: string,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<HostMetricsHistoryPoint[]> {
  // Lazy import keeps the server-only dbNodemon client (postgres() pool +
  // requireEnv at module load) out of the no-DB shape test's import graph.
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const rows = (await dbNodemon.execute(
    buildHostMetricsHistorySql(hostId, windowMs),
  )) as unknown as RawMetricsHistoryRow[];

  const points: HostMetricsHistoryPoint[] = [];
  for (const r of rows) {
    const collectedAt = parseDbTimestampUtc(r.collected_at);
    if (collectedAt == null) continue;
    points.push({
      collectedAt,
      cpuPct: toNumberOrNull(r.cpu_pct),
      memTotalKb: toNumberOrNull(r.mem_total_kb),
      memAvailableKb: toNumberOrNull(r.mem_available_kb),
    });
  }
  return points;
}

/**
 * Per-mount storage history for one host over the window (default 24h),
 * ascending per mount — each series is `computeStorageGrowth`-ready. Rows
 * missing a mount_point, timestamp, or byte column are dropped (a growth
 * sample needs all three to mean anything).
 */
export async function getHostStorageHistory(
  hostId: string,
  windowMs: number = DEFAULT_WINDOW_MS,
): Promise<Map<string, StorageGrowthSample[]>> {
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const rows = (await dbNodemon.execute(
    buildHostStorageHistorySql(hostId, windowMs),
  )) as unknown as RawStorageHistoryRow[];

  const byMount = new Map<string, StorageGrowthSample[]>();
  for (const r of rows) {
    if (r.mount_point == null) continue;
    const collectedAt = parseDbTimestampUtc(r.collected_at);
    const usedBytes = toNumberOrNull(r.used_bytes);
    const totalBytes = toNumberOrNull(r.total_bytes);
    if (collectedAt == null || usedBytes == null || totalBytes == null) continue;
    const arr = byMount.get(r.mount_point) ?? [];
    arr.push({ collectedAt, usedBytes, totalBytes });
    byMount.set(r.mount_point, arr);
  }
  return byMount;
}
