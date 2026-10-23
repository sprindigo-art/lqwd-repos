// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// incident-tracking.ts — the INC-02 tracking state machine (D-04..D-07)
// =====================================================
// Given the engine-ranked incident tree (from `assembleIncidents`), the currently
// active tracking rows, and an injected `now`, this pure function reconciles the
// operator's mute/ack lifecycle into what the queue should SHOW, what the
// always-visible banner must surface, and what tracking WRITES the loader (Plan 05)
// must execute. It never touches the DB and never mutates its inputs — the loader
// owns the write side; this module returns writes as plain data.
//
// The four decisions, applied in a LOCKED sequence (breakthrough MUST run before the
// snooze filter, else a broken-through critical is silently filtered out):
//   1. D-06 breakthrough — a muted (acked OR snoozed) incident that gained a new
//      critical child, or whose severity rose to critical while muted below it,
//      clears its mute and stays at its natural (top) position.
//   2. D-04 snooze-drop — a still-snoozed incident (snoozeUntil > now, not broken
//      through) drops from `view`; a snoozed CRITICAL is collected for the banner so
//      it is decluttered but never silently hidden.
//   3. D-05 ack-partition — an acked incident stays in `view` but STABLE-partitions
//      below every un-acked incident (both groups keep engine order; no `.sort`).
//      Ack ≠ snooze: ack never removes from view.
//   4. D-07 resolution — an active row whose incidentKey left the live top-level set
//      emits a cleared_at write; recurrence (a fresh failure) starts a new row later.
//
// Engine-order-is-LAW (mirroring incidents.ts:18-22): the ranked input is only
// PARTITIONED, never re-sorted. There is NO `.sort` in this file.

import type { GroupedIncident } from "@/lib/overview/incidents";

/**
 * The tracking-row shape this module consumes — the Plan 03 `nodemon` schema mapped
 * snake→camel. Only the fields the four decisions read are relied upon; the loader
 * hands over already-active rows (clearedAt is informational here).
 */
export interface TrackingRow {
  id: string;
  incidentKey: string;
  openedAt: Date;
  ackedAt: Date | null;
  owner: string | null;
  snoozeUntil: Date | null;
  mutedAtSeverity: string | null;
  mutedCriticalChildren: number | null;
  clearedAt: Date | null;
}

/**
 * A tracking write the loader must apply. Discriminated by `kind`, each carrying the
 * row `id`:
 *   • `clear-mute`   — D-06 breakthrough: reset ackedAt / snoozeUntil /
 *                      mutedAtSeverity / mutedCriticalChildren so the incident is
 *                      no longer muted (the loader nulls those columns).
 *   • `set-cleared`  — D-07 resolution: stamp clearedAt so the row closes; a later
 *                      recurrence opens a brand-new row with fresh state.
 */
export type TrackingWrite =
  | { kind: "clear-mute"; id: string }
  | { kind: "set-cleared"; id: string; clearedAt: Date };

/** The reconciled result: what to show, what to banner, and what to persist. */
export interface ReconcileResult {
  /** the queue in engine order, snoozed-dropped and acked-lowered. */
  view: GroupedIncident[];
  /** snoozed CRITICAL incidents for the always-visible "N snoozed critical" banner. */
  snoozedCriticals: GroupedIncident[];
  /** tracking mutations for the loader to execute (this module never writes). */
  writes: TrackingWrite[];
}

/** A snoozeUntil in the future (relative to injected `now`) still mutes the incident. */
function isSnoozed(row: TrackingRow, now: Date): boolean {
  return row.snoozeUntil !== null && row.snoozeUntil.getTime() > now.getTime();
}

/** Muted = the operator acked it OR it is still snoozed — the D-06 breakthrough gate. */
function isMuted(row: TrackingRow, now: Date): boolean {
  return row.ackedAt !== null || isSnoozed(row, now);
}

/**
 * D-06 — does a muted incident break through its mute? Fires when the live critical
 * child count exceeds what it was muted at, OR when worstSeverity rose to critical
 * while the mute was taken below critical. Either way the "never silently muted"
 * rule forces the incident back to the top as critical.
 */
function breaksThrough(incident: GroupedIncident, row: TrackingRow): boolean {
  const liveCriticalChildren = incident.children.filter(
    (c) => c.severity === "critical",
  ).length;
  const countBreakthrough =
    row.mutedCriticalChildren !== null && liveCriticalChildren > row.mutedCriticalChildren;
  const severityBreakthrough =
    incident.severity === "critical" && row.mutedAtSeverity !== "critical";
  return countBreakthrough || severityBreakthrough;
}

/**
 * Reconcile the incident tree against the active tracking rows. Pure: inputs are
 * never mutated, `now` is injected (no wall clock), and no `.sort` is used — the
 * ranked input is only partitioned. See the file header for the LOCKED ordering.
 */
export function reconcileTracking(
  incidents: GroupedIncident[],
  activeRows: TrackingRow[],
  now: Date,
): ReconcileResult {
  const rowByKey = new Map<string, TrackingRow>();
  for (const row of activeRows) rowByKey.set(row.incidentKey, row);

  const writes: TrackingWrite[] = [];
  const brokeThrough = new Set<string>();

  // (1) D-06 breakthrough FIRST — before the snooze filter, so a broken-through
  // critical is never filtered out. Clearing the mute is a write the loader applies.
  for (const incident of incidents) {
    const row = rowByKey.get(incident.key);
    if (row === undefined || !isMuted(row, now)) continue;
    if (breaksThrough(incident, row)) {
      brokeThrough.add(incident.key);
      writes.push({ kind: "clear-mute", id: row.id });
    }
  }

  // (2) D-04 snooze-drop — a still-snoozed, non-broken-through incident drops from
  // view; a snoozed CRITICAL is collected for the banner (decluttered, never hidden).
  const snoozedCriticals: GroupedIncident[] = [];
  const afterSnooze: GroupedIncident[] = [];
  for (const incident of incidents) {
    if (brokeThrough.has(incident.key)) {
      afterSnooze.push(incident);
      continue;
    }
    const row = rowByKey.get(incident.key);
    if (row !== undefined && isSnoozed(row, now)) {
      if (incident.severity === "critical") snoozedCriticals.push(incident);
      continue; // dropped from view
    }
    afterSnooze.push(incident);
  }

  // (3) D-05 ack stable-partition — un-acked first, acked below, each group keeping
  // engine order (no `.sort`). A broken-through incident is treated as un-acked so it
  // holds its natural (top) position. Ack never removes from view.
  const unacked: GroupedIncident[] = [];
  const acked: GroupedIncident[] = [];
  for (const incident of afterSnooze) {
    if (brokeThrough.has(incident.key)) {
      unacked.push(incident);
      continue;
    }
    const row = rowByKey.get(incident.key);
    if (row !== undefined && row.ackedAt !== null) acked.push(incident);
    else unacked.push(incident);
  }
  const view = [...unacked, ...acked];

  // (4) D-07 resolution — an active row whose key left the live top-level set closes
  // via a cleared_at write; a later recurrence opens a fresh row (loader concern).
  const liveKeys = new Set(incidents.map((i) => i.key));
  for (const row of activeRows) {
    if (!liveKeys.has(row.incidentKey)) {
      writes.push({ kind: "set-cleared", id: row.id, clearedAt: now });
    }
  }

  return { view, snoozedCriticals, writes };
}
