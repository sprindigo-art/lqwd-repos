import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// AFM-001 — the two-axis service-health latest-per-service read (TEL-02)
// =====================================================
// `service_health` is APPEND-HISTORY: every collector tick emits a fresh row per
// (host_id, service_name). The latest state of each service is its newest row by
// `collected_at` — so the sanctioned read is DISTINCT ON the per-service key:
//
//   ✅  SELECT DISTINCT ON (host_id, service_name) ... ORDER BY host_id, service_name, collected_at DESC
//   ❌  WHERE collected_at = (SELECT MAX(collected_at) ...)   ← the AFM-001 N-read-as-1 failure
//
// The query is INVENTORY-DRIVEN: it selects FROM `service_inventory` LEFT JOIN
// `service_health` USING (host_id, service_name). Driving from the declared
// inventory means a service that is declared but has NEVER reported a fact row
// still appears — as a NO-DATA row (every service_health column NULL), not as an
// absent row (SC#4). The USING join also keeps `host_id`/`service_name`
// unqualified so the DISTINCT ON references the merged (left-table) key, never a
// NULL right-side key (the AFM-001 NULL-key collapse).
//
// This module is the single centralized path so neither the MAX( landmine nor
// the absent-vs-no-data mistake can reappear in a consumer. The host key is
// ALWAYS parameter-bound (Drizzle `sql` template), never string-concatenated
// (SQL-injection mitigation, T-11-11).

/**
 * Typed shape of one raw row returned by {@link buildServiceHealthSql}. Inventory
 * columns always populate (the declared service); the `sh.*` columns are NULL for
 * a declared-but-never-reported service (no-data). Timestamps surface as ISO
 * strings from raw `.execute()` (drizzle overrides postgres-js parsers) — coerced
 * via parseDbTimestampUtc in the derivation layer.
 */
export interface ServiceHealthRow {
  host_id: string;
  service_name: string;
  // service_inventory side (declared) — always present.
  inventory_node_pubkey: string | null;
  detection_method: string | null;
  expected_interval_seconds: number | null;
  is_expected: boolean | null;
  // service_health side (observed) — NULL when the service has never reported.
  node_pubkey: string | null;
  collected_at: Date | string | null;
  running: boolean | null;
  functioning: boolean | null;
  last_success_at: Date | string | null;
  last_artifact_mtime: Date | string | null;
  error_count: number | null;
  detail: string | null;
}

/**
 * Build the AFM-001 DISTINCT ON (host_id, service_name) latest-per-service
 * fragment for one host. Exposed separately so the no-DB shape test can assert
 * the emitted SQL without a live nodemon connection. `hostId` is bound ($1), not
 * interpolated. The LEFT JOIN USING (host_id, service_name) is inventory-driven
 * so declared-but-silent services survive as no-data (SC#4).
 */
export function buildServiceHealthSql(hostId: string): SQL {
  // `service_name IS NOT NULL` guards the AFM-001 NULL-key collapse: DISTINCT ON
  // would fold every NULL-keyed inventory row into a single output row.
  return sql`
    SELECT DISTINCT ON (host_id, service_name)
      host_id,
      service_name,
      si.node_pubkey AS inventory_node_pubkey,
      si.detection_method,
      si.expected_interval_seconds,
      si.is_expected,
      sh.node_pubkey,
      sh.collected_at,
      sh.running,
      sh.functioning,
      sh.last_success_at,
      sh.last_artifact_mtime,
      sh.error_count,
      sh.detail
    FROM service_inventory si
    LEFT JOIN service_health sh USING (host_id, service_name)
    WHERE host_id = ${hostId}
      AND service_name IS NOT NULL
    ORDER BY host_id, service_name, sh.collected_at DESC NULLS LAST
  `;
}

/**
 * Latest two-axis row for every declared service on a host — the only sanctioned
 * latest-state read of this append-history table (AFM-001). Reads `dbNodemon`
 * (the local telemetry DB), NOT a warehouse. Lazy-imports the server-only client
 * so importing this module for `buildServiceHealthSql` alone never spins up a
 * connection (the no-DB shape test + the skipIf seeded gate depend on this).
 */
export async function getServiceHealthRows(hostId: string): Promise<ServiceHealthRow[]> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const result = await dbNodemon.execute(buildServiceHealthSql(hostId));
  // postgres-js returns the rows array directly; drizzle .execute surfaces it as-is.
  return result as unknown as ServiceHealthRow[];
}

// =====================================================
// Read-time two-axis + per-service-freshness derivation (D-13/D-14/D-17)
// =====================================================
// All staleness is DERIVED here from raw timestamps — NOTHING about staleness is
// stored (D-14: the row carries only the observed booleans + the two clocks).
// There are TWO distinct clocks and conflating them is RESEARCH Pitfall 1:
//
//   • FUNCTIONING-freshness (per-service): judged against the service's OWN
//     `expected_interval_seconds × grace` on `last_artifact_mtime` (D-17). A
//     6-hourly batch whose artifact is 20 min old is NOT stale; the same service
//     at 20 h IS. This is what folds into the FUNCTIONING axis.
//   • COLLECTOR-freshness (~15 min): judged on `collected_at` — did the collector
//     itself run? Reported SEPARATELY (`collectorStale`) and NEVER downs a batch
//     service (a fresh collector tick still carries an old batch artifact mtime).

/** ~15-min collector-freshness window (D-13) — collector liveness, NOT service liveness. */
export const COLLECTOR_WINDOW_MS = 15 * 60 * 1000;
/** Grace multiplier on a service's expected_interval before it reads functioning-stale (RESEARCH: 2–3×). */
export const FUNCTIONING_GRACE = 2;

/** Derived two-axis state for one declared service. `green` is the running ∧ functioning invariant. */
export interface ServiceHealthState {
  hostId: string;
  serviceName: string;
  nodePubkey: string | null;
  /** RUNNING axis — the native process/probe is up. */
  running: boolean;
  /** FUNCTIONING axis — the probe says functioning AND it is not functioning-stale. */
  functioning: boolean;
  /** Green ONLY when both axes are true (the "up but dead" guard). */
  green: boolean;
  /** Per-service functioning-staleness (expected_interval_seconds × grace clock, D-17). */
  stale: boolean;
  /** Collector-freshness on collected_at (~15 min) — SEPARATE; does not down the service. */
  collectorStale: boolean;
  /** Declared in inventory but zero observed fact rows (LEFT JOIN miss, SC#4). */
  noData: boolean;
  lastSuccessAt: Date | null;
  lastArtifactMtime: Date | null;
  collectedAt: Date | null;
  errorCount: number;
  expectedIntervalSeconds: number | null;
  /**
   * Probe-supplied reason a service is not-functioning/critical. Honestly NULL for
   * the live LND fleet (running=true / functioning=false with no detail) — consumers
   * MUST render an honest fallback and NEVER fabricate a reason from it.
   */
  detail: string | null;
  /** Inventory-side detection_method (systemd/probe/…) — always present, passed through raw. */
  detectionMethod: string | null;
}

/**
 * Pure read-time derivation of the two-axis state from one raw row. Same
 * (row, now) → same state (no DB, no hidden clock) so a row is judged by the
 * CURRENT freshness rule every read (D-13/D-14). Timestamps are coerced via
 * parseDbTimestampUtc (offset-less warehouse/nodemon strings are UTC, WR-01).
 *
 * - No observed row (collected_at NULL) → no-data (declared-but-silent, SC#4),
 *   never a false DOWN.
 * - FUNCTIONING = probe-functioning AND not functioning-stale. Functioning-
 *   staleness uses the service's OWN expected_interval_seconds × grace on
 *   last_artifact_mtime — the per-service clock, NOT the 15-min collector window.
 *   With no interval or no artifact mtime there is no per-service clock to apply,
 *   so the probe alone drives the axis (persistent procs without a batch artifact).
 * - GREEN = running AND functioning (the unmistakable "up but dead" guard).
 */
export function deriveServiceHealth(
  row: ServiceHealthRow,
  nowMs: number = Date.now(),
): ServiceHealthState {
  const collectedAt = parseDbTimestampUtc(row.collected_at);
  const lastSuccessAt = parseDbTimestampUtc(row.last_success_at);
  const lastArtifactMtime = parseDbTimestampUtc(row.last_artifact_mtime);
  const expectedIntervalSeconds = row.expected_interval_seconds;

  // D-svc (18-03/HARDEN-01): attribution = observed pubkey, else the INVENTORY
  // declaration. A declared-but-silent node-scoped service (broken collector →
  // sh.node_pubkey NULL) must still land on its node's grid, not be misfiled as
  // host-level infra. Applied in BOTH branches below.
  const nodePubkey = row.node_pubkey ?? row.inventory_node_pubkey;

  // No-data: the LEFT JOIN found no service_health row (collected_at is the join
  // witness). Declared-but-never-reported reads as no-data, not absent (SC#4).
  if (collectedAt == null) {
    return {
      hostId: row.host_id,
      serviceName: row.service_name,
      nodePubkey,
      running: false,
      functioning: false,
      green: false,
      stale: false,
      collectorStale: false,
      noData: true,
      lastSuccessAt: null,
      lastArtifactMtime: null,
      collectedAt: null,
      errorCount: row.error_count ?? 0,
      expectedIntervalSeconds,
      detail: row.detail,
      detectionMethod: row.detection_method,
    };
  }

  const running = row.running === true;
  const functioningProbe = row.functioning === true;

  // Per-service functioning-staleness (D-17). Only computable with both an
  // expected interval AND an artifact mtime; otherwise the probe stands alone.
  let stale = false;
  if (expectedIntervalSeconds != null && lastArtifactMtime != null) {
    const ageMs = nowMs - lastArtifactMtime.getTime();
    stale = ageMs > expectedIntervalSeconds * FUNCTIONING_GRACE * 1000;
  }

  // FUNCTIONING axis: green only when the probe is functioning AND not stale.
  const functioning = functioningProbe && !stale;

  // Collector-freshness — separate clock on collected_at; never folded in above.
  const collectorStale = nowMs - collectedAt.getTime() > COLLECTOR_WINDOW_MS;

  return {
    hostId: row.host_id,
    serviceName: row.service_name,
    nodePubkey,
    running,
    functioning,
    green: running && functioning,
    stale,
    collectorStale,
    noData: false,
    lastSuccessAt,
    lastArtifactMtime,
    collectedAt,
    errorCount: row.error_count ?? 0,
    expectedIntervalSeconds,
    detail: row.detail,
    detectionMethod: row.detection_method,
  };
}

/**
 * Two-axis health for every declared service on a host: the AFM-001 latest-per-
 * service read (getServiceHealthRows) mapped through the pure derivation. Up-but-
 * dead reads not-functioning; never-reported reads no-data; functioning-freshness
 * uses each service's own expected_interval_seconds (TEL-02 headline deliverable).
 */
export async function getServiceHealth(
  hostId: string,
  nowMs: number = Date.now(),
): Promise<ServiceHealthState[]> {
  const rows = await getServiceHealthRows(hostId);
  return rows.map((r) => deriveServiceHealth(r, nowMs));
}
