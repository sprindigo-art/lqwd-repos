import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getLatestHostMetrics, type HostMetricsView } from "@/lib/read/host-metrics";
import { getChainTelemetry, type ChainTelemetryView } from "@/lib/read/chain-telemetry";
import { getServiceHealth, type ServiceHealthState } from "@/lib/read/service-health";
import { getHostMetricsHistory, getHostStorageHistory } from "@/lib/read/host-history";
import { computeStorageGrowth, type StorageGrowthSample } from "@/lib/read/storage-growth";
import { loadFleetView } from "@/lib/scorecard/fleet";
import type { FleetView, GradedDimension, ScorecardView } from "@/lib/scorecard/types";
import { loadIncidents } from "@/lib/overview/load-incidents";
import { loadFleetCounts } from "@/lib/overview/fleet-counts";
import { loadActiveTracking } from "@/lib/db/read/incident-tracking";
import { reconcileTracking, type TrackingRow } from "@/lib/overview/incident-tracking";

import { type GroupedIncident } from "@/lib/overview/incidents";
import { buildHostRollup } from "@/lib/overview/host-rollup";
import { buildHostRunbook, type HostRunbook } from "@/lib/overview/host-runbook";
import { serviceDisplay } from "@/lib/overview/service-display";
import { severityFromBand, worstSeverity } from "@/lib/overview/severity-map";
import {
  TELEMETRY_BANDS,
  evaluateBand,
  evaluateDaysToFull,
} from "@/lib/read/telemetry-bands";

import {
  severityAccent,
  severityLabel,
  type Severity,
} from "@/components/df/Severity";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { FreshnessChip } from "@/components/df/FreshnessChip";
import { TwoAxisPip } from "@/components/df/TwoAxisPip";
import { VmVitals, type VmVitalChart } from "@/components/node/VmVitals";
import { HostIncidentBanner } from "@/components/host/HostIncidentBanner";
import { SnoozedCriticalBanner } from "@/components/incident/SnoozedCriticalBanner";
import { StorageVolumes, type StorageVolumeRow } from "@/components/host/StorageVolumes";
import { OnHostNodes, type OnHostNodeRow } from "@/components/host/OnHostNodes";
import { cn } from "@/lib/utils";

// Live warehouse + telemetry read at request time (Server Component) — never
// prerendered. A client-component directive here would fail the build: the read
// helpers below are server-only (lazy `dbNodemon`/warehouse clients).
export const dynamic = "force-dynamic";
export const revalidate = 0;

// =====================================================
// HOST-02 — the single-scroll Host Detail at /(overview)/hosts/[hostId] (D-09/D-10)
// =====================================================
// The D-10 incident-first order: header → incident banner (ABSENT when healthy) →
// VM vitals (real 24h history sparklines) → infra services two-axis → storage
// volumes (honest projection gate) → on-host nodes.
//
// SECURITY GAUNTLET (Pitfall 5 / ASVS V5, threats T-14-16/17): `hostId` is
// operator-editable free text. It is membership-gated against the loaded hosts
// DIMENSION (`getLatestHostMetrics`) BEFORE any echo — an unknown hostId resolves
// to `notFound()`, placed OUTSIDE the try/catch so its control-flow signal is
// never swallowed. The page NEVER echoes a hostId that failed the gate; a read
// failure renders honest generic copy (no hostId echo, no DB name — T-14-20).
//
// The history reads (getHostMetricsHistory / getHostStorageHistory) are the
// param-bound bounded scans from 14-02 (T-14-16 SQLi mitigation lives there). All
// per-read `.catch` is fail-soft: one broken layer degrades its section, never the
// page. Health is computed HERE at read time (bands + rollup) and passed to the
// presentation-pure host components — no component derives a threshold (T-14-19).

/** 24h history window — matches the Node Detail VM-vitals treatment (UI-SPEC B3). */
const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Operator nav — the shared rail plus the Hosts surface (this page's active key). */
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/** scorecard node → df Severity (mirrors the overview): stale dominates, else dot. */
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

/** Read a graded dimension off the loaded scorecard (evidence, never re-queried). */
function dimOf(node: ScorecardView, key: GradedDimension["key"]): GradedDimension | undefined {
  return node.dimensions.find((d) => d.key === key);
}

/** Coerce a raw bigint|number|string|null byte column to a finite number, else null. */
function num(v: bigint | number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Compact relative age for the stale vitals placeholder ("4m", "3h", "2d"). */
function relAge(d: Date | null): string | undefined {
  if (d === null) return undefined;
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Latest-sample age + gathered span for a mount's history (feeds D-14 copy). */
function sampleAges(samples: StorageGrowthSample[]): { ageMs?: number; currentSpanMs?: number } {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!last) return {};
  return {
    ageMs: Date.now() - last.collectedAt.getTime(),
    currentSpanMs: first ? last.collectedAt.getTime() - first.collectedAt.getTime() : undefined,
  };
}

/**
 * Map the incident's root-cause driver class → its verify-first runbook. The
 * driver is the FIRST child at the incident rung (engine order preserved); its
 * layer selects the closed HostRunbookDriver union. service driver passes its
 * display label so the runbook names the service the operator sees.
 */
function incidentRunbook(incident: GroupedIncident): HostRunbook {
  const driver =
    incident.children.find((c) => c.severity === incident.severity) ?? incident.children[0];
  switch (driver?.layer) {
    case "bitcoind":
      return buildHostRunbook("bitcoind-down");
    case "services":
      return buildHostRunbook("service-not-functioning", driver.entityLabel);
    case "storage":
    case "hosts":
      return buildHostRunbook("disk-filling");
    case "nodes":
      return buildHostRunbook("node-critical");
    default:
      return buildHostRunbook("node-critical");
  }
}

/** Build the CPU / Memory / Disk vitals charts from the 24h history + latest storage. */
function buildVitals(
  host: HostMetricsView,
  history: Awaited<ReturnType<typeof getHostMetricsHistory>>,
  diskSeries: number[],
  diskLatest: number | null,
): VmVitalChart[] {
  const lastGoodLabel = relAge(host.collectedAt);

  // CPU — series + latest from the metrics history.
  const cpuSeries = history.map((p) => p.cpuPct).filter((v): v is number => v !== null);
  const cpuLatest = cpuSeries.length > 0 ? cpuSeries[cpuSeries.length - 1] : null;
  const cpu: VmVitalChart = {
    key: "cpu",
    label: "CPU · last 24h",
    value: cpuLatest !== null ? `${Math.round(cpuLatest)}%` : "—",
    sev:
      cpuLatest !== null
        ? severityFromBand(evaluateBand(cpuLatest, TELEMETRY_BANDS.cpuPctBusy))
        : "stale",
    series: cpuSeries,
    stale: host.stale || cpuSeries.length === 0,
    lastGoodLabel,
  };

  // Memory — used% series (100 − available%), latest, severity from available% band.
  const memSeries: number[] = [];
  let memAvailPctLatest: number | null = null;
  for (const p of history) {
    if (p.memTotalKb !== null && p.memTotalKb > 0 && p.memAvailableKb !== null) {
      const availPct = (p.memAvailableKb / p.memTotalKb) * 100;
      memSeries.push(100 - availPct);
      memAvailPctLatest = availPct;
    }
  }
  const memUsedLatest = memSeries.length > 0 ? memSeries[memSeries.length - 1] : null;
  const mem: VmVitalChart = {
    key: "mem",
    label: "Memory · last 24h",
    value: memUsedLatest !== null ? `${Math.round(memUsedLatest)}%` : "—",
    sev:
      memAvailPctLatest !== null
        ? severityFromBand(evaluateBand(memAvailPctLatest, TELEMETRY_BANDS.memAvailablePct))
        : "stale",
    series: memSeries,
    stale: host.stale || memSeries.length === 0,
    lastGoodLabel,
  };

  // Disk — the worst mount's used% series (%-FREE band drives severity).
  const disk: VmVitalChart = {
    key: "disk",
    label: "Disk · last 24h",
    value: diskLatest !== null ? `${Math.round(diskLatest)}%` : "—",
    sev:
      diskLatest !== null
        ? severityFromBand(evaluateBand(100 - diskLatest, TELEMETRY_BANDS.diskPctFree))
        : "stale",
    series: diskSeries,
    stale: host.stale || diskSeries.length === 0,
    lastGoodLabel,
  };

  return [cpu, mem, disk];
}

/** Everything the page renders that survives the fail-soft supplementary reads. */
interface DetailData {
  host: HostMetricsView;
  overall: Severity;
  incident: GroupedIncident | null;
  runbook: HostRunbook | null;
  vitals: VmVitalChart[];
  infraServices: ServiceHealthState[];
  chainForHost: ChainTelemetryView | null;
  volumes: StorageVolumeRow[];
  nodes: OnHostNodeRow[];
  /** Fleet-wide snoozed-critical count for the always-visible honesty banner (D-04). */
  snoozedCriticalCount: number;
}

interface PageProps {
  params: Promise<{ hostId: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { hostId } = await params;
  const hosts = await getLatestHostMetrics().catch(() => [] as HostMetricsView[]);
  const host = hosts.find((h) => h.hostId === hostId);
  // Never echo an unknown hostId in metadata either — generic title on a miss.
  if (!host) return { title: "Host not found" };
  return { title: `${host.hostname ?? host.hostId} — Host Detail` };
}

export default async function HostDetailPage({ params }: PageProps) {
  const { hostId } = await params;

  let data: DetailData | null = null;
  let loadFailed = false;
  try {
    // MEMBERSHIP GATE — the hosts dimension is the authority. A throw here is a
    // total read failure (→ honest error copy); a miss is notFound (below, outside).
    const hostsAll = await getLatestHostMetrics();
    const host = hostsAll.find((h) => h.hostId === hostId);

    if (host !== undefined) {
      // ── Fail-soft supplementary reads (one broken layer degrades its section) ──
      const [chain, fleet] = await Promise.all([
        getChainTelemetry().catch(() => [] as ChainTelemetryView[]),
        loadFleetView().catch(
          () => ({ nodes: [] as ScorecardView[], fetchedAt: new Date() }) as FleetView,
        ),
      ]);

      // assembleIncidents needs fleet-wide services (ownership + all-host grouping).
      const serviceArrays = await Promise.all(
        hostsAll.map((h) => getServiceHealth(h.hostId).catch(() => [] as ServiceHealthState[])),
      );
      const allServices = serviceArrays.flat();

      const [metricsHistory, storageHistory] = await Promise.all([
        getHostMetricsHistory(hostId, WINDOW_MS).catch(
          () => [] as Awaited<ReturnType<typeof getHostMetricsHistory>>,
        ),
        getHostStorageHistory(hostId, WINDOW_MS).catch(
          () => new Map<string, StorageGrowthSample[]>(),
        ),
      ]);

      // ── Incident (root-cause grouped, keyed by this host) ────────────────────
      // The shared server loader (INC-01) assembles the SAME GroupedIncident[] the
      // overview renders and the AI narrate action reads — select THIS host by
      // `.key` (GroupedIncident has no `.hostId`; a `.hostId` match silently misses).
      const allIncidents = await loadIncidents();
      const incident = allIncidents.find((i) => i.key === hostId) ?? null;

      // ── Fleet-wide snoozed-critical count (D-04) ──────────────────────────────
      // The honesty banner is fleet-wide and must show on host detail too (UI-SPEC
      // §Snoozed-Critical Banner). PURE reconcile over the FULL incident set — the
      // detail render stays ZERO-WRITE (the overview owns the reconcile writes;
      // 17-08 precedent). Fail-soft: a nodemon outage degrades the count to zero
      // (banner absent), never 500s the read-only host view.
      const activeRows = await loadActiveTracking().catch(() => [] as TrackingRow[]);
      const { snoozedCriticals } = reconcileTracking(allIncidents, activeRows, new Date());

      // ── Ownership: on-host node pubkeys from the service (hostId, pubkey) pairs ─
      const nodePubkeysByHost = new Map<string, Set<string>>();
      for (const s of allServices) {
        if (s.nodePubkey !== null) {
          const set = nodePubkeysByHost.get(s.hostId) ?? new Set<string>();
          set.add(s.nodePubkey);
          nodePubkeysByHost.set(s.hostId, set);
        }
      }
      const onHostPubkeys = nodePubkeysByHost.get(hostId) ?? new Set<string>();
      const onHostScorecards = fleet.nodes.filter((n) => onHostPubkeys.has(n.pubkey));

      // Host-level infra trio (nodePubkey === null on this host). Presence-gated:
      // Esplora is not on every host (one node today), so a no-data Esplora tile is
      // omitted rather than shown as a permanent empty card; bitcoind/postgres stay.
      const infraServices = allServices.filter(
        (s) =>
          s.hostId === hostId &&
          s.nodePubkey === null &&
          !(s.serviceName.toLowerCase() === "esplora" && s.noData),
      );
      const chainForHost = chain.find((c) => c.hostId === hostId) ?? null;

      // ── Storage volumes: per-mount growth over the retained history ───────────
      // Seed from the LATEST snapshot mounts so every current volume renders; a
      // mount with <2 samples degrades to the honest "gathering data" copy.
      const volumes: StorageVolumeRow[] = [];
      const diskSeriesByMount: Array<{ series: number[]; latest: number | null }> = [];
      for (const mount of host.storage) {
        const mountName = mount.mount_point;
        if (mountName === null) continue;
        const samples = storageHistory.get(mountName) ?? [];
        const growth = computeStorageGrowth(samples);

        // Latest used% — the growth's own latest, else the snapshot ratio.
        let usedPct = growth.latestPctUsed;
        if (usedPct === null) {
          const total = num(mount.total_bytes);
          const used = num(mount.used_bytes);
          usedPct = total !== null && total > 0 && used !== null ? (used / total) * 100 : 0;
        }

        // Row severity — worse of the used-% band and the days-to-full band (D-13).
        const usedBand = severityFromBand(
          evaluateBand(100 - usedPct, TELEMETRY_BANDS.diskPctFree),
        );
        const daysBand: Severity =
          growth.status === "ok" && growth.daysToFull !== null
            ? evaluateDaysToFull(growth.daysToFull)
            : "healthy";
        const sev = worstSeverity([usedBand, daysBand]);

        const { ageMs, currentSpanMs } = sampleAges(samples);

        volumes.push({ mount: mountName, usedPct, sev, growth, ageMs, currentSpanMs });

        // Per-mount used% series for the disk vital (kept alongside so we can pick
        // the worst mount for the single disk sparkline).
        const series = samples
          .map((s) => {
            const total = Number(s.totalBytes);
            return total > 0 ? (Number(s.usedBytes) / total) * 100 : null;
          })
          .filter((v): v is number => v !== null);
        diskSeriesByMount.push({ series, latest: usedPct });
      }

      // Worst mount (highest latest used%) drives the single disk vital sparkline.
      const worstDisk = diskSeriesByMount.reduce<{ series: number[]; latest: number | null }>(
        (worst, cur) => ((cur.latest ?? 0) > (worst.latest ?? 0) ? cur : worst),
        { series: [], latest: null },
      );

      const vitals = buildVitals(host, metricsHistory, worstDisk.series, worstDisk.latest);

      // ── Header worst-of rollup + node rows ────────────────────────────────────
      const nodeSeverities = onHostScorecards.map(nodeSeverity);
      const rollup = buildHostRollup({
        host,
        services: infraServices,
        chain: chainForHost,
        nodeSeverities,
        storage: volumes.map((v) => v.growth),
      });

      const nodes: OnHostNodeRow[] = onHostScorecards.map((n) => ({
        pubkey: n.pubkey,
        alias: n.alias,
        backend: n.backend,
        sev: nodeSeverity(n),
        asOf: n.asOf,
        stale: n.stale,
        activeChannels: dimOf(n, "channelHealth")?.extras?.activeChannels ?? null,
        liquidityRatio: dimOf(n, "liquidity")?.raw ?? null,
        forwards: dimOf(n, "routing")?.raw ?? null,
        // Node-associated scripts running on THIS VM for the node (host-owned):
        // internalRebalancer, aiLiquidityManager, nodeAuditor… Presence-gated.
        scripts: allServices
          .filter((s) => s.nodePubkey === n.pubkey && !s.noData)
          .map((s) => ({
            serviceName: s.serviceName,
            running: s.running,
            functioning: s.functioning,
            errorCount: s.errorCount,
            // Gap B explainability fields for the not-green why-accordion (honest passthrough).
            detail: s.detail,
            detectionMethod: s.detectionMethod,
            lastSuccessAt: s.lastSuccessAt,
            functioningStale: s.stale,
            collectorStale: s.collectorStale,
          })),
      }));

      data = {
        host,
        overall: rollup.sev,
        incident,
        runbook: incident ? incidentRunbook(incident) : null,
        vitals,
        infraServices,
        chainForHost,
        volumes,
        nodes,
        snoozedCriticalCount: snoozedCriticals.length,
      };
    }
  } catch (error) {
    // A TOTAL read failure (not a per-section degrade) → honest read-only copy.
    // No hostId is echoed — the failure is a data-source problem (T-14-20).
    console.error("Host Detail load failed:", error);
    loadFailed = true;
  }

  if (loadFailed) {
    // Stays inside the shell (audit B2) so a warehouse blip never strands the
    // operator. No hostId is echoed — the failure is a data-source problem.
    return (
      <BoardError
        active="hosts"
        opsNav={OPS_NAV}
        title="Host"
        heading="Couldn't load host telemetry."
        body="The read model is unreachable — this is a data-source problem, not a host failure. Retry, or check the warehouse connection."
      />
    );
  }

  // notFound() lives OUTSIDE the try so its control-flow signal is never swallowed
  // — and an unknown hostId that failed the membership gate is never echoed.
  if (data === null) notFound();

  const {
    host,
    overall,
    incident,
    runbook,
    vitals,
    infraServices,
    chainForHost,
    volumes,
    nodes,
    snoozedCriticalCount,
  } = data;
  const hostName = host.hostname ?? host.hostId;

  // REAL top-bar fleet counts (U2) — never a fabricated all-clear ramp. A read
  // failure resolves to `undefined` and the shell then omits the summary honestly.
  const fleetCounts = await loadFleetCounts().catch(() => undefined);

  return (
    <NavRailShell
      active="hosts"
      title={hostName}
      subtitle="Host Detail"
      pollSinceMs={host.collectedAt?.getTime()}
      counts={fleetCounts}
      opsNav={OPS_NAV}
      showViewToggle={false}
    >
      <div className="flex w-full flex-col gap-8 pb-16">
        {/* Fleet-wide snoozed-critical honesty banner (D-04) — sticky above the fold
            on host detail too, so a muted critical anywhere in the fleet can never
            scroll out of sight (UI-SPEC §Snoozed-Critical Banner / T-17-16).
            Non-dismissible; absent at zero snoozed criticals. Additive only. */}
        {snoozedCriticalCount > 0 && (
          <div className="sticky top-0 z-20">
            <SnoozedCriticalBanner count={snoozedCriticalCount} />
          </div>
        )}

        {/* B1 — host identity header. */}
        <header className="flex flex-col gap-3">
          <Link
            href="/hosts"
            className="w-fit font-df-mono text-[11.5px] text-df-brand hover:underline"
          >
            ← Hosts
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[23px] font-bold leading-[1.18] tracking-[-0.02em] text-df-ink">
              {hostName}
            </h1>
            <span className="font-df-mono text-[12.5px] text-df-muted">{host.hostId}</span>
            <span
              className={cn(
                "rounded-[5px] px-2 py-0.5 font-df-mono text-[10.5px] font-bold tracking-[0.07em] text-white",
                severityAccent[overall],
              )}
            >
              {severityLabel[overall]}
            </span>
            <FreshnessChip asOf={host.collectedAt} stale={host.stale} />
          </div>
        </header>

        {/* B2 — root-cause incident banner. ABSENT entirely when healthy (D-10). */}
        {incident !== null && runbook !== null && (
          <HostIncidentBanner incident={incident} runbook={runbook} />
        )}

        {/* B3 — VM vitals (real 24h history sparklines; StaleChart on a stale host). */}
        <VmVitals charts={vitals} />

        {/* B4 — VM-level services (bitcoind · postgres · esplora-when-present ·
            disk/monitor). Host-level services carry no node scope, so tiles are
            informational (no dead links — Pitfall 7). Node-associated scripts live
            under their node in the "Nodes on this Host" section below. */}
        <section className="flex flex-col gap-3">
          <SectionKicker>VM Services</SectionKicker>
          {infraServices.length === 0 ? (
            <div className="rounded-df-card border border-df-border bg-df-surface px-4 py-6 text-center text-[13px] text-df-muted">
              No VM-level services reported for this host.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {infraServices.map((s) => {
                const isBitcoind = s.serviceName.toLowerCase() === "bitcoind";
                return (
                  <div key={`${s.hostId}:${s.serviceName}`} className="flex flex-col gap-1.5">
                    <TwoAxisPip
                      name={serviceDisplay(s.serviceName).label}
                      running={s.running}
                      functioning={s.functioning}
                      errorCount={s.errorCount}
                    />
                    {isBitcoind && chainForHost?.blocksBehind != null && (
                      <span className="font-df-mono text-[11px] tabular-nums text-df-muted">
                        {chainForHost.blocksBehind} blocks behind tip
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* B5 — storage volumes (honest projection gate; stale rows go gold). */}
        <section className="flex flex-col gap-3">
          <SectionKicker>Storage Volumes</SectionKicker>
          <StorageVolumes volumes={volumes} />
        </section>

        {/* B6 — nodes on this host (compact rows → Node Detail). */}
        <section className="flex flex-col gap-3">
          <SectionKicker>Nodes on this Host</SectionKicker>
          <OnHostNodes nodes={nodes} />
        </section>
      </div>
    </NavRailShell>
  );
}

/** Mono uppercase section kicker (overview grammar). */
function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
      {children}
    </div>
  );
}
