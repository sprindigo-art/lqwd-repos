import type { ReactNode } from "react";
import Link from "next/link";

import { loadInsightView, type InsightView } from "@/lib/insight/engine";
import { rankCards } from "@/lib/insight/rank";
import { loadFleetView } from "@/lib/scorecard/fleet";
import type { FleetView, ScorecardView } from "@/lib/scorecard/types";
import {
  deriveStale,
  getLatestHostMetrics,
  type HostMetricsView,
} from "@/lib/read/host-metrics";
import { getChainTelemetry, type ChainTelemetryView } from "@/lib/read/chain-telemetry";
import { getServiceHealth, type ServiceHealthState } from "@/lib/read/service-health";

import {
  OVERVIEW_TTL_MS,
  clearOverviewCache,
  getOverviewCache,
  setOverviewCache,
} from "@/lib/overview/overview-cache";
import { assembleIncidents, type GroupedIncident } from "@/lib/overview/incidents";
import { rollupLayer, type LayerVitals } from "@/lib/overview/vitals";
import { buildBandLines, buildCalmState } from "@/lib/overview/ai-band";
import { parseOverviewFacets } from "@/lib/overview/filter";
import { applyFreshnessCutoff } from "@/lib/overview/freshness-cutoff";
import {
  severityFromBand,
  severityFromService,
  worstSeverity,
} from "@/lib/overview/severity-map";

import {
  severityAccent,
  severityLabel,
  type Severity,
} from "@/components/df/Severity";
import { NavRailShell, type FleetCounts } from "@/components/df/NavRailShell";
import { SeverityHeroCard } from "@/components/df/SeverityHeroCard";
import { AiBandClient } from "@/components/overview/AiBandClient";
import { QueueIsland } from "@/components/overview/QueueIsland";
import { SnoozedCriticalBanner } from "@/components/incident/SnoozedCriticalBanner";
import { reconcileAndGetView } from "@/lib/db/read/incident-tracking";
import { cn } from "@/lib/utils";

// Live warehouse + telemetry read at request time (Server Component) — never
// prerendered. A `"use client"` directive in THIS file would fail the build:
// the read helpers below are server-only (lazy `dbNodemon`/`dbRouting` clients).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Ops Center Overview" };

// =====================================================
// OVW-01..05 — the full-stack Ops Center Overview at /
// =====================================================
// Server reads (fail-soft Promise.all) → the 30-day cutoff (backlog #8) → the
// PURE overview layer (Plans 01–06) → the locked Data-Forward v2 df primitives.
// This page owns ZERO health logic: severity crosses the boundary only via the
// Plan-01 mappers, incidents are root-cause grouped by `assembleIncidents`
// (engine order is LAW — no `.sort`), the fleet-vitals bars are `rollupLayer`'s
// strictly-proportional counts, the AI band is `buildBandLines`/`buildCalmState`
// (advisory-only by construction), and the FILTERED queue now lives in a client
// island (`QueueIsland`) that filters in-browser over the same grouped set (D-09)
// — a filter click no longer re-runs the warehouse reads.
//
// Perf (backlog #1): the 5 reads + cutoff + assembly + rollups are served through
// a short-TTL in-process memo keyed by a CONSTANT (NOT searchParams), mirroring
// `engine.ts` `_insightViewCache`, so repeat/cold loads stop re-running everything.
//
// Color discipline (DS-01): navy is STRUCTURE/action only (nav rail, AI band
// shell, active filter chip, safety footer); the severity ramp is STATE only and
// appears nowhere as chrome — every sev→class mapping flows through
// `severityAccent`/`severityVariants`/`severityLabel`, never an `if (sev === …)`
// chain in JSX.

// ─────────────────────────────────────────────────────────────
// Per-layer single-rung reducers (Pitfall 4: ONE df Severity per entity BEFORE
// counting). A multi-signal entity (a chain row's three bands) is reduced via
// `worstSeverity` here so it contributes exactly 1 to its layer total.
// ─────────────────────────────────────────────────────────────

/** scorecard node → df Severity: stale dominates; else the node's own `dot`. */
function nodeSeverity(node: ScorecardView): Severity {
  if (node.stale) return "stale";
  // `switch` on the SCORECARD's own field (not a df sev) — sanctioned per plan.
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

// ─────────────────────────────────────────────────────────────
// Data builder + short-TTL in-process memo (backlog #1)
// ─────────────────────────────────────────────────────────────
// The full "load 5 reads → 30-day cutoff → assemble incidents + roll up vitals"
// pipeline, served through a constant-keyed TTL memo. Filtering is NOT part of
// this — it moved to the client island — so the cache key is deliberately
// independent of `?layer`/`?sev`: a filter toggle reuses the cached assembly.
//
// This is an EPHEMERAL perf cache (mirrors `engine.ts` `_insightViewCache`), NOT
// persisted state — D-07's "no persisted card state / no cron" holds (nothing is
// written to nodemon; the memo evaporates with the process). We do NOT use
// `unstable_cache`: it JSON-serializes and would lose the `Date` stamps the
// cards/views carry. The cached PROMISE collapses concurrent cold callers onto
// one computation; a rejected computation is evicted so the next load retries.

/** Everything the page renders that does NOT depend on the active filter facets.
 *  Exported so the single-owner overview-cache helper can type its memo promise
 *  against this shape (type-only import — erased, no runtime cycle). */
export interface OverviewData {
  /** The full grouped incident set (unfiltered) — the island filters it client-side. */
  incidents: GroupedIncident[];
  /** Fleet-wide advisory band lines (NOT filter-scoped). */
  bandLines: ReturnType<typeof buildBandLines>;
  /** The five proportional fleet-vitals rollups (post-cutoff denominators). */
  vitals: LayerVitals[];
  /** Top-bar ramp/tally counts from the node layer's reduced rungs. */
  fleetCounts: FleetCounts;
  /** True when nothing is alerting (OVW-04). */
  allClear: boolean;
  /** The all-healthy node inventory for the collapse (post-cutoff). */
  healthyNodes: ScorecardView[];
  /** The all-clear calm continuation copy. */
  calm: ReturnType<typeof buildCalmState>;
  /** The all-clear body summary sentence. */
  allClearBody: string;
  /** The fleet read stamp — drives the top-bar poll age. */
  fetchedAt: Date;
  /**
   * CR-01: false when ANY incident-determining read (insight / fleet / host metrics
   * / chain / per-host service-health) degraded to its `.catch`. Gates the persisting
   * reconcile so a transient warehouse outage never mass-clears ack/snooze tracking.
   */
  readsHealthy: boolean;
}

/** The cached overview pipeline — first load computes, loads within the TTL reuse.
 *  The memo global now lives in the single-owner overview-cache helper so the
 *  refreshData() server action busts the SAME cache this reads (no divergent copy). */
function loadOverviewData(): Promise<OverviewData> {
  const now = Date.now();
  const cached = getOverviewCache();
  if (cached !== undefined && now - cached.at < OVERVIEW_TTL_MS) {
    return cached.promise;
  }

  const promise = buildOverviewData();
  const entry = setOverviewCache(now, promise);
  // Evict on failure so the next load retries rather than serving a pinned
  // rejection for the whole TTL (mirrors engine.ts). Only evict if OUR entry is
  // still current — a concurrent refresh/reload may have already replaced it.
  promise.catch(() => {
    if (getOverviewCache() === entry) {
      clearOverviewCache();
    }
  });
  return promise;
}

/**
 * The uncached pipeline: fail-soft reads → 30-day cutoff (LOCKED #8) → pure
 * assembly + rollups. Each read carries its OWN `.catch` so one broken layer
 * degrades to empty rather than taking the whole overview down; a total failure
 * rejects and the page-level try/catch renders the honest read-only error.
 */
async function buildOverviewData(): Promise<OverviewData> {
  // CR-01: any incident-determining read that falls into its `.catch` flips this
  // false. A degraded read yields an empty/partial `incidents` set, which must NOT
  // drive the persisting reconcile (else D-07 `set-cleared` wipes all ack/snooze
  // tracking on a transient outage). An all-clear with healthy reads stays true.
  let readsHealthy = true;

  const [insightView, fleet, hosts0, chain0]: [
    InsightView,
    FleetView,
    HostMetricsView[],
    ChainTelemetryView[],
  ] = await Promise.all([
    loadInsightView().catch((error: unknown) => {
      console.error("Insight view load failed:", error);
      readsHealthy = false;
      return { cards: [], fetchedAt: new Date(), llmEnabled: false, ap12Placeholder: null };
    }),
    loadFleetView().catch((error: unknown) => {
      console.error("Fleet view load failed:", error);
      readsHealthy = false;
      return { nodes: [], fetchedAt: new Date() };
    }),
    getLatestHostMetrics().catch((error: unknown) => {
      console.error("Host metrics load failed:", error);
      readsHealthy = false;
      return [] as HostMetricsView[];
    }),
    getChainTelemetry().catch((error: unknown) => {
      console.error("Chain telemetry load failed:", error);
      readsHealthy = false;
      return [] as ChainTelemetryView[];
    }),
  ]);

  // Services are per-declared-host (inventory-driven signature) — a second
  // fail-soft stage keyed off the host dimension loaded above.
  const serviceArrays = await Promise.all(
    hosts0.map((host) =>
      getServiceHealth(host.hostId).catch((error: unknown) => {
        console.error(`Service health load failed for ${host.hostId}:`, error);
        readsHealthy = false;
        return [] as ServiceHealthState[];
      }),
    ),
  );
  const services0 = serviceArrays.flat();

  // ── 30-day cutoff (LOCKED backlog #8) ───────────────────────────────────────
  // Eliminate every entity with NO data in the last 30 days BEFORE assembly AND
  // rollup, so a long-dead entity leaves BOTH the attention queue and the
  // fleet-vitals denominators in one pass (fixes the 1000+ STALE flood). Applied
  // per layer via each layer's own stamp accessor.
  const nodes = applyFreshnessCutoff(fleet.nodes, (n) => n.asOf);
  const hosts = applyFreshnessCutoff(hosts0, (h) => h.collectedAt);
  const chain = applyFreshnessCutoff(chain0, (c) => c.collectedAt);
  const services = applyFreshnessCutoff(services0, (s) => s.collectedAt);

  // Drop ranked insight cards whose node was eliminated — a card for a dead node
  // must not float as an incident. Null/fleet-pubkey cards are kept (they are not
  // tied to an eliminated node).
  const survivingPubkeys = new Set(nodes.map((n) => n.pubkey));
  const rankedCards = rankCards(insightView.cards).filter((card) => {
    const pubkey = card.node?.pubkey ?? null;
    return pubkey === null || survivingPubkeys.has(pubkey);
  });

  // ── Pure overview layer (Plans 01–06) over the CUT arrays ───────────────────
  const incidents = assembleIncidents({ rankedCards, hosts, chain, services, nodes });

  // The AI band reflects FLEET-WIDE state (not the filter) — what needs you now.
  const bandLines = buildBandLines(incidents);

  // ── Fleet-vitals rollups (OVW-03) — one rung per entity BEFORE counting ─────
  const nodeSeverities = nodes.map(nodeSeverity);
  const hostSeverities = hosts.map(hostSeverity);
  const serviceSeverities = services.map(severityFromService);

  // OQ2 / D-07: the bitcoind layer's denominator = ONLY hosts that DECLARE
  // bitcoind in service_inventory (the services read IS inventory-sourced). A
  // host that does not run bitcoind is provably excluded — its no-data chain row
  // never increments the bitcoind total.
  const bitcoindHostIds = new Set(
    services.filter((s) => s.serviceName.toLowerCase() === "bitcoind").map((s) => s.hostId),
  );
  const bitcoindSeverities = chain
    .filter((c) => bitcoindHostIds.has(c.hostId))
    .map(chainSeverity);

  const storageSeverities = hosts.flatMap((host) =>
    host.storage.map((mount) => storageSeverity(mount.collected_at)),
  );

  const nodeVitals = rollupLayer("nodes", nodeSeverities);
  const vitals: LayerVitals[] = [
    nodeVitals,
    rollupLayer("hosts", hostSeverities),
    rollupLayer("services", serviceSeverities),
    rollupLayer("bitcoind", bitcoindSeverities),
    rollupLayer("storage", storageSeverities),
  ];

  // B3: the top-bar ramp/tally must reflect the WHOLE fleet, not just nodes — a
  // downed host or stalled bitcoind with healthy nodes previously showed a solid
  // "all ok" pulse. Sum every layer's already-reduced rungs (one rung per entity)
  // into the four ramp buckets so a critical on ANY layer surfaces in the top bar.
  // Stale rungs stay out of the 4-bucket ramp (unchanged node-layer semantics).
  const fleetCounts: FleetCounts = vitals.reduce<FleetCounts>(
    (acc, layer) => ({
      crit: acc.crit + layer.counts.critical,
      warn: acc.warn + layer.counts.warning,
      watch: acc.watch + layer.counts.watch,
      ok: acc.ok + layer.counts.healthy,
    }),
    { crit: 0, warn: 0, watch: 0, ok: 0 },
  );

  // ── All-clear / hero split (OVW-04) ─────────────────────────────────────────
  const allClear = incidents.length === 0;
  const healthyNodes = nodes.filter((node) => nodeSeverity(node) === "healthy");
  const servicesRunning = services.filter((s) => s.green).length;
  const calm = buildCalmState({ nodeCount: healthyNodes.length, lastIncidentAgo: null });
  const allClearBody = `${healthyNodes.length} / ${nodes.length} nodes healthy · all ${hosts.length} hosts up · ${servicesRunning}/${services.length} services running · bitcoind at tip fleet-wide.`;

  return {
    incidents,
    bandLines,
    vitals,
    fleetCounts,
    allClear,
    healthyNodes,
    calm,
    allClearBody,
    fetchedAt: fleet.fetchedAt,
    readsHealthy,
  };
}

// ─────────────────────────────────────────────────────────────
// Fleet-vitals card (OVW-03) — strictly count-proportional bar. The segment
// order is fixed; each width = count/total literally (no severity weighting),
// stale carries its OWN gold segment (never folded into healthy — D-08).
// ─────────────────────────────────────────────────────────────

/** Fixed render order for the proportional segments + their NON-TEXT state hue. */
const VITALS_SEGMENTS: ReadonlyArray<Severity> = [
  "critical",
  "warning",
  "watch",
  "healthy",
  "stale",
];

function VitalsCard({ label, unit, vitals }: { label: string; unit: string; vitals: LayerVitals }) {
  const { counts, total, worst } = vitals;
  const active = VITALS_SEGMENTS.filter((sev) => counts[sev] > 0);
  return (
    <div className="rounded-df-card border border-df-border bg-df-surface p-4">
      <div className="flex items-center gap-2">
        <span className={cn("size-2 flex-none rounded-full", severityAccent[worst])} aria-hidden="true" />
        <span className="font-df-mono text-[10.5px] font-bold tracking-[0.08em] text-df-muted uppercase">
          {label}
        </span>
      </div>

      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-df-mono text-[24px] leading-none font-bold tabular-nums text-df-ink">
          {total}
        </span>
        <span className="font-df-mono text-[11px] text-df-muted">{unit}</span>
      </div>

      {/* Strictly proportional health bar — width = count/total (no weighting). */}
      <div
        className="mt-3 flex h-2 w-full overflow-hidden rounded-df-pill bg-df-border"
        aria-hidden="true"
        data-testid={`vitals-bar-${vitals.layer}`}
      >
        {total > 0 &&
          active.map((sev) => (
            <span
              key={sev}
              className={cn("h-full", severityAccent[sev])}
              style={{ width: `${((counts[sev] / total) * 100).toFixed(1)}%` }}
              data-seg={sev}
            />
          ))}
      </div>

      {/* Per-state tally — the state hue rides the dot (accessible companion). */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-df-mono text-[11px] tabular-nums text-df-muted">
        {active.length === 0 ? (
          <span className="text-df-muted">no entities</span>
        ) : (
          active.map((sev) => (
            <span key={sev} className="inline-flex items-center gap-1.5">
              {/* Shape carries meaning (FreshnessChip contract): square === stale,
                  round === live severity. Reserve rounded-[2px] for the stale rung. */}
              <span
                className={cn(
                  "size-1.5 flex-none",
                  sev === "stale" ? "rounded-[2px]" : "rounded-full",
                  severityAccent[sev],
                )}
                aria-hidden="true"
              />
              <b className="font-semibold text-df-ink">{counts[sev]}</b> {severityLabel[sev].toLowerCase()}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Static composition leaves (safety footer + healthy collapse)
// ─────────────────────────────────────────────────────────────

/** The zero-credential posture strip — verbatim copy, navy structural chrome. */
function SafetyFooter() {
  return (
    <footer className="rounded-df-card border border-df-border bg-df-brand-tint px-5 py-4">
      <p className="text-[13.5px] leading-relaxed text-df-ink">
        <span className="font-semibold">Zero node credentials stored.</span>{" "}
        <span className="text-df-muted">
          NodeMonitor reads and ranks; it never changes the fleet. High-risk fixes export as
          commands you run — the AI explains, it never executes.
        </span>
      </p>
    </footer>
  );
}

/** Collapsed healthy-node inventory — keeps the queue focused on what needs attention. */
function HealthyCollapse({ nodes }: { nodes: ScorecardView[] }) {
  if (nodes.length === 0) return null;
  return (
    <details className="group rounded-df-card border border-df-border bg-df-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-df-mono text-[11.5px] text-df-muted [&::-webkit-details-marker]:hidden">
        <span className="size-1.5 flex-none rounded-full bg-df-ok" aria-hidden="true" />
        <b className="font-semibold text-df-ink">{nodes.length}</b> nodes healthy · all reporting
        fresh · no action needed
      </summary>
      <div className="grid grid-cols-2 gap-2 border-t border-df-border-soft p-3 font-df-mono text-[11.5px] text-df-muted sm:grid-cols-3 lg:grid-cols-6">
        {nodes.map((node) => (
          <span key={node.pubkey} className="inline-flex items-center gap-1.5 truncate">
            <span className="size-1.5 flex-none rounded-full bg-df-ok" aria-hidden="true" />
            {/* G8: alias links to the node's full detail page. Navy STRUCTURAL
                (df-brand) — navigation is structure/action, never a health hue.
                node.pubkey is a trusted 66-hex warehouse value in an INTERNAL
                relative href; /{pubkey} re-validates PUBKEY_RE before any read. */}
            <Link
              href={`/${node.pubkey}`}
              className="truncate text-df-brand hover:underline"
            >
              {node.alias ?? node.pubkey}
            </Link>
          </span>
        ))}
      </div>
    </details>
  );
}

/** Mono uppercase section header (queue header grammar). Semantic `<h2>` so the
 *  page has a real heading outline (audit B5-ops) — style-only, keeps the kicker look.
 *  Promoted to df-muted for a legible information scent (df-faint is decorative-only). */
function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <h2 className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
      {children}
    </h2>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function OpsCenterOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Whitelist the operator-editable ?layer/?sev params (V5 / T-12-02): invalid
  // values silently widen the view, never throw. These are the INITIAL facets the
  // island hydrates from — after mount it owns filter state client-side.
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) usp.append(key, v);
    else if (value !== undefined) usp.append(key, value);
  }
  const facets = parseOverviewFacets(usp);

  let data: OverviewData;
  try {
    data = await loadOverviewData();
  } catch (error) {
    // Page-level honest-error fallback — read-only view, nothing was mutated.
    console.error("Ops Center overview load failed:", error);
    return (
      <main className="py-10">
        <h1 className="text-2xl font-semibold">{"Couldn't load the Ops Center."}</h1>
        <p className="mt-4 text-base text-foreground/70">
          {
            "The warehouse/telemetry reads didn't respond. Your data is unchanged — this view is read-only. Check the connections and reload."
          }
        </p>
      </main>
    );
  }

  const { incidents, bandLines, vitals, fleetCounts, allClear, healthyNodes, allClearBody } = data;

  // ── Tracking reconcile — OUTSIDE the pure 20s data memo (Pitfall 5 / T-17-18) ──
  // `buildOverviewData` stays a PURE read/assemble (constant-keyed, memoized); the
  // snooze-drop / ack-partition (D-05) / breakthrough (D-06) / resolution (D-07)
  // reconciliation WRITES fire here, per-request, so `cleared_at`/clear-mute never
  // lag a stale 0–1×/20s cache. The pure Plan-02 machine pre-partitions the engine
  // order (no `.sort`): QueueIsland renders the already-ordered `view` as-is.
  //
  // Fail-soft (deterministic-first, Plan 08 precedent): a nodemon outage degrades
  // to the raw engine-ordered queue with the banner absent, never 500ing the
  // read-only overview.
  //
  // CR-01: pass `data.readsHealthy` so the persisting reconcile (D-07 `set-cleared`)
  // only runs when the incident set is trustworthy. On a degraded warehouse read the
  // reconcile still returns the correct read-only view/banner but persists NO writes,
  // so a transient outage can never mass-clear operator ack/snooze tracking.
  let view = incidents;
  let snoozedCriticals: GroupedIncident[] = [];
  try {
    const reconciled = await reconcileAndGetView(incidents, new Date(), data.readsHealthy);
    view = reconciled.view;
    snoozedCriticals = reconciled.snoozedCriticals;
  } catch (error) {
    console.error("Incident tracking reconcile failed (degrading to raw queue):", error);
  }

  return (
    <NavRailShell
      active="ops"
      title="Ops Center"
      subtitle="Full-stack attention queue"
      counts={fleetCounts}
      activeView={allClear ? "allclear" : "incident"}
      // Honest chrome (D-R7): the pill ticks from the REAL fetch epoch — no fake
      // "Live" claim, no static per-second stamp that never advances.
      pollSinceMs={data.fetchedAt.getTime()}
      // Working operator nav off the overview (no honest open-counts to show yet,
      // so none are fabricated). Ops Center is the active surface.
      opsNav={[
        { key: "ops", label: "Home", href: "/" },
        { key: "nodes", label: "Nodes", href: "/nodes" },
        { key: "hosts", label: "Hosts", href: "/hosts" },
        { key: "inbox", label: "Inbox", href: "/inbox" },
        { key: "pending", label: "Pending", href: "/pending" },
        { key: "queue", label: "Queue", href: "/queue" },
      ]}
      // The "Preview" toggle is meaningless on the overview — drop it (D-R7);
      // the design gallery keeps its own default toggle.
      showViewToggle={false}
    >
      <div className="flex flex-col gap-6 pb-16">
        {/* Snoozed-critical honesty banner (D-04) — fleet-wide, non-dismissible,
            sticky above the fold on overview AND host detail so muting a critical
            can never scroll out of sight (T-17-16). Absent at zero snoozed criticals. */}
        {snoozedCriticals.length > 0 && (
          <div className="sticky top-0 z-20">
            <SnoozedCriticalBanner count={snoozedCriticals.length} />
          </div>
        )}

        {/* Surface identity (audit B5-ops) — a real <h1> naming the Ops Center so
            the page has a proper heading outline for AT. Subtle mono, not a banner. */}
        <header className="flex flex-col gap-1">
          <h1 className="font-df-mono text-[13px] font-bold tracking-[0.08em] text-df-ink uppercase">
            Ops Center
          </h1>
          <p className="text-[13px] text-df-muted">
            Full-stack attention queue — every layer of the fleet, worst-first.
          </p>
        </header>

        {/* HERO: Fleet-vitals rollup (OVW-03 / D-R1) — vitals-first: the fleet
            pulse is the first thing the operator sees, one proportional card per
            layer, above the AI band and the queue. */}
        <section className="flex flex-col gap-3">
          <SectionKicker>Fleet vitals</SectionKicker>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <VitalsCard label="Nodes" unit="nodes" vitals={vitals[0]} />
            <VitalsCard label="Hosts" unit="hosts" vitals={vitals[1]} />
            <VitalsCard label="Services" unit="services" vitals={vitals[2]} />
            <VitalsCard label="bitcoind" unit="instances" vitals={vitals[3]} />
            <VitalsCard label="Storage" unit="mounts" vitals={vitals[4]} />
          </div>
        </section>

        {/* All-clear collapses to a SINGLE message (audit D): the hero carries the
            real `allClearBody`, so the duplicate AI calm-band and the "You're all
            caught up" section are dropped. The AI band is advisory and only earns
            its space when there's something to advise, so it's incident-state only. */}
        {allClear ? (
          <SeverityHeroCard
            sev="healthy"
            eyebrow="All clear"
            label="ALL CLEAR"
            title="Nothing needs you right now"
            narrative={allClearBody}
          />
        ) : (
          <>
            {/* AI band (OVW-02) — advisory-only; nothing here emits a command. */}
            <AiBandClient lines={bandLines} />
            {/* Top-priority hero + attention queue + filters (OVW-01 / OVW-05) —
                the client island owns the whole hero/queue/filters/empty block so
                filtering is instant and re-fetch-free (backlog #1). */}
            <QueueIsland incidents={view} initialFacets={facets} />
          </>
        )}

        {/* Healthy collapse — the all-healthy inventory, out of the way. */}
        <HealthyCollapse nodes={healthyNodes} />

        {/* Zero-credential safety posture — reaffirmed on every load. */}
        <SafetyFooter />
      </div>
    </NavRailShell>
  );
}
