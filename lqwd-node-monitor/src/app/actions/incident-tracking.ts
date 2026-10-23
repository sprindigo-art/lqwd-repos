"use server";

// =====================================================
// INC-02 — incident tracking server actions (ack / assign / snooze / unsnooze)
// =====================================================
// The operator's tracking gestures — the ONLY client-triggered mutation surface in
// the phase. Every action, mirroring the narrate.ts shell + the claim.ts guarded
// upsert discipline:
//   • validates the incident key against KEY_RE BEFORE any use (T-17-12) — a bad key
//     returns {ok:false} with NO DB call and NO incident recompute;
//   • upserts the ACTIVE row (cleared_at IS NULL) in ONE dbNodemon.transaction with
//     parameter-bound, guarded UPDATE / INSERT (never string-concat, T-17-10);
//   • on ack/snooze, snapshots the D-06 mute baseline (severity + critical-child
//     count) from the RECOMPUTED live incident so a later breakthrough fires
//     deterministically (T-17-04, race-free capture);
//   • wraps the work in try/catch → {ok:false}.
//
// Import-set invariant (T-17-11): ONLY dbNodemon + incidentTracking + loadIncidents —
// no fleet client, no queue write path. This writes incident metadata to nodemon only.

import { and, eq, isNull } from "drizzle-orm";

/** host_id | "unattributed" key shape (narrate.ts precedent) — NOT the 66-hex pubkey. */
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/** D-02 solo operator identity — one id from env, default per research Open Q3. */
const DEFAULT_OPERATOR_ID = "nodemon-operator";
function operatorId(): string {
  const raw = process.env.NODEMON_OPERATOR_ID?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_OPERATOR_ID;
}

export type TrackingActionResult = { ok: boolean };

/** D-03 fixed snooze presets → duration ms. An unknown preset returns null (rejected). */
function presetMs(preset: string): number | null {
  switch (preset) {
    case "1h":
      return 60 * 60 * 1000;
    case "4h":
      return 4 * 60 * 60 * 1000;
    case "24h":
      return 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}

/**
 * Recompute the live incident and snapshot the D-06 mute baseline: the incident's
 * worst severity and its live critical-child count at write time. A missing incident
 * degrades to a null/zero baseline (still a valid mute — nothing to break through yet).
 */
async function muteBaseline(
  incidentKey: string,
): Promise<{ mutedAtSeverity: string | null; mutedCriticalChildren: number }> {
  const { loadIncidents } = await import("@/lib/overview/load-incidents");
  const incidents = await loadIncidents();
  const incident = incidents.find((i) => i.key === incidentKey);
  if (!incident) return { mutedAtSeverity: null, mutedCriticalChildren: 0 };
  return {
    mutedAtSeverity: incident.severity,
    mutedCriticalChildren: incident.children.filter((c) => c.severity === "critical").length,
  };
}

/**
 * Guarded upsert of the ACTIVE row: SELECT the cleared_at-IS-NULL row for this key;
 * UPDATE it with `patch` (guarded WHERE id=? AND cleared_at IS NULL) if present, else
 * INSERT a fresh active row. Runs in ONE transaction (lost-update guard).
 */
async function upsertActive(incidentKey: string, patch: Record<string, unknown>): Promise<void> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { incidentTracking } = await import("@/lib/db/schema/nodemon");

  await dbNodemon.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(incidentTracking)
      .where(and(eq(incidentTracking.incidentKey, incidentKey), isNull(incidentTracking.clearedAt)))
      .limit(1);

    if (existing) {
      await tx
        .update(incidentTracking)
        .set(patch)
        .where(and(eq(incidentTracking.id, existing.id), isNull(incidentTracking.clearedAt)));
    } else {
      await tx.insert(incidentTracking).values({ incidentKey, ...patch });
    }
  });
}

/** D-05 ack — mark the incident acknowledged by the operator + snapshot the mute baseline. */
export async function ackIncident(incidentKey: string): Promise<TrackingActionResult> {
  if (!KEY_RE.test(incidentKey)) return { ok: false };
  try {
    const baseline = await muteBaseline(incidentKey);
    await upsertActive(incidentKey, {
      ackedAt: new Date(),
      owner: operatorId(),
      mutedAtSeverity: baseline.mutedAtSeverity,
      mutedCriticalChildren: baseline.mutedCriticalChildren,
    });
    return { ok: true };
  } catch (error) {
    console.error("ackIncident failed:", error);
    return { ok: false };
  }
}

/**
 * D-02 assign — solo assign-to-me / unassign toggle on the single operator id. If the
 * operator already owns the active row, clear the owner; otherwise claim it. No active
 * row → insert one owned by the operator.
 */
export async function assignIncident(incidentKey: string): Promise<TrackingActionResult> {
  if (!KEY_RE.test(incidentKey)) return { ok: false };
  try {
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { incidentTracking } = await import("@/lib/db/schema/nodemon");
    const op = operatorId();

    await dbNodemon.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(incidentTracking)
        .where(
          and(eq(incidentTracking.incidentKey, incidentKey), isNull(incidentTracking.clearedAt)),
        )
        .limit(1);

      if (existing) {
        const nextOwner = existing.owner === op ? null : op;
        await tx
          .update(incidentTracking)
          .set({ owner: nextOwner })
          .where(and(eq(incidentTracking.id, existing.id), isNull(incidentTracking.clearedAt)));
      } else {
        await tx.insert(incidentTracking).values({ incidentKey, owner: op });
      }
    });
    return { ok: true };
  } catch (error) {
    console.error("assignIncident failed:", error);
    return { ok: false };
  }
}

/** D-03 snooze — mute for a fixed preset (1h/4h/24h) + snapshot the D-06 mute baseline. */
export async function snoozeIncident(
  incidentKey: string,
  preset: "1h" | "4h" | "24h",
): Promise<TrackingActionResult> {
  if (!KEY_RE.test(incidentKey)) return { ok: false };
  const ms = presetMs(preset);
  if (ms === null) return { ok: false };
  try {
    const baseline = await muteBaseline(incidentKey);
    await upsertActive(incidentKey, {
      snoozeUntil: new Date(Date.now() + ms),
      mutedAtSeverity: baseline.mutedAtSeverity,
      mutedCriticalChildren: baseline.mutedCriticalChildren,
    });
    return { ok: true };
  } catch (error) {
    console.error("snoozeIncident failed:", error);
    return { ok: false };
  }
}

/** Un-snooze — clear the snooze and its mute baseline so the incident re-surfaces. */
export async function unsnoozeIncident(incidentKey: string): Promise<TrackingActionResult> {
  if (!KEY_RE.test(incidentKey)) return { ok: false };
  try {
    await upsertActive(incidentKey, {
      snoozeUntil: null,
      mutedAtSeverity: null,
      mutedCriticalChildren: null,
    });
    return { ok: true };
  } catch (error) {
    console.error("unsnoozeIncident failed:", error);
    return { ok: false };
  }
}
