import { TwoAxisPip } from "@/components/df/TwoAxisPip";
import { ServiceWhyAccordion } from "@/components/df/ServiceWhyAccordion";
import { serviceDisplay } from "@/lib/overview/service-display";
import type { ServiceHealthState } from "@/lib/read/service-health";
import { renderNowMs } from "@/lib/time/render-now";

// =====================================================
// ServiceHealthGrid — SVC-01 centerpiece (Server component)
// =====================================================
// Composes N TwoAxisPip tiles under two kicker-grouped sections — INFRASTRUCTURE
// (host-level deps: bitcoind/esplora/postgres) and LQWD SERVICES (node-scoped:
// aiLiquidityManager/internalRebalancer/nodeAuditor/addressBalances/…). Consumes
// the { lqwdServices, infraServices } partition from resolveNodeServices (Task 1).
//
// The two-axis color law is LOCKED in TwoAxisPip.combinedState() — this component
// COMPOSES it, it does NOT re-derive or soften it. Every service renders by its
// TRUE two-axis ServiceHealthState (D-06 supersedes the UI-SPEC B3 "paused = watch"
// hedge): there is NO synthetic paused softener and NO severity remap of a
// functioning service — the read model carries no `paused` field. Service names
// flow through serviceDisplay().label so a raw machine key is never shown.
//
// An empty resolver result renders an honest "no services attributed" empty state,
// never a fabricated green tile. No "use client" — the tiles need no client JS.

/** Mono uppercase section kicker (overview page.tsx grammar). */
function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
      {children}
    </div>
  );
}

/** Humanize a Date into a short "…ago" age string; null → undefined (no footer row). */
function relativeAge(date: Date | null, nowMs: number): string | undefined {
  if (date === null) return undefined;
  const deltaMs = Math.max(0, nowMs - date.getTime());
  const sec = Math.round(deltaMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/**
 * One section (kicker + a responsive grid of TwoAxisPip tiles). Each tile is fed
 * the service's TRUE two-axis state — running/functioning verbatim, never re-graded.
 * heartbeat/lastRun/errorCount are honest projections of the real fact fields:
 * heartbeat = collector-observed age (gold "stale" prefix when the collector is
 * behind), lastRun = last-success age, errorCount = the raw trailing-window count.
 */
function ServiceSection({
  kicker,
  services,
  nowMs,
}: {
  kicker: string;
  services: ServiceHealthState[];
  nowMs: number;
}) {
  if (services.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <SectionKicker>{kicker}</SectionKicker>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {services.map((svc) => {
          const collectorAge = relativeAge(svc.collectedAt, nowMs);
          const heartbeat =
            collectorAge === undefined
              ? undefined
              : svc.collectorStale
                ? `stale · ${collectorAge}`
                : collectorAge;
          const successAge = relativeAge(svc.lastSuccessAt, nowMs);
          // Honest last-run copy: a running-but-not-functioning service failed to
          // keep functioning — flag it "failed" (TwoAxisPip reds it); otherwise the
          // last-success age with an "ok" suffix. no-data ⇒ no last-run row.
          const lastRun =
            svc.noData || successAge === undefined
              ? undefined
              : svc.running && !svc.functioning
                ? `failed · last ok ${successAge}`
                : `${successAge} · ok`;
          const pip = (
            <TwoAxisPip
              running={svc.running}
              functioning={svc.functioning}
              name={serviceDisplay(svc.serviceName).label}
              heartbeat={heartbeat}
              lastRun={lastRun}
              errorCount={svc.errorCount}
            />
          );
          const key = `${svc.hostId}:${svc.serviceName}`;
          // Only a not-green, non-no-data service gains the expand affordance; green
          // and no-data tiles render the bare pip exactly as before (additive).
          if (!svc.green && !svc.noData) {
            return (
              <ServiceWhyAccordion
                key={key}
                detail={svc.detail}
                detectionMethod={svc.detectionMethod}
                errorCount={svc.errorCount}
                lastSuccessAt={svc.lastSuccessAt}
                functioningStale={svc.stale}
                collectorStale={svc.collectorStale}
                nowMs={nowMs}
              >
                {pip}
              </ServiceWhyAccordion>
            );
          }
          return <div key={key}>{pip}</div>;
        })}
      </div>
    </section>
  );
}

interface ServiceHealthGridProps {
  /** Host-level infra services (bitcoind/esplora/postgres) — nodePubkey null. */
  infraServices: ServiceHealthState[];
  /** Node-scoped LQWD services for the routed pubkey. */
  lqwdServices: ServiceHealthState[];
  /** Render clock (defaults to now) — injected for deterministic tests. */
  nowMs?: number;
}

/**
 * SVC-01 centerpiece grid: INFRASTRUCTURE + LQWD SERVICES sections of composed
 * TwoAxisPip tiles. Green iff both axes; up-but-dead unmistakable (locked in the
 * pip). No paused softener (D-06). Empty resolver result → honest empty state.
 */
export function ServiceHealthGrid({
  infraServices,
  lqwdServices,
  nowMs = renderNowMs(),
}: ServiceHealthGridProps) {
  // Presence-gated service (global design principle): Esplora is not on every host
  // — it sits with a single node today — so a no-data Esplora tile is OMITTED rather
  // than shown as a permanent empty card. bitcoind/postgres are host-level and stay,
  // rendering their honest no-data state when silent.
  const infra = infraServices.filter(
    (s) => !(s.serviceName.toLowerCase() === "esplora" && s.noData),
  );
  const isEmpty = infra.length === 0 && lqwdServices.length === 0;

  if (isEmpty) {
    return (
      <div className="rounded-[13px] border border-df-border bg-df-surface p-6 text-center">
        <p className="text-[13.5px] text-df-muted">No services attributed to this node.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ServiceSection kicker="Infrastructure" services={infra} nowMs={nowMs} />
      <ServiceSection kicker="LQWD Services" services={lqwdServices} nowMs={nowMs} />
    </div>
  );
}
