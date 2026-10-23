import "server-only";

import { backendFor } from "@/lib/config/backends";
import {
  latestNodeInfo,
  latestNodeInfoAll,
  type LatestNodeInfoRow,
} from "@/lib/read/node-info";
import { mapLndNode, type Backend } from "@/lib/read/nodes";
import {
  SCORECARD_CONFIG,
  STALENESS,
  type BackendConfig,
} from "@/lib/scorecard/config";
import {
  compositeOf,
  criticalChips,
  gradeDimension,
  gradeNoData,
  nodeDot,
  reasonFor,
} from "@/lib/scorecard/grade";
import { outlierFor } from "@/lib/scorecard/compare";
import { isStale, worstCaseAsOf } from "@/lib/scorecard/freshness";
import { routingForFleet } from "@/lib/scorecard/dimensions/routing";
import { revenueForFleet } from "@/lib/scorecard/dimensions/revenue";
import { liquidityForFleet } from "@/lib/scorecard/dimensions/liquidity";
import { channelHealthFromNodeInfo } from "@/lib/scorecard/dimensions/channel-health";
import { forceCloseForFleet } from "@/lib/scorecard/dimensions/force-close";
import { restartForFleet } from "@/lib/scorecard/dimensions/restart";
import { peerFromNodeInfo } from "@/lib/scorecard/dimensions/peer";
import {
  COMPUTABLE_DIMENSIONS,
  NO_DATA_DIMENSIONS,
  type DimensionKey,
  type DimensionResult,
  type FleetView,
  type GradedDimension,
  type PeerRelative,
  type ScorecardView,
} from "@/lib/scorecard/types";

// =====================================================
// FLEET-01/02/03 — the single server-side fleet assembly
// =====================================================
// loadFleetView() is THE one computation the pages render: latestNodeInfoAll
// (the only sanctioned lnd_node_info read, AFM-001) → 7 computed + 3 no-data
// dimensions → grades → per-backend MAD comparison → worst-case freshness →
// D-09 sort (criticals first, then worst grade). Bounded read (T-02-05):
// exactly 5 windowed aggregate queries + 1 DISTINCT ON snapshot per call —
// never a bare lnd_node_info select, regardless of table growth.
//
// server-only (T-02-02): this module imports backends.ts (process.env) and
// triggers warehouse reads. The pure helpers (assembleScorecard, sortFleet)
// are still exported for unit tests — vitest stubs the server-only import.

/** The 7 computable dimension keys (cfg-banded) — narrowing of DimensionKey. */
type ComputableKey = Exclude<DimensionKey, "stability" | "pgHealth" | "visibility">;

// COMPUTABLE_DIMENSIONS is declared as readonly DimensionKey[] in types.ts but
// contains exactly the 7 banded keys — narrow once here so cfg[key] type-checks.
const COMPUTABLE_KEYS = COMPUTABLE_DIMENSIONS as readonly ComputableKey[];

/** Node identity handed to assembleScorecard — backend already resolved via D-03. */
export interface ScorecardIdentity {
  pubkey: string;
  alias: string | null;
  backend: Backend;
}

/** Per-node dimension inputs: null where the fleet map had no row for the node. */
export type ScorecardInputs = Record<ComputableKey, DimensionResult | null>;

/** A fleet map miss is "no rows in window" no-data — NOT an error and NOT a zero. */
function resolveInput(result: DimensionResult | null): DimensionResult {
  return result ?? { raw: null, asOf: null, note: "no rows in window" };
}

/**
 * Pure per-node assembly (exported for unit tests): identity + 7 dimension
 * inputs + the backend's band config → a ScorecardView. peerRelative is left
 * null on every dimension — the cohort comparison needs the WHOLE fleet, so
 * loadFleetView attaches it in a second pass after all nodes are assembled.
 */
export function assembleScorecard(
  identity: ScorecardIdentity,
  inputs: ScorecardInputs,
  cfg: BackendConfig,
): ScorecardView {
  const resolved = {} as Record<ComputableKey, DimensionResult>;
  for (const key of COMPUTABLE_KEYS) {
    resolved[key] = resolveInput(inputs[key]);
  }

  // Canonical DimensionKey order: the 7 computable dims then the 3 no-data dims.
  const graded: GradedDimension[] = [
    ...COMPUTABLE_KEYS.map((key) => gradeDimension(key, resolved[key], cfg[key])),
    ...NO_DATA_DIMENSIONS.map((key) => gradeNoData(key)),
  ];

  // D-13 DEVIATION — restart EXCLUDED from the worst-case freshness floor.
  // D-13's letter is "the oldest of the latest timestamps across the tables its
  // scorecard depends on", which would include lnd_restart.last_restart. We
  // exclude restart because last_restart is LEGITIMATELY old on healthy nodes
  // (verified Canada >1yr — long uptime is the GOOD case, RESEARCH A5):
  // including it would permanently flag every healthy node "stale". The restart
  // asOf is NOT hidden — 02-07 surfaces it in the per-node freshness breakdown.
  // No-data dims (stability/pgHealth/visibility) carry no timestamps and are
  // excluded by definition. Flagged for operator sign-off at the 02-07 visual
  // checkpoint (see 02-06-SUMMARY.md).
  const asOf = worstCaseAsOf([
    resolved.routing.asOf,
    resolved.revenue.asOf,
    resolved.liquidity.asOf,
    resolved.channelHealth.asOf,
    resolved.forceClose.asOf,
    resolved.peer.asOf,
  ]);

  const composite = compositeOf(graded);

  return {
    pubkey: identity.pubkey,
    alias: identity.alias,
    backend: identity.backend,
    compositePct: composite?.pct ?? null,
    compositeLetter: composite?.letter ?? null,
    dot: nodeDot(graded),
    reason: reasonFor(graded, cfg),
    criticalChips: criticalChips(graded),
    dimensions: graded.map((d) => ({ ...d, peerRelative: null as PeerRelative | null })),
    asOf,
    stale: isStale(asOf, STALENESS.warnAfterHours),
  };
}

/**
 * D-09 sort (pure, non-mutating): criticals (dot === "critical") first — among
 * criticals, lowest compositePct first; then non-criticals by compositePct
 * ascending (worst grade first). A null compositePct sorts LAST within its
 * group (an ungradable node must not jump the triage queue).
 */
export function sortFleet(nodes: ScorecardView[]): ScorecardView[] {
  const group = (n: ScorecardView): number => (n.dot === "critical" ? 0 : 1);
  return [...nodes].sort((x, y) => {
    const byGroup = group(x) - group(y);
    if (byGroup !== 0) return byGroup;
    if (x.compositePct === null && y.compositePct === null) return 0;
    if (x.compositePct === null) return 1;
    if (y.compositePct === null) return -1;
    return x.compositePct - y.compositePct;
  });
}

/**
 * Comparison pass (D-10/D-11/D-12): per-backend, per-dimension MAD cohorts.
 * Cohort = every same-backend node with a non-null raw, INCLUDING self —
 * standard MAD practice (the median is robust to one member; excluding self
 * would give every node a different baseline and break "fleet median"
 * semantics). D-11 small-cohort suppression happens inside outlierFor: today's
 * single LDK node yields a cohort of ~1 → suppressed → "no peer baseline yet"
 * downstream. Nodes with a null raw keep peerRelative null (nothing to compare).
 * Outlier is a SEPARATE signal — it never alters the absolute grade (D-12).
 */
function attachPeerRelative(views: ScorecardView[]): void {
  const backends: readonly Backend[] = ["lnd", "ldk"];
  for (const backend of backends) {
    const cohortViews = views.filter((v) => v.backend === backend);
    if (cohortViews.length === 0) continue;
    const cfg = SCORECARD_CONFIG[backend];
    for (const key of COMPUTABLE_KEYS) {
      const cohort: number[] = [];
      for (const view of cohortViews) {
        const raw = view.dimensions.find((d) => d.key === key)?.raw;
        if (raw !== null && raw !== undefined) cohort.push(raw);
      }
      const direction = cfg[key].band.direction;
      for (const view of cohortViews) {
        const dim = view.dimensions.find((d) => d.key === key);
        if (!dim || dim.raw === null) continue;
        dim.peerRelative = outlierFor(dim.raw, cohort, direction);
      }
    }
  }
}

// ── Short-TTL read-through cache (PERF-02; mirrors engine.ts _insightViewCache)
// loadFleetView is on the critical path of every /[pubkey] console + modal AND
// runs (duplicated) once per cold overview. A bare call re-issues the full 6-
// query fleet read every navigation. This is the SAME promise-collapsing TTL
// memo the insight view already uses (operator-approved 2026-06-16): the first
// caller (or first after the window lapses) runs computeFleetView; concurrent
// and repeat callers within FLEET_TTL_MS reuse the in-flight/resolved promise;
// a rejected computation is evicted so the next load retries instead of pinning
// the error for the whole window. FLEET_TTL_MS === INSIGHT_TTL_MS (45s) so ONE
// fleet read serves both the scorecard views and the insight engine's reuse.
// `fetchedAt` stays the real compute stamp — FreshnessStamp/PollAge honesty
// holds (staleness display windows are hours; 45s is far under). EPHEMERAL perf
// cache only — nothing persisted (D-07 holds; the memo evaporates with the
// process), and a single long-running process makes a globalThis memo correct.
export const FLEET_TTL_MS = 45_000;

interface FleetCacheEntry {
  at: number;
  promise: Promise<FleetView>;
}

const globalForFleet = globalThis as unknown as { _fleetViewCache?: FleetCacheEntry };

/**
 * The single fleet computation the pages render, served through the short-TTL
 * memo above. Signature unchanged from the pre-PERF-02 bare `loadFleetView` —
 * every caller (including `cache(loadFleetView)` in [tab]/page.tsx) is untouched
 * and now transparently hits the memo.
 */
export async function loadFleetView(): Promise<FleetView> {
  const now = Date.now();
  const cached = globalForFleet._fleetViewCache;
  if (cached !== undefined && now - cached.at < FLEET_TTL_MS) {
    return cached.promise;
  }

  const promise = computeFleetView();
  const entry: FleetCacheEntry = { at: now, promise };
  globalForFleet._fleetViewCache = entry;
  // Evict on failure so the next navigation retries rather than serving a
  // pinned rejection for the whole TTL.
  promise.catch(() => {
    if (globalForFleet._fleetViewCache === entry) {
      globalForFleet._fleetViewCache = undefined;
    }
  });
  return promise;
}

/**
 * The single fleet computation the pages render: sorted (D-09), graded (D-05/
 * D-06/D-07), compared (D-10/D-11/D-12), freshness-stamped (D-13) ScorecardViews
 * for every node in the warehouse — in bounded queries (T-02-05).
 */
async function computeFleetView(): Promise<FleetView> {
  // 1+2. PERF-03 (waterfall B): the latest node-info snapshot (AFM-001 DISTINCT
  //    ON; the ONLY sanctioned lnd_node_info read, never a bare select on the
  //    append-only table) and the 5 fleet-wide dimension aggregates are mutually
  //    independent — the aggregates don't consume the node rows — so fire them
  //    all at once instead of awaiting the snapshot first. The 2 pure transforms
  //    (channelHealth, peer) reuse the node-info rows once they land.
  const [rows, [routingMap, revenueMap, liquidityMap, forceCloseMap, restartMap]] =
    await Promise.all([
      latestNodeInfoAll(),
      Promise.all([
        routingForFleet(),
        revenueForFleet(),
        liquidityForFleet(),
        forceCloseForFleet(),
        restartForFleet(),
      ]),
    ]);
  const nodeRows: LatestNodeInfoRow[] = rows.filter((r) => r.pubkey != null);
  const channelHealthMap = channelHealthFromNodeInfo(nodeRows);
  const peerMap = peerFromNodeInfo(nodeRows);

  // 3. Assemble per node. Backend label comes from backendFor(pubkey) — the
  //    operator config map (D-03) — NOT from which mapper ran: LDK rows arrive
  //    in routing_vm in the lnd_* table shape, so EVERY fleet row flows through
  //    mapLndNode and mapper provenance is meaningless as a backend signal.
  const views = nodeRows.map((row) => {
    const unified = mapLndNode({
      pubkey: row.pubkey,
      alias: row.alias,
      activeChannels: row.active_channels,
      inactiveChannels: row.inactive_channels,
      pendingChannels: row.pending_channels,
      localChannelBalance: row.local_channel_balance,
      remoteChannelBalance: row.remote_channel_balance,
    });
    const backend = backendFor(unified.pubkey); // D-03 override after mapping
    return assembleScorecard(
      { pubkey: unified.pubkey, alias: unified.alias, backend },
      {
        routing: routingMap.get(unified.pubkey) ?? null,
        revenue: revenueMap.get(unified.pubkey) ?? null,
        liquidity: liquidityMap.get(unified.pubkey) ?? null,
        channelHealth: channelHealthMap.get(unified.pubkey) ?? null,
        forceClose: forceCloseMap.get(unified.pubkey) ?? null,
        restart: restartMap.get(unified.pubkey) ?? null,
        peer: peerMap.get(unified.pubkey) ?? null,
      },
      SCORECARD_CONFIG[backend], // D-02 per-backend band lookup
    );
  });

  // 4. Per-backend MAD comparison pass (needs the whole fleet — second pass).
  attachPeerRelative(views);

  // 5. D-09 sort: criticals first, then worst composite first.
  return { nodes: sortFleet(views), fetchedAt: new Date() };
}

/**
 * PERF-01 no-404 fallback: the 30-day recency bound on latestNodeInfoAll drops a
 * node with NO lnd_node_info row in the window from the fleet snapshot. For the
 * overview/vitals that is CORRECT (applyFreshnessCutoff already eliminated it),
 * but the node's /[pubkey] detail page + modal must still render an all-stale
 * scorecard rather than 404. This assembles that single node from the sanctioned
 * single-node latestNodeInfo(pubkey) read (AFM-001 LIMIT 1 form), or returns null
 * if the node has genuinely never reported.
 *
 * The fleet-wide dimension aggregates are NOT re-run here (the node is outside
 * the window — they would return nothing anyway) → their inputs are null and
 * grade as honest "no rows in window". channelHealth + peer derive from the one
 * snapshot row. peerRelative stays null: the MAD cohort pass needs the whole
 * fleet and a single stale node has no cohort.
 */
export async function latestNodeInfoFallback(pubkey: string): Promise<ScorecardView | null> {
  const row = await latestNodeInfo(pubkey);
  if (row == null || row.pubkey == null) return null;

  const unified = mapLndNode({
    pubkey: row.pubkey,
    alias: row.alias,
    activeChannels: row.active_channels,
    inactiveChannels: row.inactive_channels,
    pendingChannels: row.pending_channels,
    localChannelBalance: row.local_channel_balance,
    remoteChannelBalance: row.remote_channel_balance,
  });
  const backend = backendFor(unified.pubkey); // D-03 override after mapping
  const channelHealthMap = channelHealthFromNodeInfo([row]);
  const peerMap = peerFromNodeInfo([row]);

  return assembleScorecard(
    { pubkey: unified.pubkey, alias: unified.alias, backend },
    {
      routing: null,
      revenue: null,
      liquidity: null,
      channelHealth: channelHealthMap.get(unified.pubkey) ?? null,
      forceClose: null,
      restart: null,
      peer: peerMap.get(unified.pubkey) ?? null,
    },
    SCORECARD_CONFIG[backend],
  );
}
