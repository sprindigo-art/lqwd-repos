import { inArray } from "drizzle-orm";
import {
  hosts,
  serviceInventory,
  hostMetrics,
  hostStorage,
  serviceHealth,
  chainTelemetry,
} from "@/lib/db/schema/nodemon";

// =====================================================
// telemetry-fixture — deterministic seed/teardown for the test nodemon DB
// =====================================================
// Provisions the read-side scenarios the Plan-04/05 helper tests assert against,
// then tears them down. Each scenario is keyed by a per-run test host_id so runs
// are ISOLATED and the seed is IDEMPOTENT (seed cleans first, then inserts).
//
// Scenarios (RESEARCH §Threshold/staleness + VALIDATION SC#4):
//   FRESH        — host whose latest host_metrics/chain_telemetry is `now`
//                  (must read healthy + non-stale).
//   STALE        — host whose latest reading is now-30min, well past the ~15-min
//                  collector-freshness window (must read STALE — D-13).
//   NEVER-REPORTED — host DECLARED in `hosts` + a declared `service_inventory`
//                  row with ZERO fact rows (no-data, not "missing"; SC#4).
//   UP-BUT-DEAD  — service_health running=true, functioning=false (two-axis),
//                  alongside a fresh-and-healthy service on the same host.
//   PER-SERVICE-CLOCK — a batch service whose last_artifact_mtime is older than
//                  the 15-min collector clock but WITHIN its own
//                  expected_interval_seconds (D-17): must NOT read stale.
//
// IMPORTANT — no DB at module load: the server-only `dbNodemon` client constructs
// a postgres() pool and calls requireEnv() at import time, so it is LAZY-imported
// INSIDE the exported functions (mirrors src/lib/read/latest.ts). Importing this
// helper for its types/constants alone never spins up a connection — the
// describe.skipIf(!process.env.NODEMON_QUEUE_URL) gate then skips cleanly with no DB.
//
// All writes go through Drizzle `.insert().values()` — parameter-bound by
// construction, never string-concatenated SQL (AFM-001 discipline). Tests run as
// the schema OWNER (not the RLS-scoped read role), so these inserts are permitted.

// ~15-min collector-freshness window (D-13). Stale rows sit well beyond it.
const COLLECTOR_WINDOW_MS = 15 * 60 * 1000;
const STALE_OFFSET_MS = 30 * 60 * 1000; // 2× the window — unambiguously stale
const BATCH_INTERVAL_SECONDS = 3600; // per-service clock (D-17): 60-min batch cadence
const BATCH_ARTIFACT_AGE_MS = 20 * 60 * 1000; // >15-min window but < 60-min interval

/** Host ids + service names a single seeded run produced (keyed by `key`). */
export interface SeededTelemetry {
  /** Host whose latest readings are fresh (now). */
  freshHostId: string;
  /** Host whose latest readings are 30 min old (reads stale). */
  staleHostId: string;
  /** Declared-but-silent host: in `hosts` + `service_inventory`, zero facts. */
  neverReportedHostId: string;
  /** All host ids this run touched (for assertions / scoped cleanup). */
  allHostIds: string[];
  upButDeadService: string;
  healthyService: string;
  batchService: string;
  collectedAtFresh: Date;
  collectedAtStale: Date;
  batchArtifactMtime: Date;
}

function ids(key: string) {
  return {
    freshHostId: `nodemon-test-${key}-fresh`,
    staleHostId: `nodemon-test-${key}-stale`,
    neverReportedHostId: `nodemon-test-${key}-silent`,
  };
}

/**
 * Remove every fixture row for `key` across all dimension + fact tables. Safe to
 * call before a seed (idempotency) and in test teardown. Scoped strictly to the
 * test host ids so it can never touch real telemetry.
 */
export async function cleanupTelemetryFixture(key = "default"): Promise<void> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { freshHostId, staleHostId, neverReportedHostId } = ids(key);
  const hostIds = [freshHostId, staleHostId, neverReportedHostId];

  // Facts first, then dimensions (no FK between them today, but order is the
  // safe convention if references are added later).
  await dbNodemon.delete(hostMetrics).where(inArray(hostMetrics.hostId, hostIds));
  await dbNodemon.delete(hostStorage).where(inArray(hostStorage.hostId, hostIds));
  await dbNodemon.delete(serviceHealth).where(inArray(serviceHealth.hostId, hostIds));
  await dbNodemon.delete(chainTelemetry).where(inArray(chainTelemetry.hostId, hostIds));
  await dbNodemon.delete(serviceInventory).where(inArray(serviceInventory.hostId, hostIds));
  await dbNodemon.delete(hosts).where(inArray(hosts.hostId, hostIds));
}

/**
 * Seed all read-side scenarios for `key` and return the descriptor the helper
 * tests assert against. Idempotent: cleans up `key` first, then inserts. The
 * timestamps are computed relative to "now" so freshness derives correctly at
 * read time (D-13) — nothing about staleness is stored.
 */
export async function seedTelemetryFixture(key = "default"): Promise<SeededTelemetry> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  await cleanupTelemetryFixture(key);

  const { freshHostId, staleHostId, neverReportedHostId } = ids(key);
  const now = Date.now();
  const collectedAtFresh = new Date(now);
  const collectedAtStale = new Date(now - STALE_OFFSET_MS);
  const batchArtifactMtime = new Date(now - BATCH_ARTIFACT_AGE_MS);

  const upButDeadService = "rebalancer"; // up-but-dead: running yet not functioning
  const healthyService = "lnd"; // fresh-and-healthy reference
  const batchService = "nodeAuditor"; // batch (per-service-clock) service

  // ── Dimensions ────────────────────────────────────────────────────────────
  await dbNodemon.insert(hosts).values([
    { hostId: freshHostId, hostname: "fresh-host", nodePubkeys: ["02fresh"] },
    { hostId: staleHostId, hostname: "stale-host", nodePubkeys: ["02stale"] },
    // NEVER-REPORTED: declared in the dimension, never sends a fact row.
    {
      hostId: neverReportedHostId,
      hostname: "silent-host",
      nodePubkeys: ["02silent"],
    },
  ]);

  await dbNodemon.insert(serviceInventory).values([
    {
      hostId: freshHostId,
      serviceName: healthyService,
      detectionMethod: "systemctl",
      runningTarget: "lnd.service",
      expectedIntervalSeconds: null,
      isExpected: true,
    },
    {
      hostId: freshHostId,
      serviceName: upButDeadService,
      detectionMethod: "pgrep",
      runningTarget: "rebalancer",
      expectedIntervalSeconds: null,
      isExpected: true,
    },
    {
      hostId: freshHostId,
      serviceName: batchService,
      detectionMethod: "cron-mtime",
      artifactPath: "/lnd/nodemon/nodeAuditor.log",
      // PER-SERVICE CLOCK (D-17): a 60-min batch is NOT stale at 20-min age.
      expectedIntervalSeconds: BATCH_INTERVAL_SECONDS,
      isExpected: true,
    },
    // NEVER-REPORTED declared service on the silent host — zero service_health facts.
    {
      hostId: neverReportedHostId,
      serviceName: healthyService,
      detectionMethod: "systemctl",
      runningTarget: "lnd.service",
      expectedIntervalSeconds: null,
      isExpected: true,
    },
  ]);

  // ── FRESH host facts (collected_at = now) ──────────────────────────────────
  await dbNodemon.insert(hostMetrics).values({
    hostId: freshHostId,
    collectedAt: collectedAtFresh,
    cpuPct: "12.5",
    load1: "0.40",
    load5: "0.35",
    load15: "0.30",
    memTotalKb: 32_000_000n,
    memAvailableKb: 16_000_000n, // ~50% available → healthy band
    swapTotalKb: 0n,
    swapFreeKb: 0n,
    uptimeSeconds: 864_000n,
    netRxBytes: 1_073_741_824n,
    netTxBytes: 536_870_912n,
  });
  await dbNodemon.insert(hostStorage).values({
    hostId: freshHostId,
    collectedAt: collectedAtFresh,
    mountPoint: "/",
    totalBytes: 1_099_511_627_776n, // 1 TiB
    usedBytes: 549_755_813_888n, // 50% used → 50% free, healthy
    availBytes: 549_755_813_888n,
  });
  await dbNodemon.insert(chainTelemetry).values({
    hostId: freshHostId,
    collectedAt: collectedAtFresh,
    blocks: 880_000n,
    headers: 880_000n, // 0 blocks behind → healthy
    verificationProgress: "0.99999",
    ibd: false,
    sizeOnDiskBytes: 700_000_000_000n,
    peerCount: 12,
    peersIn: 6,
    peersOut: 6,
    mempoolTxCount: 1500,
    mempoolBytes: 12_000_000n,
    mempoolMinFee: "0.00001",
  });

  // ── STALE host facts (collected_at = now - 30 min → reads stale, D-13) ──────
  await dbNodemon.insert(hostMetrics).values({
    hostId: staleHostId,
    collectedAt: collectedAtStale,
    cpuPct: "20.0",
    load1: "0.50",
    load5: "0.45",
    load15: "0.40",
    memTotalKb: 32_000_000n,
    memAvailableKb: 8_000_000n,
    swapTotalKb: 0n,
    swapFreeKb: 0n,
    uptimeSeconds: 432_000n,
    netRxBytes: 2_147_483_648n,
    netTxBytes: 1_073_741_824n,
  });
  await dbNodemon.insert(chainTelemetry).values({
    hostId: staleHostId,
    collectedAt: collectedAtStale,
    blocks: 879_998n,
    headers: 880_000n, // 2 blocks behind, but the whole reading is stale anyway
    verificationProgress: "0.99998",
    ibd: false,
    sizeOnDiskBytes: 700_000_000_000n,
    peerCount: 9,
    peersIn: 4,
    peersOut: 5,
    mempoolTxCount: 1200,
    mempoolBytes: 10_000_000n,
    mempoolMinFee: "0.00001",
  });

  // ── service_health (two-axis) on the FRESH host ────────────────────────────
  await dbNodemon.insert(serviceHealth).values([
    // FRESH-AND-HEALTHY: running AND functioning, just observed.
    {
      hostId: freshHostId,
      serviceName: healthyService,
      nodePubkey: "02fresh",
      collectedAt: collectedAtFresh,
      running: true,
      functioning: true,
      lastSuccessAt: collectedAtFresh,
      lastArtifactMtime: collectedAtFresh,
      errorCount: 0,
      detail: "fresh-and-healthy",
    },
    // UP-BUT-DEAD: process is up (running=true) but NOT functioning (false).
    {
      hostId: freshHostId,
      serviceName: upButDeadService,
      nodePubkey: "02fresh",
      collectedAt: collectedAtFresh,
      running: true,
      functioning: false,
      lastSuccessAt: new Date(now - STALE_OFFSET_MS),
      lastArtifactMtime: new Date(now - STALE_OFFSET_MS),
      errorCount: 17,
      detail: "up-but-dead",
    },
    // PER-SERVICE-CLOCK: a 60-min batch whose artifact is 20 min old — past the
    // 15-min collector window but WITHIN expected_interval_seconds → NOT stale.
    {
      hostId: freshHostId,
      serviceName: batchService,
      nodePubkey: null,
      collectedAt: collectedAtFresh,
      running: true,
      functioning: true,
      lastSuccessAt: batchArtifactMtime,
      lastArtifactMtime: batchArtifactMtime,
      errorCount: 0,
      detail: "batch-within-its-own-interval",
    },
  ]);

  return {
    freshHostId,
    staleHostId,
    neverReportedHostId,
    allHostIds: [freshHostId, staleHostId, neverReportedHostId],
    upButDeadService,
    healthyService,
    batchService,
    collectedAtFresh,
    collectedAtStale,
    batchArtifactMtime,
  };
}

/** Freshness constants the helper tests may reuse to assert staleness math. */
export const FIXTURE_CONSTANTS = {
  COLLECTOR_WINDOW_MS,
  STALE_OFFSET_MS,
  BATCH_INTERVAL_SECONDS,
  BATCH_ARTIFACT_AGE_MS,
} as const;

// Re-export the scoped delete helper under an alias for symmetry in tests.
export { cleanupTelemetryFixture as teardownTelemetryFixture };
