import type { GroupedIncident } from "@/lib/overview/incidents";
import type { HostRunbook } from "@/lib/overview/host-runbook";
import { SeverityCard, type SeverityChild } from "@/components/df/SeverityCard";
import { CommandModal } from "@/components/df/CommandModal";
import { severityLabel } from "@/components/df/Severity";

// =====================================================
// HostIncidentBanner (HOST-02 · B2 / D-11) — incident chrome + inert runbook
// =====================================================
// The root-cause incident banner on Host Detail. It renders ONLY when the page
// found a host-keyed `GroupedIncident` for this host — there is NO healthy/green
// variant in this component (the page omits it entirely when the host is clear).
//
// Composition over reimplementation: the incident chrome + affected children are
// a `SeverityCard` (always-open drawer, children in ENGINE ORDER — never re-ranked);
// the verify-first runbook is the inert `CommandModal` with `kind: "runbook"`.
//
// D-11 (HARD): there is NO incident lifecycle here — no incident-detail deep link,
// button, or disabled placeholder of any kind. The only action surface is the
// inert `Open runbook` trigger, which copies commands to the clipboard and NEVER
// executes anything (the dashboard holds no node credentials — zero write path).
//
// The banner COMPUTES nothing: the page maps the incident's driver class →
// `buildHostRunbook` and passes the result in. This leaf only composes.

interface HostIncidentBannerProps {
  /** The host-keyed incident (severity, driver, children with one-line whys). */
  incident: GroupedIncident;
  /** The verify-first runbook for the incident's driver class (page-supplied). */
  runbook: HostRunbook;
}

/**
 * The Host-Detail incident banner. `SeverityCard` chrome at the incident severity
 * carries the root-cause driver line and the affected children (rendered in engine
 * order), and the inert `Open runbook` modal exposes the verify-first steps + the
 * copy-to-run command. Rendered only when an incident exists.
 */
export function HostIncidentBanner({ incident, runbook }: HostIncidentBannerProps) {
  // Root-cause driver = the FIRST child (engine order preserved — never re-ranked)
  // whose rung matches the incident. Its label + one-line why is the driver line.
  const driver = incident.children.find((c) => c.severity === incident.severity);
  const whyLine = driver ? `driven by: ${driver.entityLabel} — ${driver.why}` : incident.why;

  // Affected children, IN ENGINE ORDER — each carries its own one-line why and its
  // own severity-colored state word. The array is mapped, never re-ordered.
  const childAlerts: SeverityChild[] = incident.children.map((child) => ({
    sev: child.severity,
    node: child.entityLabel,
    note: child.why,
    status: severityLabel[child.severity],
    statusSev: child.severity,
  }));

  return (
    <section className="flex flex-col gap-3">
      <SeverityCard
        sev={incident.severity}
        title={incident.entityLabel}
        why={whyLine}
        childAlerts={childAlerts}
        childrenLabel="Affected"
        expanded
      />

      {/* Verify-first runbook — the ONLY action surface (D-11). Inert: copies the
          command, never executes it. No incident-lifecycle affordance exists. */}
      <div className="flex">
        <CommandModal
          kind="runbook"
          sev={incident.severity}
          title={runbook.title}
          runbook={runbook.runbook}
          command={runbook.command}
          trigger={
            <button
              type="button"
              className="rounded-df-btn bg-df-chrome px-3.5 py-2 text-[12.5px] font-semibold text-white"
            >
              Open runbook
            </button>
          }
        />
      </div>
    </section>
  );
}
