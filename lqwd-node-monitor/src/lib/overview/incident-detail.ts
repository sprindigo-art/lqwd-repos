// Pure module: no server runtime imports, no DB, no AI SDK — fixture-testable anywhere.
// =====================================================
// incident-detail.ts — Incident Detail view builders (INC-01)
// =====================================================
// The two pure derivations the Incident Detail page composes against: the
// detection why-chain and the blast-radius target set, both mapped straight off
// the deterministic `GroupedIncident` tree `assembleIncidents` produced. Mirrors
// the pure-builder discipline of `ai-band.ts:37-46` — a `GroupedIncident`-shaped
// input → view-primitive-shape `.map`, NO DB, NO `server-only`, inputs never
// mutated, and NO `.sort` (engine order is LAW — incidents.ts:18-22; the children
// array already reads root-cause-first and is rendered verbatim).

import type { Severity } from "@/components/df/Severity";
import type { WhyChainEvent } from "@/components/df/WhyChain";
import type { BlastTarget } from "@/components/df/BlastRadius";
import type { GroupedIncident } from "@/lib/overview/incidents";

/**
 * Mono "HH:MM" for the detection-chain timestamp. UTC-derived so the format is
 * stable and testable across machine timezones (a monitoring surface reads UTC
 * unambiguously). Callers render "—" for a null `asOf` before ever calling this.
 */
function shortTime(d: Date): string {
  // toISOString() is "YYYY-MM-DDTHH:MM:SS.sssZ" — slice out the "HH:MM".
  return d.toISOString().slice(11, 16);
}

/**
 * The detection why-chain: each incident child becomes one timeline event, IN
 * ENGINE ORDER (root cause first — never reordered). `time` is a pre-formatted
 * mono string ("14:08") when the child carries an `asOf`, or `null` when it is
 * absent (many insight children have `asOf: null` — incidents.ts:70,267) so the
 * spine can OMIT the slot rather than render a wall of "—" (audit A6). `text`
 * pairs the entity label with its one-line reason; `severity` is the child's own.
 */
export function buildWhyChain(incident: GroupedIncident): WhyChainEvent[] {
  return incident.children.map((c) => ({
    time: c.asOf ? shortTime(c.asOf) : null,
    text: `${c.entityLabel} — ${c.why}`,
    severity: c.severity,
  }));
}

/**
 * The blast-radius impacted targets: each NON-fee child becomes one impacted-node
 * pill. Fee-summary children (they carry `feeKind` — incidents.ts:73-81) are fee
 * tuning noise, NOT a blast target, so they are excluded (D-08). Engine order is
 * preserved. Each target carries its OWN `severity` (so the diagram colors by real
 * state, never all-red — audit A3) and its `layer` (so a `VM`/`SERVICE`/`NODE` tag
 * disambiguates the shared entity names — audit C2).
 */
export function buildBlastTargets(incident: GroupedIncident): BlastTarget[] {
  return incident.children
    .filter((c) => c.feeKind === undefined)
    .map((c) => ({ name: c.entityLabel, note: c.why, sev: c.severity, layer: c.layer }));
}

/**
 * The driver child — the one that carries the incident's rolled-up severity, or
 * the first child as a fallback. Mirrors the `incidentRunbook` driver-selection
 * precedent (hosts/[hostId]/page.tsx:131-134). `undefined` for a childless
 * incident. Never re-grades: it selects, it does not compute severity.
 */
export function selectDriver(incident: GroupedIncident): GroupedIncident | undefined {
  return (
    incident.children.find((c) => c.severity === incident.severity) ?? incident.children[0]
  );
}

/** The BlastRadius root-card lines: the host label + the driver's failure reason. */
export interface BlastRoot {
  /** Root-cause host id — rendered mono inside the host card. */
  host: string;
  /** The root-cause failure line — the driver child's `why`, else the incident's own. */
  hostStatus: string;
}

/**
 * Derive the BlastRadius root card. `host` is the incident's entity label; the
 * `hostStatus` line is the driver child's reason (the actual root cause), falling
 * back to the incident's own `why` when it has no children.
 */
export function buildBlastRoot(incident: GroupedIncident): BlastRoot {
  const driver = selectDriver(incident);
  return { host: incident.entityLabel, hostStatus: driver?.why ?? incident.why };
}

// Re-export the consumed severity type for downstream detail-page convenience.
export type { Severity };
