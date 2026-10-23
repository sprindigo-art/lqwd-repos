import { cache } from "react";
import { notFound } from "next/navigation";

import { loadFleetView, latestNodeInfoFallback } from "@/lib/scorecard/fleet";
import type { ScorecardView } from "@/lib/scorecard/types";
import { getLatestHostMetrics, type HostMetricsView } from "@/lib/read/host-metrics";
import { getServiceHealth, type ServiceHealthState } from "@/lib/read/service-health";
import { resolveNodeServices } from "@/lib/read/node-services";
import { getHostMetricsHistory, getHostStorageHistory } from "@/lib/read/host-history";
import { getServiceLogEvents } from "@/lib/read/service-log-events";
import { getHostMetricsExt, type HostMetricsExtView } from "@/lib/read/host-metrics-ext";
import type { StorageGrowthSample } from "@/lib/read/storage-growth";
import { TELEMETRY_BANDS, evaluateBand } from "@/lib/read/telemetry-bands";
import {
  latestChannelsForNode,
  projectChannelBaseline,
} from "@/lib/read/latest";
import { aggregateLiquidity, type LiquiditySplit } from "@/lib/read/liquidity-split";
import { peersTabData, type PeersTabView } from "@/lib/console/peers";
import { loadInsightView } from "@/lib/insight/engine";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import type { InsightCard } from "@/lib/insight/types";
import {
  severityFromBand,
  severityFromInsight,
  severityFromService,
  worstSeverity,
} from "@/lib/overview/severity-map";

import { type Severity } from "@/components/df/Severity";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { NodeHeader } from "@/components/node/NodeHeader";
import { NodeSummaryStrip } from "@/components/node/NodeSummaryStrip";
import { NodeDetailTabs } from "@/components/node/NodeDetailTabs";
import { LiquidityGauge } from "@/components/node/LiquidityGauge";
import { VmVitals, type VmVitalChart } from "@/components/node/VmVitals";
import { NodeSupportingServices } from "@/components/node/NodeSupportingServices";
import { NodeActiveSignals, type NodeSignal } from "@/components/node/NodeActiveSignals";
import { NodeLogsStream, type NodeLogLine } from "@/components/node/NodeLogsStream";
import { ReadOnlySafetyPosture } from "@/components/node/ReadOnlySafetyPosture";

// Live warehouse + telemetry read at request time (Server Component) — never
// prerendered. The read helpers below are server-only (lazy DB clients); a
// `"use client"` directive here would fail the build.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// =====================================================
// NODE-04 / SVC-01 — the LEAN Node-Detail overview at /{pubkey} (G1/G3/G4)
// =====================================================
// The redesign (gate feedback 2026-07-09, locked "routed tabs + lean overview")
// replaces the single-scroll firehose with a lean glance surface: header → summary
// counts + the NodeDetailTabs bar → the aggregate capacity-weighted LiquidityGauge
// (G4) → VM vitals → the SVC-01 service grid → active signals + logs → the read-only
// safety posture. The heavy tabular data (channels/peers/forwards) now lives in the
// routed sub-routes reached via the tab bar (13-12/13/14) — NOT on this page (G1).
// The column is tightened to remove dead space (G3).
//
// Validation order (ASVS V5, T-13-15-01) — retained VERBATIM from the prior page:
//   1. PUBKEY_RE on the pubkey segment → notFound() BEFORE any read.
//   2. The node resolves from the bounded fleet read OR the single-node fallback
//      (PERF-01 no-404 for >30d-stale nodes); a genuinely-never-seen pubkey 404s.
//
// The service grid is fed `resolveNodeServices` output (Drift 3 — the pubkey is
// resolved to its hostId FIRST; a raw pubkey is NEVER passed into the host-keyed
// getServiceHealth). Every supplementary section read is individually `.catch`-
// guarded (fail-soft): one broken read degrades that section, never the page. A
// total read failure renders the honest read-only error copy.

const PUBKEY_RE = /^[0-9a-f]{66}$/;

/** Operator nav — the shared six-item rail so a read failure never dead-ends (B2). */
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/** 24h VM-vitals window — mirrors the Host Detail treatment (UI-SPEC B3 / RESEARCH Q2). */
const VITALS_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Per-request dedupe so generateMetadata + the page share ONE warehouse read. */
const getFleet = cache(loadFleetView);

function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

/** Compact relative age for the stale vitals placeholder ("4m ago", "3h ago"). */
function relAge(d: Date | null): string | undefined {
  if (d === null) return undefined;
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Coerce a raw bigint|number|string|null byte column to a finite number, else null. */
function num(v: bigint | number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build the CPU / Memory / Disk VM-vitals charts from the resolved host's 24h
 * history — the SAME read-time-band treatment as Host Detail (RESEARCH Q2). Health
 * is graded HERE (bands) and handed to the presentation-pure `VmVitals`; a stale
 * host or an empty series degrades that chart to the honest `StaleChart` branch.
 */
function buildHostVitals(
  host: HostMetricsView,
  history: Awaited<ReturnType<typeof getHostMetricsHistory>>,
  storageHistory: Map<string, StorageGrowthSample[]>,
): VmVitalChart[] {
  const lastGoodLabel = relAge(host.collectedAt);

  // CPU — series + latest from the metrics history; severity from the busy band.
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

  // Memory — used% series (100 − available%); severity from the available% band.
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

  // Disk — the worst (most-full) mount's used% series (%-FREE band drives severity).
  let worstSeries: number[] = [];
  let worstLatest: number | null = null;
  for (const mount of host.storage) {
    if (mount.mount_point === null) continue;
    const samples = storageHistory.get(mount.mount_point) ?? [];
    const series = samples
      .map((s) => {
        const total = Number(s.totalBytes);
        return total > 0 ? (Number(s.usedBytes) / total) * 100 : null;
      })
      .filter((v): v is number => v !== null);
    // Latest used% — the mount's freshest series point, else the snapshot ratio.
    let usedPct = series.length > 0 ? series[series.length - 1] : null;
    if (usedPct === null) {
      const total = num(mount.total_bytes);
      const used = num(mount.used_bytes);
      usedPct = total !== null && total > 0 && used !== null ? (used / total) * 100 : null;
    }
    if ((usedPct ?? 0) > (worstLatest ?? 0)) {
      worstLatest = usedPct;
      worstSeries = series;
    }
  }
  const disk: VmVitalChart = {
    key: "disk",
    label: "Disk · last 24h",
    value: worstLatest !== null ? `${Math.round(worstLatest)}%` : "—",
    sev:
      worstLatest !== null
        ? severityFromBand(evaluateBand(100 - worstLatest, TELEMETRY_BANDS.diskPctFree))
        : "stale",
    series: worstSeries,
    stale: host.stale || worstSeries.length === 0,
    lastGoodLabel,
  };

  return [cpu, mem, disk];
}

/** Pre-format a byte quantity for a chart value (component does no unit math). */
function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GiB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${Math.round(n)} B`;
}

/**
 * COL-03 — deep-VM evidence charts (Plan 15-08) from `getHostMetricsExt`:
 * per-core CPU busy profile, per-device disk-I/O Δ and per-iface network
 * errors+drops Δ. Same serializable-prop path + honest-stale treatment as
 * `buildHostVitals`: the reader's `deriveStale` (D-13) governs freshness, and a
 * missing prior sample / unapplied migration reads as StaleChart "NO FRESH
 * DATA" — never faked freshness. Severity comes ONLY from the reader's D-14
 * read-time bands (steal/iowait per core, tcp retransmit rate); Δ counters
 * without a band render as plain healthy evidence, plus the hard-zero rule for
 * iface errors/drops (any Δ>0 is worth a warning glance).
 */
function buildDeepVitals(ext: HostMetricsExtView | null): VmVitalChart[] {
  const lastGoodLabel = relAge(ext?.asOf ?? null);
  const extStale = ext === null || ext.stale;

  // Per-core CPU — the busy% profile across cores (one point per core); severity
  // from the WORST steal/iowait band across cores (banded at read, D-14).
  const cores = ext?.derived.cpuCores ?? [];
  const busySeries = cores
    .map((c) => c.busyPct)
    .filter((v): v is number => v !== null);
  const busyPeak = busySeries.length > 0 ? Math.max(...busySeries) : null;
  const coreBandSevs: Severity[] = [];
  for (const c of cores) {
    for (const b of [c.stealPct, c.iowaitPct]) {
      if (b !== null) coreBandSevs.push(severityFromBand(b.band));
    }
  }
  const cpuCores: VmVitalChart = {
    key: "cpu-cores",
    label: `CPU busy % by core${cores.length > 0 ? ` (${cores.length} cores, this tick)` : ""}`,
    value: busyPeak !== null ? `${Math.round(busyPeak)}% peak` : "—",
    sev:
      busyPeak === null
        ? "stale"
        : coreBandSevs.length > 0
          ? worstSeverity(coreBandSevs)
          : "healthy",
    series: busySeries,
    stale: extStale || busySeries.length === 0,
    lastGoodLabel,
  };

  // Disk I/O — per-device read+write bytes Δ (sectors ×512 upstream). Unbanded
  // throughput evidence: healthy accent when data exists, honest-stale when not.
  const disks = ext?.derived.disks ?? [];
  const diskSeries = disks
    .map((d) =>
      d.readBytesDelta === null && d.writeBytesDelta === null
        ? null
        : (d.readBytesDelta ?? 0) + (d.writeBytesDelta ?? 0),
    )
    .filter((v): v is number => v !== null);
  const diskTotal = diskSeries.length > 0 ? diskSeries.reduce((a, b) => a + b, 0) : null;
  const diskIo: VmVitalChart = {
    key: "disk-io",
    label: "Disk I/O · Δ tick (all devices)",
    value: diskTotal !== null ? fmtBytes(diskTotal) : "—",
    sev: diskTotal !== null ? "healthy" : "stale",
    series: diskSeries,
    stale: extStale || diskSeries.length === 0,
    lastGoodLabel,
  };

  // Network — per-iface errors+drops Δ; severity is worst-of the banded TCP
  // retransmit rate (D-14) and the hard-zero errs/drops rule (any Δ>0 → warning).
  const ifaces = ext?.derived.netIfaces ?? [];
  const ifaceSeries = ifaces
    .map((i) => {
      const parts = [i.rxErrsDelta, i.txErrsDelta, i.rxDropDelta, i.txDropDelta];
      if (parts.every((p) => p === null)) return null;
      return parts.reduce<number>((a, b) => a + (b ?? 0), 0);
    })
    .filter((v): v is number => v !== null);
  const errsTotal = ifaceSeries.length > 0 ? ifaceSeries.reduce((a, b) => a + b, 0) : null;
  const netSevs: Severity[] = [];
  if (errsTotal !== null) netSevs.push(errsTotal > 0 ? "warning" : "healthy");
  const retrans = ext?.derived.tcpRetransmitRate ?? null;
  if (retrans !== null) netSevs.push(severityFromBand(retrans.band));
  const netErrs: VmVitalChart = {
    key: "net-errs",
    label: "Net errors+drops · Δ tick (all ifaces)",
    value: errsTotal !== null ? `${errsTotal.toLocaleString("en-US")}` : "—",
    sev: netSevs.length > 0 ? worstSeverity(netSevs) : "stale",
    series: ifaceSeries,
    stale: extStale || ifaceSeries.length === 0,
    lastGoodLabel,
  };

  return [cpuCores, diskIo, netErrs];
}

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

/**
 * Per-node active signals: filter the SAME engine card set by exact pubkey and map
 * each into a NodeSignal. Fleet-scope cards (node === null) are fleet-scope by
 * definition and never surface per-node. The adaptive action is a READ-ONLY
 * investigate drill to the card's deep link — the AI path emits nothing (D-04).
 */
function buildNodeSignals(cards: InsightCard[], pubkey: string): NodeSignal[] {
  return cards
    .filter((card) => card.node?.pubkey === pubkey)
    .map((card, i) => {
      const e = card.evidence;
      return {
        id: `${card.signal}:${i}`,
        sev: severityFromInsight(card.severity),
        title: SIGNAL_LABELS[card.signal],
        why: `${e.metric} ${e.observed} ${e.unit} vs ${e.threshold} — ${e.window}`,
        action: { kind: "investigate", href: e.deepLink },
      };
    });
}

interface PageProps {
  params: Promise<{ pubkey: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { pubkey } = await params;
  if (!PUBKEY_RE.test(pubkey)) return { title: "Node not found" };
  const fleet = await getFleet();
  // PERF-01 no-404 fallback for a >30d-stale node dropped by the bounded read.
  const node =
    fleet.nodes.find((n) => n.pubkey === pubkey) ?? (await latestNodeInfoFallback(pubkey));
  if (!node) return { title: "Node not found" };
  return { title: `${node.alias ?? shortPubkey(node.pubkey)} — Node Detail` };
}

/** Everything the page renders that survives the fail-soft supplementary reads. */
interface DetailData {
  node: ScorecardView;
  hostId: string | undefined;
  hostname: string | null;
  infraServices: ServiceHealthState[];
  lqwdServices: ServiceHealthState[];
  /** Aggregate capacity-weighted liquidity split (G4) for the gauge + summary strip. */
  liquidity: LiquiditySplit;
  /** Active channel count (projected rows). */
  channelCount: number;
  /** Connected peers (honest num_peers) for the summary strip; null when unknown. */
  numPeers: number | null;
  /** Shown channel partners — the honest tab-bar peer count (matches /peers). */
  shownPartners: number;
  signals: NodeSignal[];
  logs: NodeLogLine[];
  overall: Severity;
  /** B2 — real 24h VM vitals for the resolved host; empty when no host resolves. */
  vitals: VmVitalChart[];
}

export default async function NodeDetailPage({ params }: PageProps) {
  const { pubkey } = await params;

  // ASVS V5 (T-13-15-01) — validate the segment BEFORE any warehouse read.
  if (!PUBKEY_RE.test(pubkey)) notFound();

  let data: DetailData | null = null;
  let loadFailed = false;
  try {
    const fleet = await getFleet();
    // PERF-01 no-404 fallback: a >30d-stale node still renders from the single-node
    // snapshot; only a genuinely-never-seen pubkey resolves to null (→ notFound).
    const node =
      fleet.nodes.find((n) => n.pubkey === pubkey) ?? (await latestNodeInfoFallback(pubkey));

    if (node !== null) {
      // ── Fail-soft supplementary reads (fail-soft truth) ─────────────────────
      // Each read carries its OWN `.catch`, so one broken layer degrades to an
      // honest empty section rather than taking the page down.
      const hosts: HostMetricsView[] = await getLatestHostMetrics().catch(() => []);
      const serviceArrays = await Promise.all(
        hosts.map((h) => getServiceHealth(h.hostId).catch(() => [] as ServiceHealthState[])),
      );
      const allServices = serviceArrays.flat();

      // Drift 3 — resolve pubkey→hostId FIRST, then partition node-scoped LQWD vs
      // host-level infra services. A raw pubkey never reaches the host-keyed read.
      const resolved = resolveNodeServices({ pubkey, services: allServices });

      // WR-05: latest-channel rows are read ONCE — the same snapshot feeds both
      // the liquidity aggregate and the peers headline (via peersTabData).
      const [rawChannels, insightView] = await Promise.all([
        latestChannelsForNode(pubkey).catch(() => null),
        loadInsightView().catch(() => null),
      ]);
      const peers = await peersTabData(pubkey, rawChannels ?? undefined).catch(
        () =>
          ({ headline: { numPeers: null, shownPartners: 0 }, rows: [], asOf: null }) as PeersTabView,
      );

      const channelRows = rawChannels ? rawChannels.map((row) => projectChannelBaseline(row)) : [];
      // G4 — capacity-weighted aggregate split; honest-null share when no routable balance.
      const liquidity = aggregateLiquidity(channelRows);
      const signals = insightView ? buildNodeSignals(insightView.cards, pubkey) : [];

      // Overall health pill = worst-of the node's own rung + its attributed
      // service rungs (D-02 worst-of across layers).
      const serviceSeverities = [...resolved.infraServices, ...resolved.lqwdServices].map(
        severityFromService,
      );
      const overall = worstSeverity([nodeSeverity(node), ...serviceSeverities]);

      const vitalsHost = resolved.hostId
        ? (hosts.find((h) => h.hostId === resolved.hostId) ?? null)
        : null;
      const hostname = vitalsHost?.hostname ?? null;

      // B2 — VM vitals back-fill (RESEARCH Q2): the resolved host's real 24h
      // history, graded read-time and handed to the presentation-pure VmVitals.
      // A node with no resolvable host keeps honest-empty charts (unchanged).
      let vitals: VmVitalChart[] = [];
      if (vitalsHost !== null) {
        const [metricsHistory, storageHistory, hostExt] = await Promise.all([
          getHostMetricsHistory(vitalsHost.hostId, VITALS_WINDOW_MS).catch(
            () => [] as Awaited<ReturnType<typeof getHostMetricsHistory>>,
          ),
          getHostStorageHistory(vitalsHost.hostId, VITALS_WINDOW_MS).catch(
            () => new Map<string, StorageGrowthSample[]>(),
          ),
          // COL-03 (Plan 15-08): deep-VM metrics — fail-soft to null so an absent
          // reader/table (0003 operator gate) degrades to honest StaleChart panels.
          getHostMetricsExt(vitalsHost.hostId).catch(() => null),
        ]);
        // B7 — the base CPU/mem/disk vitals always render (real 24h history). The
        // three COL-03 deep charts are appended ONLY when the deep-metrics reader
        // actually resolved — a null reader (absent table / 0003 gate) must NOT
        // paint three permanent "NO FRESH DATA" panels that train the operator to
        // ignore stale (audit B7).
        vitals = [...buildHostVitals(vitalsHost, metricsHistory, storageHistory)];
        if (hostExt !== null) {
          vitals.push(...buildDeepVitals(hostExt));
        }
      }

      // COL-01 (Plan 15-08): real per-host log stream — benign-suppressed at read
      // (Plan 15-03), keyed by the RESOLVED hostId (Drift 3: never the raw pubkey).
      // Fail-soft: a broken/absent reader (0003 operator gate) degrades to
      // NodeLogsStream's honest empty state, never a page crash.
      const logView = resolved.hostId
        ? await getServiceLogEvents(resolved.hostId, null).catch(() => null)
        : null;

      data = {
        node,
        hostId: resolved.hostId,
        hostname,
        infraServices: resolved.infraServices,
        lqwdServices: resolved.lqwdServices,
        liquidity,
        channelCount: channelRows.length,
        numPeers: peers.headline.numPeers,
        shownPartners: peers.headline.shownPartners,
        signals,
        // Newest-first NodeLogLine rows straight from the reader (all formatting
        // happened reader-side); empty view/failed read → honest empty state.
        logs: logView?.lines ?? [],
        overall,
        vitals,
      };
    }
  } catch (error) {
    // A TOTAL read failure (not a per-section degrade) → honest read-only copy.
    console.error("Node Detail load failed:", error);
    loadFailed = true;
  }

  if (loadFailed) {
    // B2 — honest read-failure INSIDE the shell so the rail/nav never vanishes.
    return (
      <BoardError
        active="nodes"
        opsNav={OPS_NAV}
        title="Node Detail"
        heading="Couldn't load this node."
        body="The warehouse/telemetry reads didn't respond. Your data is unchanged — this view is read-only. Check the connections and reload."
      />
    );
  }

  // notFound() lives OUTSIDE the try so its control-flow signal is never swallowed.
  if (data === null) notFound();

  const {
    node,
    hostId,
    hostname,
    infraServices,
    lqwdServices,
    liquidity,
    channelCount,
    numPeers,
    shownPartners,
    signals,
    logs,
    overall,
    vitals,
  } = data;
  const alias = node.alias ?? shortPubkey(node.pubkey);

  return (
    <NavRailShell active="nodes" title={alias} subtitle="Node Detail" showFleetSummary={false} showLivePill={false}>
      {/* G1/G3 — the LEAN overview column, tightened (max-width 1180px, no dead space). */}
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 pb-16">
        {/* B1 — identity header. */}
        <NodeHeader
          pubkey={node.pubkey}
          alias={node.alias}
          backend={node.backend}
          host={hostId ? { hostId, label: hostname ?? hostId } : null}
          overall={overall}
          asOf={node.asOf}
          stale={node.stale}
        />

        {/* Summary counts + the shared tab bar → the routed channels/peers/forwards
            sub-routes (the heavy tables now live there, not here — G1). Local-share is
            NOT repeated here — the LiquidityGauge below owns every liquidity figure
            (audit E). */}
        <NodeSummaryStrip
          channelCount={channelCount}
          peerCount={numPeers}
          capacitySat={liquidity.capacitySat}
        />
        <NodeDetailTabs
          pubkey={node.pubkey}
          active="overview"
          counts={{ channels: channelCount, peers: shownPartners }}
        />

        {/* G4 — the aggregate capacity-weighted liquidity gauge, honest-empty when
            there are no channels. Neutral evidence, never a health/navy hue. */}
        <LiquidityGauge
          label="Node liquidity"
          size="lg"
          localSat={liquidity.localSat}
          remoteSat={liquidity.remoteSat}
          capacitySat={liquidity.capacitySat}
          localShare={liquidity.localShare}
        />

        {/* B2 — VM vitals: the resolved host's real 24h history (RESEARCH Q2), graded
            read-time. A node with no resolvable host keeps honest-empty charts; a
            stale host degrades each chart to the honest StaleChart placeholder. */}
        <VmVitals charts={vitals} />

        {/* B3 — supporting-services cross-ref strip. The node view is Lightning ops;
            the services that TEND this node are host-owned, so they surface here only
            as a compact strip that links to the host (where they're remediated) and
            lights up when a dependency is down/dead (Drift-3 resolveNodeServices). */}
        <NodeSupportingServices
          hostId={hostId}
          hostLabel={hostname ?? hostId ?? undefined}
          infraServices={infraServices}
          lqwdServices={lqwdServices}
        />

        {/* B6 — active signals (advisory-only) + B4 — service-filterable logs. */}
        <NodeActiveSignals signals={signals} />
        <NodeLogsStream logs={logs} />

        {/* B7 — the zero-credential read-only safety posture, on every load. */}
        <ReadOnlySafetyPosture />
      </div>
    </NavRailShell>
  );
}
