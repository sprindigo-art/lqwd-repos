import { notFound } from "next/navigation";

import { getLatestHostMetrics, type HostMetricsView } from "@/lib/read/host-metrics";
import {
  getServiceHealth,
  type ServiceHealthState,
} from "@/lib/read/service-health";
import { resolveNodeServices } from "@/lib/read/node-services";
import { getChainTelemetry, type ChainTelemetryView } from "@/lib/read/chain-telemetry";
import { getServiceLogEvents } from "@/lib/read/service-log-events";
import { serviceDisplay } from "@/lib/overview/service-display";
import { loadFleetView } from "@/lib/scorecard/fleet";
import { DF } from "@/lib/df/tokens";
import type { BandSeverity } from "@/lib/read/telemetry-bands";
import { ServiceDetailShell, ServiceHeader } from "@/components/service/ServiceDetailShell";
import { ServiceVitals } from "@/components/service/ServiceVitals";
import { ServiceLogTail } from "@/components/service/ServiceLogTail";
import { RestartHistory } from "@/components/service/RestartHistory";
import { Dependents } from "@/components/service/Dependents";
import { VerifyFirstRunbook } from "@/components/service/VerifyFirstRunbook";
import type { AiReadLine } from "@/components/df/AiReadPanel";
import type { BlastTarget } from "@/components/df/BlastRadius";
import type { WhyChainEvent } from "@/components/df/WhyChain";

// Live warehouse read at request time (Server Component) — never prerendered.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// =====================================================
// SVC-02 — Service Detail at /{pubkey}/service/{service}
// =====================================================
// ONE component tree, two DATA variants — infra (`bitcoind`) and custom-service
// (`addressBalances`) — differing ONLY in the data source + which evidence chart
// C2 shows. The chrome (C1 shell/header) and every other section are variant-
// agnostic. No new primitive, no write path: this route composes the shipped df
// primitives + the Plan-05 resolver + chain-telemetry.
//
// Validation gauntlet (ASVS V5) — EVERYTHING before any warehouse read:
//   1. PUBKEY_RE on the pubkey segment                     → notFound()
//   2. SERVICE_SLUG_RE format whitelist on the service seg → notFound()
// Only format-validated values reach the read layer; the service segment is never
// concatenated into SQL (reads are keyed by hostId, parameter-bound). Existence
// (does this service actually run on this node?) is a SECOND gate after the read:
// an unattached node or an unknown service on the node → notFound().
//
// Data source branch (the ONLY variant split):
//   • infra   → getChainTelemetry() for the owning host → blocks-behind + D-14 band
//   • custom  → resolveNodeServices() → the one ServiceHealthState by serviceName
// The two-axis header verdict comes from the service's own ServiceHealthState in
// BOTH variants (bitcoind is a host-level service in the inventory). Supplementary
// reads are fail-soft (`.catch`) so one broken layer never takes the page down.

const PUBKEY_RE = /^[0-9a-f]{66}$/;
// A service machine key: leading alnum, then alnum / _ / - (camelCase or lowercase).
const SERVICE_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** Map a D-14 telemetry band severity to its DF accent hex. */
function bandAccent(band: BandSeverity): string {
  switch (band) {
    case "critical":
      return DF.critical;
    case "warn":
      return DF.warning;
    case "healthy":
      return DF.ok;
  }
}

/** Truncate a 66-hex pubkey to the `8…6` glance form. */
function shortPubkey(pubkey: string): string {
  return pubkey.length > 16 ? `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}` : pubkey;
}

/** Humanize a Date into a short "…ago" age string; null → undefined. */
function relativeAge(date: Date | null, nowMs: number): string | undefined {
  if (date === null) return undefined;
  const sec = Math.round(Math.max(0, nowMs - date.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** Honest heartbeat / last-run projection from a service's real fact fields. */
function projectVitals(
  svc: ServiceHealthState,
  nowMs: number,
): { heartbeat?: string; lastRun?: string } {
  const collectorAge = relativeAge(svc.collectedAt, nowMs);
  const heartbeat =
    collectorAge === undefined
      ? undefined
      : svc.collectorStale
        ? `stale · ${collectorAge}`
        : collectorAge;
  const successAge = relativeAge(svc.lastSuccessAt, nowMs);
  const lastRun =
    svc.noData || successAge === undefined
      ? undefined
      : svc.running && !svc.functioning
        ? `failed · last ok ${successAge}`
        : `${successAge} · ok`;
  return { heartbeat, lastRun };
}

interface PageProps {
  params: Promise<{ pubkey: string; service: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { pubkey, service } = await params;
  if (!PUBKEY_RE.test(pubkey) || !SERVICE_SLUG_RE.test(service)) {
    return { title: "Service not found" };
  }
  return { title: `${serviceDisplay(service).label} — service` };
}

export default async function ServiceDetailPage({ params }: PageProps) {
  const { pubkey, service } = await params;

  // ── Validation gauntlet — before ANY read (ASVS V5). ────────────────────────
  if (!PUBKEY_RE.test(pubkey)) notFound();
  if (!SERVICE_SLUG_RE.test(service)) notFound();

  const now = new Date();
  const nowMs = now.getTime();

  // ── Reads (strictly AFTER validation), each fail-soft. ──────────────────────
  const [hosts, fleet] = await Promise.all([
    getLatestHostMetrics().catch((error: unknown) => {
      console.error("Host metrics load failed:", error);
      return [] as HostMetricsView[];
    }),
    loadFleetView().catch((error: unknown) => {
      console.error("Fleet view load failed:", error);
      return { nodes: [], fetchedAt: new Date() };
    }),
  ]);

  // Services are per-declared-host (inventory-driven) — a second fail-soft stage
  // keyed off the host dimension, mirroring the overview's service load.
  const serviceArrays = await Promise.all(
    hosts.map((host) =>
      getServiceHealth(host.hostId).catch((error: unknown) => {
        console.error(`Service health load failed for ${host.hostId}:`, error);
        return [] as ServiceHealthState[];
      }),
    ),
  );
  const services = serviceArrays.flat();

  // pubkey → hostId + attributed services (Drift-3 guard: never keys off the raw
  // pubkey for a host-keyed read). Unattached node → honest empty → notFound().
  const { hostId, lqwdServices, infraServices } = resolveNodeServices({ pubkey, services });
  if (hostId === undefined) notFound();

  // Existence gate: the routed service MUST actually run on this node/host. Search
  // both partitions (bitcoind is a host-level infra service). WR-03: the routed
  // segment resolves CASE-INSENSITIVELY against the inventory, and the inventory's
  // canonical serviceName drives everything downstream (isInfra branch, display,
  // runbook key) — casing drift between URL and inventory can never flip a
  // host-critical bitcoind onto the low-ceremony custom runbook.
  const serviceLower = service.toLowerCase();
  const svc =
    [...infraServices, ...lqwdServices].find(
      (s) => s.serviceName.toLowerCase() === serviceLower,
    ) ?? null;
  if (svc === null) notFound();
  const canonicalService = svc.serviceName;
  const isInfra = canonicalService.toLowerCase() === "bitcoind";

  const nodeAlias = fleet.nodes.find((n) => n.pubkey === pubkey)?.alias ?? null;
  const display = serviceDisplay(canonicalService);
  const { heartbeat, lastRun } = projectVitals(svc, nowMs);
  const lastGoodLabel =
    svc.collectedAt !== null ? `last good ${relativeAge(svc.collectedAt, nowMs)}` : undefined;

  // Header freshness = collector-freshness (has this service reported?). A stale
  // collector tick OR no-data reads honestly stale, never faked-fresh.
  const headerStale = svc.collectorStale || svc.noData;

  // ── C2 evidence — the ONLY variant split. ───────────────────────────────────
  let evLabel: string;
  let evValue: string;
  let evValueColor: string;
  let accent: string;
  // Chart-staleness: infra keys off the CHAIN row's staleness; custom off the
  // service's functioning-staleness. Either way we never fabricate a line.
  let chartStale: boolean;

  if (isInfra) {
    const chain = await getChainTelemetry()
      .then((views: ChainTelemetryView[]) => views.find((c) => c.hostId === hostId) ?? null)
      .catch((error: unknown) => {
        console.error("Chain telemetry load failed:", error);
        return null;
      });
    const blocksBehind = chain?.blocksBehind ?? null;
    const band = chain?.bands.blocksBehind?.band ?? null;
    accent = band !== null ? bandAccent(band) : DF.faint;
    evLabel = "Blocks behind chain tip · latest";
    evValue =
      blocksBehind === null ? "no data" : `${blocksBehind === 0 ? "0" : `+${blocksBehind}`} blocks`;
    evValueColor = accent;
    // Stale when the chain row is stale / never reported, OR blocks-behind is absent.
    chartStale = chain === null || chain.stale || !chain.hasData || blocksBehind === null;
  } else {
    // Custom variant: run-success / error-count evidence off the service state.
    accent =
      svc.errorCount > 5 ? DF.critical : svc.errorCount > 0 ? DF.warning : DF.ok;
    evLabel = "Errors this window · last run";
    evValue = `${svc.errorCount.toLocaleString("en-US")} error${svc.errorCount === 1 ? "" : "s"}`;
    evValueColor = accent;
    chartStale = svc.stale || svc.noData;
  }

  // ── C3–C5 supplementary surfaces ────────────────────────────────────────────
  // AI read (C3, advisory-only): ONE deterministic line off the real two-axis
  // state — never a runnable command, never a fabricated claim. Empty when healthy.
  const aiLines: AiReadLine[] = [];
  if (svc.noData) {
    aiLines.push({
      sev: "stale",
      head: `${display.label} has no fresh telemetry. `,
      body: "Shown as last-known, not current — confirm the collector is reporting.",
    });
  } else if (!svc.running) {
    aiLines.push({
      sev: "critical",
      head: `${display.label} is down. `,
      body: `The process is not running on ${hostId}.`,
    });
  } else if (!svc.functioning) {
    aiLines.push({
      sev: "critical",
      head: `${display.label} is up but not functioning. `,
      body: "The process is running yet its work is failing — treat its outputs as stale until it recovers.",
    });
  } else if (svc.errorCount > 0) {
    aiLines.push({
      sev: "warning",
      head: `${display.label} logged ${svc.errorCount} error${svc.errorCount === 1 ? "" : "s"} this window. `,
      body: "Functioning for now — watch for a trend.",
    });
  }

  // Log tail (C3) — COL-01 real per-service stream (Plan 15-08, reader Plan 15-03):
  // benign-suppressed at read, newest-first. This read sits STRICTLY AFTER the
  // PUBKEY_RE/SERVICE_SLUG_RE gauntlet and is keyed by the RESOLVED hostId + the
  // inventory's canonicalService — the raw URL segment never reaches SQL
  // (T-15-01; both are bound params in the reader). Fail-soft: a broken/absent
  // reader (0003 operator gate) degrades to the honest empty state.
  const logView = await getServiceLogEvents(hostId, canonicalService).catch(
    (error: unknown) => {
      console.error(`Service log load failed for ${hostId}/${canonicalService}:`, error);
      return null;
    },
  );
  // LOG_COLUMNS row shape {time, level, message} — all strings pre-formatted
  // reader-side (ts/level narrowing); message stays inert React-escaped text.
  const logRows: Record<string, string>[] = (logView?.lines ?? []).map((line) => ({
    time: line.ts,
    level: line.level,
    message: line.message,
  }));

  // Restart history (C4): no sanctioned reader in the current read model. B7 —
  // rather than render a PERMANENT empty "Restart history" section (scaffolding
  // that trains the operator to ignore it), the section is OMITTED entirely while
  // there are no events; it returns the moment a real reader supplies them.
  const restartEvents: WhyChainEvent[] = [];

  // Dependents / blast radius (C5) — DERIVED from the ownership containment (the
  // services' (hostId, nodePubkey) pairs), never a fabricated list. A host-level
  // infra service (bitcoind) fans out to every node attributed to its host; a
  // node-scoped service has no cross-node dependents in this model.
  const dependentTargets: BlastTarget[] =
    svc.nodePubkey === null
      ? [
          ...new Set(
            services
              .filter((s) => s.hostId === hostId && s.nodePubkey !== null)
              .map((s) => s.nodePubkey as string),
          ),
        ].map((pk) => ({
          name: fleet.nodes.find((n) => n.pubkey === pk)?.alias ?? shortPubkey(pk),
          note: "shares this host",
        }))
      : [];
  const rootStatus = `${display.label} — ${
    svc.running && svc.functioning ? "healthy" : svc.running ? "up · not healthy" : "down"
  }`;

  return (
    <ServiceDetailShell
      navTitle={display.label}
      navSubtitle={nodeAlias ?? undefined}
      pollSinceMs={nowMs}
      header={
        <ServiceHeader
          serviceLabel={display.label}
          description={display.description || undefined}
          pubkey={pubkey}
          nodeAlias={nodeAlias}
          hostId={hostId}
          running={svc.running}
          functioning={svc.functioning}
          heartbeat={heartbeat}
          lastRun={lastRun}
          errorCount={svc.errorCount}
          asOf={svc.collectedAt}
          stale={headerStale}
          now={now}
        />
      }
    >
      <ServiceVitals
        heartbeat={heartbeat}
        lastRun={lastRun}
        errorCount={svc.errorCount}
        stale={chartStale}
        lastGoodLabel={lastGoodLabel}
        evLabel={evLabel}
        evValue={evValue}
        evValueColor={evValueColor}
        accent={accent}
        idSuffix={`-svc-${canonicalService}`}
      />

      <ServiceLogTail rows={logRows} aiLines={aiLines} />

      {/* B7 — only render the restart timeline when there are real events; no
          permanent empty-scaffolding section. */}
      {restartEvents.length > 0 && <RestartHistory events={restartEvents} />}

      <Dependents rootLabel={hostId} rootStatus={rootStatus} targets={dependentTargets} />

      <VerifyFirstRunbook
        variant={isInfra ? "infra" : "custom"}
        serviceLabel={display.label}
        serviceKey={canonicalService}
        hostId={hostId}
      />
    </ServiceDetailShell>
  );
}
