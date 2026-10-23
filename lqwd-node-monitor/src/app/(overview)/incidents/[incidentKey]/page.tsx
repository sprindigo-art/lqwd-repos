import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { loadIncidents } from "@/lib/overview/load-incidents";
import { loadFleetCounts } from "@/lib/overview/fleet-counts";
import { loadActiveTracking } from "@/lib/db/read/incident-tracking";
import {
  reconcileTracking,
  type TrackingRow,
} from "@/lib/overview/incident-tracking";
import {
  buildWhyChain,
  buildBlastTargets,
  buildBlastRoot,
} from "@/lib/overview/incident-detail";
import { type GroupedIncident, type IncidentLayer } from "@/lib/overview/incidents";

import { severityAccent, severityLabel } from "@/components/df/Severity";
import { NavRailShell, type OpsNavItem } from "@/components/df/NavRailShell";
import { FreshnessChip } from "@/components/df/FreshnessChip";
import { WhyChain } from "@/components/df/WhyChain";
import { BlastRadius } from "@/components/df/BlastRadius";
import { LayerTag } from "@/components/df/LayerTag";
import { SeverityRow } from "@/components/df/SeverityRow";
import { type AiReadLine } from "@/components/df/AiReadPanel";
import {
  IncidentTrackingControls,
  type IncidentTrackingState,
} from "@/components/incident/IncidentTrackingControls";
import { IncidentReadClient } from "@/components/incident/IncidentReadClient";
import { SnoozedCriticalBanner } from "@/components/incident/SnoozedCriticalBanner";
import { cn, FOCUS_RING } from "@/lib/utils";

// Live warehouse + nodemon read at request time (Server Component) — never
// prerendered. A client-component directive here would fail the build: the loaders
// below are server-only (lazy warehouse/`dbNodemon` clients).
export const dynamic = "force-dynamic";
export const revalidate = 0;

// =====================================================
// INC-01 — the Incident Detail view at /(overview)/incidents/[incidentKey] (D-10)
// =====================================================
// The centerpiece incident surface. It reads ONE incident from the shared
// `loadIncidents()` loader by its `.key` (GroupedIncident has NO `.hostId` — a
// `.hostId` match silently misses, Plan 04), then composes the LOCKED df
// primitives in the D-10 region order:
//   (1) status header — severity chip (severity ramp, NEVER navy) + host/status +
//       FreshnessChip + the INC-02 tracking controls
//   (2) AI read — on-demand verdict + inert AiReadPanel (AIX-01) + the AIX-02
//       "why grouped" rationale line
//   (3) why-chain — the detection timeline spine (omitted when 0 events)
//   (4) blast-radius — the containment tree (omitted for a host-only incident)
//   (5) grouped child alerts — collapsible <details> per layer, each child a real
//       deep-link to its source (D-11)
// plus the non-dismissible fleet-wide snoozed-critical honesty banner (D-04).
//
// SECURITY GAUNTLET (threat T-17-08): `incidentKey` is operator-editable free
// text. It is shape-validated (KEY_RE) BEFORE any use, then membership-gated
// against the loaded incident set — an unknown key resolves to `notFound()`,
// placed OUTSIDE the try/catch so its control-flow signal is never swallowed. The
// page NEVER echoes a key that failed the gate; a total read failure renders
// honest read-only copy that names no key (mirrors hosts/[hostId] precedent).

/** Operator-editable key gate — same shape as the Plan-05 tracking KEY_RE. */
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** Operator nav — the shared rail plus the surfaces the overview links to. */
const OPS_NAV: OpsNavItem[] = [
  { key: "ops", label: "Home", href: "/" },
  { key: "nodes", label: "Nodes", href: "/nodes" },
  { key: "hosts", label: "Hosts", href: "/hosts" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "pending", label: "Pending", href: "/pending" },
  { key: "queue", label: "Queue", href: "/queue" },
];

/** Human label per incident layer for the grouped-child <details> summary. */
const LAYER_LABEL: Record<IncidentLayer, string> = {
  hosts: "Host",
  services: "Services",
  bitcoind: "bitcoind",
  nodes: "Nodes",
  storage: "Storage",
};

/**
 * Deep-link a child alert to its source (D-11). A fee-summary child already
 * carries its own routable `href` (`/{pubkey}/fees`); a node child routes to its
 * node detail (`/{pubkey}`); host/bitcoind/service/storage children route back to
 * the owning host detail. A child with no derivable source omits the link (the row
 * renders as a plain div rather than a dead `<a>`).
 */
function childHref(child: GroupedIncident, incidentKey: string): string | undefined {
  if (child.href !== undefined) return child.href;
  if (child.key.startsWith("node:")) return `/${child.key.slice("node:".length)}`;
  if (
    child.key.startsWith("bitcoind:") ||
    child.key.startsWith("host:") ||
    child.key.startsWith("service:") ||
    child.layer === "storage"
  ) {
    return `/hosts/${incidentKey}`;
  }
  return undefined;
}

/** One layer bucket of child alerts (first-seen engine order preserved). */
interface ChildGroup {
  layer: IncidentLayer;
  label: string;
  children: GroupedIncident[];
}

/** Partition the incident children into layer buckets, preserving engine order. */
function groupChildren(children: GroupedIncident[]): ChildGroup[] {
  const groups: ChildGroup[] = [];
  const byLayer = new Map<IncidentLayer, ChildGroup>();
  for (const child of children) {
    let group = byLayer.get(child.layer);
    if (group === undefined) {
      group = { layer: child.layer, label: LAYER_LABEL[child.layer], children: [] };
      byLayer.set(child.layer, group);
      groups.push(group);
    }
    group.children.push(child);
  }
  return groups;
}

/** Everything the page renders once the incident is resolved. */
interface DetailData {
  incident: GroupedIncident;
  tracking: IncidentTrackingState;
  snoozedCriticalCount: number;
}

interface PageProps {
  params: Promise<{ incidentKey: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { incidentKey } = await params;
  if (!KEY_RE.test(incidentKey)) return { title: "Incident not found" };
  const incidents = await loadIncidents().catch(() => [] as GroupedIncident[]);
  const incident = incidents.find((i) => i.key === incidentKey);
  // Never echo an unknown key in metadata either — generic title on a miss.
  if (incident === undefined) return { title: "Incident not found" };
  return { title: `${incident.entityLabel} — Incident` };
}

export default async function IncidentDetailPage({ params }: PageProps) {
  const { incidentKey } = await params;

  // Shape-gate the operator-editable key BEFORE any read (T-17-08). An invalid key
  // is an unknown incident → notFound (outside the try, below); it is never echoed.
  const keyValid = KEY_RE.test(incidentKey);

  let data: DetailData | null = null;
  let loadFailed = false;
  if (keyValid) {
    try {
      // MEMBERSHIP GATE — the assembled incident set is the authority. Select THIS
      // incident by `.key` (never `.hostId`, which does not exist and silently
      // misses — Plan 04). A throw here is a total read failure (→ honest copy).
      const incidents = await loadIncidents();
      const incident = incidents.find((i) => i.key === incidentKey);

      if (incident !== undefined) {
        // Tracking is fail-soft: a nodemon read failure degrades the controls to a
        // fresh (empty) state and the banner to zero — it never 500s the detail
        // view (deterministic-first). The pure reconcile gives the fleet-wide
        // snoozed-critical count with no write (this render is read-only).
        const activeRows = await loadActiveTracking().catch(() => [] as TrackingRow[]);
        const { snoozedCriticals } = reconcileTracking(incidents, activeRows, new Date());
        const row = activeRows.find((r) => r.incidentKey === incidentKey);

        data = {
          incident,
          tracking: {
            ackedAt: row?.ackedAt ?? null,
            owner: row?.owner ?? null,
            snoozeUntil: row?.snoozeUntil ?? null,
          },
          snoozedCriticalCount: snoozedCriticals.length,
        };
      }
    } catch (error) {
      // A TOTAL read failure (not a per-section degrade) → honest read-only copy.
      // No key is echoed — the failure is a data-source problem.
      console.error("Incident Detail load failed:", error);
      loadFailed = true;
    }
  }

  if (loadFailed) {
    return (
      <main className="py-10">
        <h1 className="text-2xl font-semibold">{"Couldn't load the incident."}</h1>
        <p className="mt-4 text-base text-foreground/70">
          {
            "The read model is unreachable — this is a data-source problem, not an incident failure. This view is read-only; retry, or check the warehouse connection."
          }
        </p>
      </main>
    );
  }

  // notFound() lives OUTSIDE the try so its control-flow signal is never swallowed
  // — and an unknown/invalid key that failed the membership gate is never echoed.
  if (data === null) notFound();

  const { incident, tracking, snoozedCriticalCount } = data;

  const whyEvents = buildWhyChain(incident);
  const blastTargets = buildBlastTargets(incident);
  const blastRoot = buildBlastRoot(incident);
  const childGroups = groupChildren(incident.children);
  const hasBlast = blastTargets.length > 0;

  // AIX-02 rationale (A5): a DISTINCT "why grouped" line describing the grouping
  // STRUCTURE — not `buildBandLines` (built for the multi-incident overview band),
  // which re-printed the entity name twice and echoed the header verbatim. Omitted
  // for a childless (leaf) incident where there is nothing grouped.
  const layerCount = new Set(incident.children.map((c) => c.layer)).size;
  const rationaleLine: AiReadLine | undefined =
    incident.children.length > 0
      ? {
          sev: incident.severity,
          head: "",
          body: `Grouped by owning host · ${incident.children.length} child ${
            incident.children.length === 1 ? "alert" : "alerts"
          } across ${layerCount} ${layerCount === 1 ? "layer" : "layers"}.`,
        }
      : undefined;

  // REAL top-bar fleet counts (U2) — never a fabricated all-clear ramp. A read
  // failure resolves to `undefined` and the shell then omits the summary honestly.
  const fleetCounts = await loadFleetCounts().catch(() => undefined);

  return (
    <NavRailShell
      active="ops"
      title={incident.entityLabel}
      subtitle="Incident Detail"
      pollSinceMs={incident.asOf?.getTime()}
      counts={fleetCounts}
      opsNav={OPS_NAV}
      showViewToggle={false}
    >
      <div className="flex w-full flex-col gap-8 pb-16">
        {/* Non-dismissible fleet-wide snoozed-critical banner (D-04) — sticky just
            BELOW the shell top bar (A9: top-14 clears the z-20 header instead of
            hiding behind it) so muting a critical can never scroll out of sight.
            The wrapper is gated on the count so it never renders an empty sticky
            node (the banner itself returns null at 0). */}
        {snoozedCriticalCount > 0 && (
          <div className="sticky top-14 z-10">
            <SnoozedCriticalBanner count={snoozedCriticalCount} />
          </div>
        )}

        {/* (1) STATUS HEADER — severity chip (ramp, never navy) + identity + type
            tag + freshness + the INC-02 tracking controls (D-10 region 1). */}
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className={cn(
              "w-fit rounded-[3px] font-df-mono text-[11.5px] text-df-brand hover:underline",
              FOCUS_RING,
            )}
          >
            ← Ops Center
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[24px] font-bold leading-[1.15] tracking-[-0.02em] text-df-ink">
              {incident.entityLabel}
            </h1>
            <LayerTag layer={incident.layer} />
            <span className="font-df-mono text-[12.5px] text-df-muted">{incident.key}</span>
            <span
              className={cn(
                "rounded-[5px] px-2 py-0.5 font-df-mono text-[10.5px] font-bold tracking-[0.07em] text-white",
                severityAccent[incident.severity],
              )}
            >
              {severityLabel[incident.severity]}
            </span>
            <FreshnessChip asOf={incident.asOf} stale={incident.stale} />
          </div>
          <p className="text-[13.5px] text-df-muted">{incident.why}</p>
          <IncidentTrackingControls incidentKey={incident.key} tracking={tracking} />
        </header>

        {/* Two-column NOC layout (A1): the reading spine (AI read → detection chain
            → grouped children) fills a bounded measure on the left; the blast-radius
            instrument sits in a sticky right rail so the width is used deliberately
            instead of leaving ~60% dead. Collapses to one column under lg, and to a
            single full-width column when there is no blast radius to show. */}
        <div
          className={cn(
            "grid gap-8 lg:items-start",
            hasBlast && "lg:grid-cols-[minmax(0,1fr)_360px]",
          )}
        >
          <div className="flex min-w-0 max-w-[760px] flex-col gap-8">
            {/* (2) AI READ — verdict + inert AiReadPanel + the AIX-02 rationale
                line. Deterministic-first: absent until EXPLAIN is pressed. */}
            <section className="flex flex-col gap-3">
              <SectionKicker>AI read</SectionKicker>
              <IncidentReadClient
                incidentKey={incident.key}
                worstSeverity={incident.severity}
                rationaleLine={rationaleLine}
              />
            </section>

            {/* (3) DETECTION CHAIN — the why-chain spine. WhyChain's own eyebrow is
                suppressed (label={null}) so this section header isn't printed twice
                (A4). Omitted when the incident has no children. */}
            {whyEvents.length > 0 && (
              <section className="flex flex-col gap-3">
                <SectionKicker>Detection chain</SectionKicker>
                <WhyChain events={whyEvents} label={null} />
              </section>
            )}

            {/* (5) GROUPED CHILD ALERTS — collapsible <details> per layer, each
                child a real deep-link to its source (D-11). The layer is already
                the group header, so it disambiguates shared names here. */}
            <section className="flex flex-col gap-3">
              <SectionKicker>Grouped child alerts</SectionKicker>
              {childGroups.length === 0 ? (
                <div className="rounded-df-card border border-df-border bg-df-surface px-4 py-6 text-center text-[13px] text-df-muted">
                  No grouped child alerts.
                </div>
              ) : (
                childGroups.map((group) => (
                  <details
                    key={group.layer}
                    className="group rounded-df-card border border-df-border bg-df-surface"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-df-mono text-[11.5px] text-df-muted [&::-webkit-details-marker]:hidden">
                      <span className="font-semibold tracking-[0.07em] text-df-ink uppercase">
                        {group.label}
                      </span>
                      <span className="tabular-nums text-df-muted">
                        · {group.children.length}
                      </span>
                    </summary>
                    <div className="flex flex-col gap-2 border-t border-df-border-soft p-3">
                      {group.children.map((child) => (
                        <SeverityRow
                          key={child.key}
                          sev={child.severity}
                          id={child.entityLabel}
                          note={child.why}
                          status={severityLabel[child.severity]}
                          statusSev={child.severity}
                          href={childHref(child, incident.key)}
                        />
                      ))}
                    </div>
                  </details>
                ))
              )}
            </section>
          </div>

          {/* (4) BLAST-RADIUS — the containment view in a sticky right rail (D-10
              region 4 / A1). Omitted for a host-only incident. */}
          {hasBlast && (
            <aside className="flex flex-col gap-3 lg:sticky lg:top-14">
              <SectionKicker>Blast radius</SectionKicker>
              <BlastRadius
                host={blastRoot.host}
                hostStatus={blastRoot.hostStatus}
                rootSev={incident.severity}
                targets={blastTargets}
              />
            </aside>
          )}
        </div>
      </div>
    </NavRailShell>
  );
}

/** Mono uppercase section kicker (overview/host region-eyebrow grammar). A section
 * label is navigational structure, not decoration — df-muted, not the fails-contrast
 * df-faint (audit A10). */
function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
      {children}
    </div>
  );
}
