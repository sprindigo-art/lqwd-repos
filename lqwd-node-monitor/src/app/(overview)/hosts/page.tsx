import type { ReactNode } from "react";

import { getLatestHostMetrics, type HostMetricsView } from "@/lib/read/host-metrics";
import { getChainTelemetry, type ChainTelemetryView } from "@/lib/read/chain-telemetry";
import { getServiceHealth, type ServiceHealthState } from "@/lib/read/service-health";
import { loadFleetView } from "@/lib/scorecard/fleet";
import type { ScorecardView } from "@/lib/scorecard/types";
import { buildOwnershipMap } from "@/lib/overview/ownership";
import { buildHostRollup } from "@/lib/overview/host-rollup";
import {
  applyHostFilters,
  parseHostFacets,
  sortHostsWorstFirst,
  type HostFilterRow,
} from "@/lib/overview/host-filter";
import { severityFromBand } from "@/lib/overview/severity-map";
import { formatBytes } from "@/lib/format/units";
import { TELEMETRY_BANDS, evaluateBand } from "@/lib/read/telemetry-bands";
import type { Severity } from "@/components/df/Severity";
import { NavRailShell, type FleetCounts, type OpsNavItem } from "@/components/df/NavRailShell";
import { BoardError } from "@/components/df/BoardError";
import { BoardEmpty } from "@/components/df/BoardEmpty";
import { HostFilters } from "@/components/host/HostFilters";
import {
  HostCard,
  type HostCardModel,
  type HostMeterModel,
  type HostNodeBlock,
  type HostServiceTile,
} from "@/components/host/HostCard";

// Live warehouse read at request time (Server Component) — never prerendered. A
// client directive here would fail the build: the reads reach the server-only
// nodemon/warehouse clients. All interactivity lives in the `HostFilters` client
// island; this page only reads, derives, filters, sorts.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = { title: "Hosts" };

// ─────────────────────────────────────────────────────────────
// Operator nav — the shared rail, now carrying the Hosts surface. Mirrors the
// overview/nodes arrays so every screen reaches every surface.
// ─────────────────────────────────────────────────────────────
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];


/**
 * scorecard node → df Severity (the sanctioned overview switch): stale dominates,
 * else the node's own critical/warn/ok dot. A switch on the SCORECARD's own field,
 * NOT a df-sev→class chain.
 */
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

/** Coerce a raw bigint|number|string|null column to a finite number, else null. */
function num(v: bigint | number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const HEALTHY_METER: HostMeterModel = { pct: 0, sev: "healthy" };

/**
 * Compute the three resource meters (CPU / MEM / DISK) from a host's LATEST vitals
 * + per-mount storage — zero history reads. Each meter's severity comes from the
 * read-time band (the meter fill is used-%, the severity is band-graded). DISK
 * picks the most-full mount; the disk band is %-FREE, so it receives 100 − used%.
 */
function computeMeters(host: HostMetricsView): {
  cpu: HostMeterModel;
  mem: HostMeterModel;
  disk: HostMeterModel;
} {
  const m = host.metrics;

  // CPU — % only. The collector reports no core count (host_metrics has cpu_pct +
  // load averages, but no nproc/cores column), so there is no honest absolute to
  // show here yet. Wiring real cores needs a collector field + a nodemon column.
  const cpuRaw = num(m?.cpu_pct);
  const cpu: HostMeterModel =
    cpuRaw === null
      ? HEALTHY_METER
      : { pct: cpuRaw, sev: severityFromBand(evaluateBand(cpuRaw, TELEMETRY_BANDS.cpuPctBusy)) };

  const memTotal = num(m?.mem_total_kb);
  const memAvail = num(m?.mem_available_kb);
  let mem: HostMeterModel = HEALTHY_METER;
  if (memTotal !== null && memTotal > 0 && memAvail !== null) {
    const memAvailPct = (memAvail / memTotal) * 100;
    const usedKb = memTotal - memAvail;
    mem = {
      pct: 100 - memAvailPct, // meter fill is USED memory
      sev: severityFromBand(evaluateBand(memAvailPct, TELEMETRY_BANDS.memAvailablePct)),
      // KB columns → bytes for formatBytes; used / total (e.g. "15.7 / 32.0 GiB").
      detail: `${formatBytes(usedKb * 1024, 1)} / ${formatBytes(memTotal * 1024, 1)}`,
    };
  }

  // DISK — the most-full mount drives the single card meter.
  let disk: HostMeterModel = HEALTHY_METER;
  let worstUsed = -1;
  for (const row of host.storage) {
    const total = num(row.total_bytes);
    const used = num(row.used_bytes);
    if (total === null || total <= 0 || used === null) continue;
    const usedPct = (used / total) * 100;
    if (usedPct > worstUsed) {
      worstUsed = usedPct;
      disk = {
        pct: usedPct,
        sev: severityFromBand(evaluateBand(100 - usedPct, TELEMETRY_BANDS.diskPctFree)),
        // Used / total on the worst mount (e.g. "1.2 / 2.9 TiB").
        detail: `${formatBytes(used, 1)} / ${formatBytes(total, 1)}`,
      };
    }
  }

  return { cpu, mem, disk };
}

/** Map a service-health state to a card service tile (no-data → honest unknown row). */
function toServiceTile(svc: ServiceHealthState): HostServiceTile {
  return {
    serviceName: svc.serviceName,
    known: !svc.noData,
    running: svc.running,
    functioning: svc.functioning,
    errorCount: svc.errorCount,
    // Gap B explainability fields for the not-green why-accordion (honest passthrough).
    detail: svc.detail,
    detectionMethod: svc.detectionMethod,
    lastSuccessAt: svc.lastSuccessAt,
    functioningStale: svc.stale,
    collectorStale: svc.collectorStale,
  };
}

/** Core VM-level services that always render (honest no-data row when silent). */
const CORE_VM_SERVICES = new Set(["bitcoind", "postgres"]);

/**
 * VM-level services (nodePubkey === null): the box's own services. bitcoind +
 * postgres ALWAYS render (honest no-data row when silent — they're expected on the
 * VM); every other host-level service (esplora, disk/monitor…) is presence-gated —
 * shown only when it has data, never as a permanent empty row.
 */
function computeVmServices(hostLevelServices: ServiceHealthState[]): HostServiceTile[] {
  return hostLevelServices
    .filter((s) => !s.noData || CORE_VM_SERVICES.has(s.serviceName.toLowerCase()))
    .map(toServiceTile);
}

/** Node-associated scripts running on this VM for one node — presence-gated. */
function computeNodeScripts(nodeScopedServices: ServiceHealthState[]): HostServiceTile[] {
  return nodeScopedServices.filter((s) => !s.noData).map(toServiceTile);
}

/** A loaded host row: the filter/sort keys + the fully-built card model. */
interface HostListRow extends HostFilterRow {
  model: HostCardModel;
}

/** Fleet ramp/tally counts from the card severities (stale is honest, not folded into ok). */
function countSeverities(rows: HostListRow[]): FleetCounts {
  const counts: FleetCounts = { crit: 0, warn: 0, watch: 0, ok: 0 };
  for (const row of rows) {
    if (row.model.sev === "critical") counts.crit += 1;
    else if (row.model.sev === "warning") counts.warn += 1;
    else if (row.model.sev === "watch") counts.watch += 1;
    else if (row.model.hasData && row.model.sev === "healthy") counts.ok += 1;
  }
  return counts;
}

/** Mono uppercase section kicker (overview grammar). */
function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
      {children}
    </div>
  );
}

export default async function HostsListPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Whitelist the operator-editable ?sev/?stale params (V5): invalid values
  // silently widen the view, never throw.
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) for (const v of value) usp.append(key, v);
    else if (value !== undefined) usp.append(key, value);
  }
  const facets = parseHostFacets(usp);
  const isFiltered = facets.sev !== "all" || facets.stale;

  let allRows: HostListRow[];
  let fetchedAt: Date;
  try {
    // D-06: the host enumeration is UNFILTERED — `getLatestHostMetrics()` is already
    // fleet-shaped via the LEFT JOIN from the `hosts` dimension, so a silent host
    // returns a no-data row. NEVER apply a freshness cutoff here (it would hide
    // exactly the declared-but-silent hosts the list must show honestly).
    const hosts = await getLatestHostMetrics();

    // Supplementary reads degrade fail-soft — one broken layer never takes the list
    // down; it just narrows the evidence a card can show.
    const [chain, fleet] = await Promise.all([
      getChainTelemetry().catch((error: unknown) => {
        console.error("Chain telemetry load failed:", error);
        return [] as ChainTelemetryView[];
      }),
      loadFleetView().catch((error: unknown) => {
        console.error("Fleet view load failed:", error);
        return { nodes: [] as ScorecardView[], fetchedAt: new Date() };
      }),
    ]);
    fetchedAt = fleet.fetchedAt;

    const serviceArrays = await Promise.all(
      hosts.map((h) =>
        getServiceHealth(h.hostId).catch((error: unknown) => {
          console.error(`Service health load failed for ${h.hostId}:`, error);
          return [] as ServiceHealthState[];
        }),
      ),
    );
    const services = serviceArrays.flat();

    // Host→node containment: synthesize the edges from service (hostId, nodePubkey)
    // pairs (the shipped incidents.ts convention) — no direct read of a node_pubkeys
    // column. buildOwnershipMap then gives us nodesByHost.
    const nodePubkeysByHost = new Map<string, Set<string>>();
    for (const s of services) {
      if (s.nodePubkey !== null) {
        const set = nodePubkeysByHost.get(s.hostId) ?? new Set<string>();
        set.add(s.nodePubkey);
        nodePubkeysByHost.set(s.hostId, set);
      }
    }
    const ownership = buildOwnershipMap({
      hosts: hosts.map((h) => ({
        hostId: h.hostId,
        nodePubkeys: [...(nodePubkeysByHost.get(h.hostId) ?? [])],
      })),
      services,
    });

    const chainByHost = new Map(chain.map((c) => [c.hostId, c]));
    const scorecardByPubkey = new Map(fleet.nodes.map((n) => [n.pubkey, n]));

    allRows = hosts.map((host) => {
      const hostLevelServices = services.filter(
        (s) => s.hostId === host.hostId && s.nodePubkey === null,
      );

      // On-host node blocks: each node + the node-associated scripts that run on THIS
      // VM for it (host-owned, node-associated). Skip pubkeys with no loaded scorecard.
      const pubkeys = ownership.nodesByHost.get(host.hostId) ?? [];
      const nodeBlocks: HostNodeBlock[] = [];
      const nodeSeverities: Severity[] = [];
      for (const pk of pubkeys) {
        const sc = scorecardByPubkey.get(pk);
        if (sc === undefined) continue;
        const sev = nodeSeverity(sc);
        nodeSeverities.push(sev);
        const nodeScoped = services.filter(
          (s) => s.hostId === host.hostId && s.nodePubkey === pk,
        );
        nodeBlocks.push({
          pubkey: pk,
          alias: sc.alias,
          sev,
          services: computeNodeScripts(nodeScoped),
        });
      }

      const meters = computeMeters(host);
      const vmServices = computeVmServices(hostLevelServices);

      // No-telemetry hosts never reach the rollup (its caller-branch contract): they
      // carry a healthy rollup + the honest stale flag (host-filter's pinned fixture),
      // rendered as the A4 no-telemetry card. Fresh/stale-with-data hosts fold their
      // cross-layer evidence into one worst-of severity + the D-05 driver. The list
      // performs ZERO history reads, so `storage` (days-to-full) carries no
      // contributor here (D-05 scopes the card rollup to infra + nodes + resources).
      const rollup = host.hasData
        ? buildHostRollup({
            host,
            services: hostLevelServices,
            chain: chainByHost.get(host.hostId) ?? null,
            nodeSeverities,
            storage: [],
          })
        : { sev: "healthy" as Severity, driver: null };

      const model: HostCardModel = {
        hostId: host.hostId,
        hostname: host.hostname,
        sev: rollup.sev,
        driver: rollup.driver,
        hasData: host.hasData,
        stale: host.stale,
        asOf: host.collectedAt,
        cpu: meters.cpu,
        mem: meters.mem,
        disk: meters.disk,
        vmServices,
        nodeBlocks,
      };

      return { hostId: host.hostId, severity: rollup.sev, stale: host.stale, model };
    });
  } catch (error) {
    // Page-level honest-error fallback — read-only view, nothing was mutated.
    // Stays inside the shell (audit B2) so a warehouse blip never strands the operator.
    console.error("Hosts list load failed:", error);
    return (
      <BoardError
        active="hosts"
        opsNav={OPS_NAV}
        title="Hosts"
        heading="Couldn't load host telemetry."
        body="The read model is unreachable — this is a data-source problem, not a host failure. Retry, or check the warehouse connection."
      />
    );
  }

  const rows = sortHostsWorstFirst(applyHostFilters(allRows, facets));

  return (
    <NavRailShell
      active="hosts"
      title="Hosts"
      subtitle="Fleet"
      counts={countSeverities(allRows)}
      // Honest chrome: the pill ticks from the REAL fetch epoch — no fake "Live".
      pollSinceMs={fetchedAt.getTime()}
      opsNav={OPS_NAV}
      showViewToggle={false}
      contentWidth="wide"
    >
      <div className="flex w-full flex-col gap-6 pb-16">
        {/* Header grammar mirrors inbox/pending/queue: h1 + one-line description
            (audit B5) so the board has a real heading outline for AT. */}
        <header className="flex flex-col gap-1">
          <h1 className="text-[17px] font-semibold tracking-[-0.01em] text-df-ink">Hosts</h1>
          <p className="text-sm text-df-muted">
            the VMs behind the fleet · resources, services, and on-host nodes · worst-first
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <SectionKicker>HOSTS · {rows.length}</SectionKicker>
          <HostFilters facets={facets} />
        </section>

        {rows.length === 0 ? (
          isFiltered ? (
            <BoardEmpty
              heading="No matching hosts."
              body="Clear the filter to see all declared hosts."
            />
          ) : (
            <BoardEmpty
              heading="No hosts declared yet."
              body="The hosts dimension is empty — nothing to show."
            />
          )
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {rows.map((row) => (
              <HostCard key={row.hostId} model={row.model} />
            ))}
          </div>
        )}
      </div>
    </NavRailShell>
  );
}
