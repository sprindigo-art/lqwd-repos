import "server-only";

import type { FleetCounts } from "@/components/df/NavRailShell";
import type { Severity } from "@/components/df/Severity";
import { getChainTelemetry, type ChainTelemetryView } from "@/lib/read/chain-telemetry";
import {
  deriveStale,
  getLatestHostMetrics,
  type HostMetricsView,
} from "@/lib/read/host-metrics";
import { getServiceHealth, type ServiceHealthState } from "@/lib/read/service-health";
import { loadFleetView } from "@/lib/scorecard/fleet";
import type { FleetView, ScorecardView } from "@/lib/scorecard/types";

import { applyFreshnessCutoff } from "./freshness-cutoff";
import { severityFromBand, severityFromService, worstSeverity } from "./severity-map";

// =====================================================
// fleet-counts.ts — REAL top-bar ramp/tally counts for detail pages (U2)
// =====================================================
// NavRailShell no longer fabricates an all-clear `{ok: 26}` baseline — every
// page that shows the fleet summary must supply REAL counts. The overview
// derives its counts inside its own memoized pipeline; the incident- and
// host-detail pages have no such pipeline, so this loader gives them the same
// ALL-LAYER reduction (B3: a downed host with healthy nodes must not read
// "all ok") without importing the overview page module.
//
// The per-layer single-rung reducers below deliberately MIRROR the private
// reducers in (overview)/page.tsx (Pitfall 4: ONE df Severity per entity
// BEFORE counting; stale stays out of the 4-bucket ramp). They are duplicated
// rather than imported because page.tsx does not export them and carries
// unrelated in-flight work — consolidate when the overview pipeline is
// extracted to a lib.
//
// FAIL-SOFT + HONEST: every read carries its own `.catch`; a TOTAL failure
// (no entities at all) returns `undefined`, and the shell then renders NO
// ramp — never a fabricated one.

/** scorecard node → df Severity: stale dominates; else the node's own `dot`. */
function nodeSeverity(node: ScorecardView): Severity {
  if (node.stale) return "stale";
  switch (node.dot) {
    case "critical":
      return "critical";
    case "warn":
      return "warning";
    case "ok":
      return "healthy";
  }
}

/** host metrics → df Severity: no band ships yet, so stale-or-healthy only. */
function hostSeverity(host: HostMetricsView): Severity {
  if (!host.hasData || host.stale) return "stale";
  return "healthy";
}

/** bitcoind chain → df Severity: stale dominates; else worst of present bands. */
function chainSeverity(chain: ChainTelemetryView): Severity {
  if (chain.stale || !chain.hasData) return "stale";
  const bands = [chain.bands.blocksBehind, chain.bands.verificationProgress, chain.bands.peers]
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .map((b) => severityFromBand(b.band));
  return worstSeverity(bands);
}

/** storage mount → df Severity: no time-to-full band yet, so stale-or-healthy. */
function storageSeverity(collectedAt: Date | null): Severity {
  return deriveStale(collectedAt) ? "stale" : "healthy";
}

/**
 * Sum already-reduced per-entity rungs into the four ramp buckets. Stale rungs
 * stay OUT of the ramp (unchanged overview semantics) — staleness is reported
 * by the honest freshness stamps, not by the severity pulse.
 */
export function reduceFleetCounts(severities: Severity[]): FleetCounts {
  return severities.reduce<FleetCounts>(
    (acc, sev) => ({
      crit: acc.crit + (sev === "critical" ? 1 : 0),
      warn: acc.warn + (sev === "warning" ? 1 : 0),
      watch: acc.watch + (sev === "watch" ? 1 : 0),
      ok: acc.ok + (sev === "healthy" ? 1 : 0),
    }),
    { crit: 0, warn: 0, watch: 0, ok: 0 },
  );
}

/** ~20s memo window — mirrors the overview memo TTL (T-12-12-01-safe). */
const FLEET_COUNTS_TTL_MS = 20_000;

interface FleetCountsCacheEntry {
  at: number;
  promise: Promise<FleetCounts | undefined>;
}

const globalForFleetCounts = globalThis as unknown as {
  _fleetCountsCache?: FleetCountsCacheEntry;
};

/**
 * Load REAL all-layer fleet counts for the top-bar ramp/tally, through a short
 * constant-keyed in-process memo (an EPHEMERAL perf cache, mirrors the overview
 * memo — nothing persisted). Returns `undefined` when no entity produced a rung
 * (total read failure / empty fleet) so callers omit the summary honestly.
 */
export function loadFleetCounts(): Promise<FleetCounts | undefined> {
  const now = Date.now();
  const cached = globalForFleetCounts._fleetCountsCache;
  if (cached !== undefined && now - cached.at < FLEET_COUNTS_TTL_MS) {
    return cached.promise;
  }

  const entry: FleetCountsCacheEntry = { at: now, promise: computeFleetCounts() };
  globalForFleetCounts._fleetCountsCache = entry;
  // Evict on failure so the next load retries (only if OUR entry is current).
  entry.promise.catch(() => {
    if (globalForFleetCounts._fleetCountsCache === entry) {
      globalForFleetCounts._fleetCountsCache = undefined;
    }
  });
  return entry.promise;
}

/** The uncached pipeline: fail-soft reads → 30-day cutoff → all-layer reduce. */
async function computeFleetCounts(): Promise<FleetCounts | undefined> {
  const hosts0 = await getLatestHostMetrics().catch(() => [] as HostMetricsView[]);

  const [chain0, fleet] = await Promise.all([
    getChainTelemetry().catch(() => [] as ChainTelemetryView[]),
    loadFleetView().catch(
      () => ({ nodes: [] as ScorecardView[], fetchedAt: new Date() }) as FleetView,
    ),
  ]);

  const serviceArrays = await Promise.all(
    hosts0.map((h) => getServiceHealth(h.hostId).catch(() => [] as ServiceHealthState[])),
  );
  const services0 = serviceArrays.flat();

  // LOCKED 30-day cutoff (backlog #8) — dead entities leave the denominators.
  const nodes = applyFreshnessCutoff(fleet.nodes, (n) => n.asOf);
  const hosts = applyFreshnessCutoff(hosts0, (h) => h.collectedAt);
  const chain = applyFreshnessCutoff(chain0, (c) => c.collectedAt);
  const services = applyFreshnessCutoff(services0, (s) => s.collectedAt);

  // OQ2 / D-07: bitcoind denominator = ONLY hosts that declare bitcoind.
  const bitcoindHostIds = new Set(
    services.filter((s) => s.serviceName.toLowerCase() === "bitcoind").map((s) => s.hostId),
  );

  const severities: Severity[] = [
    ...nodes.map(nodeSeverity),
    ...hosts.map(hostSeverity),
    ...services.map(severityFromService),
    ...chain.filter((c) => bitcoindHostIds.has(c.hostId)).map(chainSeverity),
    ...hosts.flatMap((host) => host.storage.map((m) => storageSeverity(m.collected_at))),
  ];

  // No rungs at all → no REAL counts exist; the shell omits the summary.
  if (severities.length === 0) return undefined;
  return reduceFleetCounts(severities);
}
