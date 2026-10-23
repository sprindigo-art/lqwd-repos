import Link from "next/link";

import type { ServiceHealthState } from "@/lib/read/service-health";
import { ServiceWhyAccordion } from "@/components/df/ServiceWhyAccordion";
import { serviceDisplay } from "@/lib/overview/service-display";
import { cn } from "@/lib/utils";
import { renderNowMs } from "@/lib/time/render-now";

// =====================================================
// NodeSupportingServices — the node → host cross-reference strip (Server)
// =====================================================
// A node's own view is pure Lightning ops. The services that TEND this node
// (bitcoind/postgres it depends on, plus the node-associated scripts — rebalancer,
// AI manager, auditor, monitoring) are HOST-OWNED: you remediate them on the VM.
// So the node surfaces them only as a compact cross-reference strip that names the
// host, shows each supporting service's running×functioning state, and links you to
// the host to act. The strip's accent lights to the WORST supporting-service state
// so a down/dead dependency is obvious from the node without leaving Lightning ops.
//
// PRESENTATION-PURE: computes no health beyond folding the already-derived
// running/functioning booleans into the three-state label; the pubkey→hostId
// resolution and the service reads happen upstream (Drift 3).

/** Combined service state: green ONLY when both axes pass; else a red state. */
function serviceState(running: boolean, functioning: boolean): { label: string; ok: boolean } {
  if (running && functioning) return { label: "HEALTHY", ok: true };
  if (running && !functioning) return { label: "UP · NOT HEALTHY", ok: false };
  return { label: "DOWN", ok: false };
}

interface NodeSupportingServicesProps {
  /** The host this node runs on (null when the pubkey couldn't be resolved to a host). */
  hostId: string | undefined;
  /** Operator-facing host label (hostname ?? hostId). */
  hostLabel: string | undefined;
  /** Host-level services the node depends on (bitcoind/postgres/…). */
  infraServices: ServiceHealthState[];
  /** Node-associated scripts running on the host for this node. */
  lqwdServices: ServiceHealthState[];
}

/** One compact supporting-service row — label + running/functioning state chip. */
function ServiceLine({ svc }: { svc: ServiceHealthState }) {
  if (svc.noData) {
    return (
      <div className="flex items-center gap-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-df-ink">
          {serviceDisplay(svc.serviceName).label}
        </span>
        <span className="rounded-df-pill border border-dashed border-df-stale-border bg-df-stale-tint px-2 py-0.5 font-df-mono text-[9px] font-bold tracking-[0.04em] text-df-stale-text uppercase">
          no data
        </span>
      </div>
    );
  }
  const state = serviceState(svc.running, svc.functioning);
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-df-ink">
        {serviceDisplay(svc.serviceName).label}
      </span>
      <span
        className={cn(
          "rounded-df-pill px-2 py-0.5 font-df-mono text-[9px] font-bold tracking-[0.04em] whitespace-nowrap uppercase",
          state.ok ? "bg-df-ok-tint text-df-ok-text" : "bg-df-critical-tint text-df-critical",
        )}
      >
        {state.label}
      </span>
    </div>
  );
}

/**
 * The node → host supporting-services cross-reference strip. Lists every service
 * tending this node (host infra + node-associated scripts) as compact rows and links
 * to the host where they are remediated. When any supporting service is not healthy
 * the strip reads as an alert (critical accent + "needs attention").
 */
export function NodeSupportingServices({
  hostId,
  hostLabel,
  infraServices,
  lqwdServices,
}: NodeSupportingServicesProps) {
  // One clock read for the whole render pass — not per service row.
  const nowMs = renderNowMs();
  // Presence-gated service (global rule): Esplora is not on every host — it sits
  // with a single node today — so a no-data Esplora row is OMITTED here too, matching
  // the host card/detail and node service tiles. bitcoind/postgres stay (honest
  // no-data), and node-associated scripts still surface their state.
  const services = [...infraServices, ...lqwdServices].filter(
    (s) => !(s.serviceName.toLowerCase() === "esplora" && s.noData),
  );

  // No resolvable host / no services → honest empty (the node runs standalone or the
  // host couldn't be resolved). Nothing to cross-reference.
  if (hostId === undefined || services.length === 0) return null;

  // Worst supporting-service state lights the strip: any down/dead/no-data → alert.
  const anyUnhealthy = services.some((s) => s.noData || !(s.running && s.functioning));
  const label = hostLabel ?? hostId;

  return (
    <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-2 border-s-4 px-4 py-2.5",
          anyUnhealthy ? "border-s-df-critical bg-df-critical-tint/40" : "border-s-df-ok",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="font-df-mono text-[10.5px] font-bold tracking-[0.08em] text-df-muted uppercase">
            Supporting services
          </span>
          <span className="font-df-mono text-[11.5px] text-df-muted">· host {label}</span>
          {anyUnhealthy && (
            <span className="rounded-df-pill bg-df-critical-tint px-2 py-0.5 font-df-mono text-[9px] font-bold tracking-[0.04em] text-df-critical uppercase">
              needs attention
            </span>
          )}
        </div>
        <Link
          href={`/hosts/${hostId}`}
          className="font-df-mono text-[11.5px] font-semibold text-df-brand hover:underline"
        >
          Open host →
        </Link>
      </div>
      <div className="flex flex-col divide-y divide-df-border-soft px-4">
        {services.map((svc) => {
          const key = `${svc.hostId}:${svc.serviceName}:${svc.nodePubkey ?? "host"}`;
          const line = <ServiceLine svc={svc} />;
          // Not-green non-no-data supporting services get the honest expand affordance;
          // healthy + no-data lines render unchanged (additive).
          if (!svc.green && !svc.noData) {
            return (
              <div key={key}>
                <ServiceWhyAccordion
                  detail={svc.detail}
                  detectionMethod={svc.detectionMethod}
                  errorCount={svc.errorCount}
                  lastSuccessAt={svc.lastSuccessAt}
                  functioningStale={svc.stale}
                  collectorStale={svc.collectorStale}
                  nowMs={nowMs}
                >
                  {line}
                </ServiceWhyAccordion>
              </div>
            );
          }
          return <div key={key}>{line}</div>;
        })}
      </div>
    </section>
  );
}
