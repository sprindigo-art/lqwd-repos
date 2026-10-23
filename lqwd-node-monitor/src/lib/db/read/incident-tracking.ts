import "server-only";

// =====================================================
// INC-02 — incident_tracking read/write layer (nodemon-only)
// =====================================================
// The thin, guarded DB layer that backs the Plan-02 pure state machine. It is the
// ONLY read+write surface over `nodemon.incident_tracking`:
//
//   loadActiveTracking()          — SELECT every row WHERE cleared_at IS NULL, mapped
//                                   snake→camel to TrackingRow[] (the reconcile input).
//   applyTrackingWrites(writes)   — execute each TrackingWrite the reconcile returned
//                                   inside ONE dbNodemon.transaction: clear-mute nulls
//                                   the mute/ack/snooze columns; set-cleared stamps
//                                   cleared_at. Every UPDATE is parameter-bound Drizzle
//                                   and guarded `WHERE id=? AND cleared_at IS NULL`
//                                   (mirrors claim.ts:57-82 — never string-concat).
//   reconcileAndGetView(...)      — the per-request orchestrator wiring the pure Plan-02
//                                   module to the DB: load → reconcile → persist writes →
//                                   return { view, snoozedCriticals }. It runs OUTSIDE any
//                                   overview data memo (its own read per request; Pitfall 5).
//
// Imports ONLY dbNodemon + incidentTracking (+ the pure reconcile module) — never a
// cross-DB analytics client. This is the phase's sole new write path (INC-02, T-17-11).

import { and, eq, isNull } from "drizzle-orm";

import type { GroupedIncident } from "@/lib/overview/incidents";
import {
  reconcileTracking,
  type TrackingRow,
  type TrackingWrite,
} from "@/lib/overview/incident-tracking";

/**
 * Load every ACTIVE tracking row (cleared_at IS NULL) as the reconcile input. The
 * snake→camel mapping matches the Plan-02 `TrackingRow` surface exactly. Lazy DB
 * import keeps the server-only pool out of any graph that merely references this
 * module (mirrors the queue lazy-import discipline).
 */
export async function loadActiveTracking(): Promise<TrackingRow[]> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { incidentTracking } = await import("@/lib/db/schema/nodemon");

  const rows = await dbNodemon
    .select()
    .from(incidentTracking)
    .where(isNull(incidentTracking.clearedAt));

  return rows.map((r) => ({
    id: r.id,
    incidentKey: r.incidentKey,
    openedAt: r.openedAt,
    ackedAt: r.ackedAt,
    owner: r.owner,
    snoozeUntil: r.snoozeUntil,
    mutedAtSeverity: r.mutedAtSeverity,
    mutedCriticalChildren: r.mutedCriticalChildren,
    clearedAt: r.clearedAt,
  }));
}

/**
 * Execute the reconcile writes in ONE transaction (lost-update guard). Each write is
 * a parameter-bound, guarded UPDATE `WHERE id=? AND cleared_at IS NULL`:
 *   • clear-mute  — D-06 breakthrough: null ackedAt / snoozeUntil / mutedAtSeverity /
 *                   mutedCriticalChildren so the incident is no longer muted.
 *   • set-cleared — D-07 resolution: stamp cleared_at so the row closes (the next
 *                   recurrence INSERTs a fresh active row under the partial-unique).
 * A zero-write reconcile opens no transaction.
 */
export async function applyTrackingWrites(writes: TrackingWrite[]): Promise<void> {
  if (writes.length === 0) return;

  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { incidentTracking } = await import("@/lib/db/schema/nodemon");

  await dbNodemon.transaction(async (tx) => {
    for (const write of writes) {
      if (write.kind === "clear-mute") {
        await tx
          .update(incidentTracking)
          .set({
            ackedAt: null,
            snoozeUntil: null,
            mutedAtSeverity: null,
            mutedCriticalChildren: null,
          })
          .where(and(eq(incidentTracking.id, write.id), isNull(incidentTracking.clearedAt)));
      } else {
        await tx
          .update(incidentTracking)
          .set({ clearedAt: write.clearedAt })
          .where(and(eq(incidentTracking.id, write.id), isNull(incidentTracking.clearedAt)));
      }
    }
  });
}

/**
 * Per-request orchestrator: load the active rows, run the PURE reconcile (Plan 02)
 * against the live incident tree at the injected `now`, persist the returned writes
 * transactionally, and hand back what the queue shows and what the banner surfaces.
 * Runs on its own read (never inside an overview data memo — Pitfall 5).
 *
 * CR-01 safety gate: `readsHealthy` MUST be false whenever any incident-determining
 * upstream read degraded to empty (fail-soft). The read-only view/banner
 * computation is always safe, but the write pass — especially D-07 `set-cleared`,
 * which clears every active row whose key is absent from the live set — is DANGEROUS
 * on a degraded read: a transient outage yields `incidents = []` and would mass-clear
 * all operator ack/snooze tracking irreversibly. So when reads are unhealthy we SKIP
 * `applyTrackingWrites` entirely and return the pure read-only view. When healthy,
 * behavior is unchanged (persist as before). This mirrors the non-persisting variant
 * the incident-detail and host pages already use.
 */
export async function reconcileAndGetView(
  incidents: GroupedIncident[],
  now: Date,
  readsHealthy = true,
): Promise<{ view: GroupedIncident[]; snoozedCriticals: GroupedIncident[] }> {
  const activeRows = await loadActiveTracking();
  const result = reconcileTracking(incidents, activeRows, now);
  if (readsHealthy) {
    await applyTrackingWrites(result.writes);
  }
  return { view: result.view, snoozedCriticals: result.snoozedCriticals };
}
