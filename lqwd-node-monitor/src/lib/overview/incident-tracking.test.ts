import { describe, expect, it } from "vitest";
import {
  reconcileTracking,
  type TrackingRow,
  type TrackingWrite,
} from "@/lib/overview/incident-tracking";
import type { GroupedIncident } from "@/lib/overview/incidents";
import type { Severity } from "@/components/df/Severity";

// =====================================================
// incident-tracking.test.ts — locks the PURE tracking state machine (D-04..D-07)
// BEFORE impl. This is the "make or break INC-02" logic, so the ordering rules are
// pinned by fixtures: breakthrough runs FIRST (before the snooze filter), snooze
// drops criticals into the banner, ack lowers-but-never-hides, and a key that left
// the live set emits a cleared_at write. now is always injected — no wall clock.
// =====================================================

const NOW = new Date("2026-07-20T12:00:00.000Z");
const FUTURE = new Date("2026-07-20T16:00:00.000Z"); // snoozeUntil in the future
const PAST = new Date("2026-07-20T08:00:00.000Z"); // snoozeUntil already elapsed

// ── Fixture factories (minimal valid shapes; the state machine only reads the
//    fields the four decisions consume — it never validates). ──────────────────

let childCounter = 0;
function makeChild(severity: Severity): GroupedIncident {
  childCounter += 1;
  return {
    key: `child-${severity}-${childCounter}`,
    layer: "nodes",
    severity,
    stale: false,
    why: "",
    entityLabel: "child",
    asOf: null,
    children: [],
  };
}

function makeIncident(over: {
  key: string;
  severity?: Severity;
  children?: GroupedIncident[];
}): GroupedIncident {
  return {
    key: over.key,
    layer: "hosts",
    severity: over.severity ?? "warning",
    stale: false,
    why: "",
    entityLabel: over.key,
    asOf: null,
    children: over.children ?? [],
  };
}

function makeRow(
  over: { id: string; incidentKey: string } & Partial<TrackingRow>,
): TrackingRow {
  return {
    id: over.id,
    incidentKey: over.incidentKey,
    openedAt: over.openedAt ?? new Date("2026-07-20T00:00:00.000Z"),
    ackedAt: over.ackedAt ?? null,
    owner: over.owner ?? null,
    snoozeUntil: over.snoozeUntil ?? null,
    mutedAtSeverity: over.mutedAtSeverity ?? null,
    mutedCriticalChildren: over.mutedCriticalChildren ?? null,
    clearedAt: over.clearedAt ?? null,
  };
}

describe("reconcileTracking — D-04 snooze drop + snoozed-critical collection", () => {
  it("drops a snoozed critical from view and collects it for the banner", () => {
    const incident = makeIncident({ key: "host-a", severity: "critical" });
    const rows = [
      makeRow({
        id: "row-1",
        incidentKey: "host-a",
        snoozeUntil: FUTURE,
        mutedAtSeverity: "critical",
        mutedCriticalChildren: 1,
      }),
    ];

    const result = reconcileTracking([incident], rows, NOW);

    expect(result.view).toHaveLength(0);
    expect(result.snoozedCriticals.map((i) => i.key)).toEqual(["host-a"]);
    expect(result.writes).toHaveLength(0);
  });

  it("keeps a snoozed NON-critical out of view but NOT in the banner", () => {
    const incident = makeIncident({ key: "host-b", severity: "warning" });
    const rows = [makeRow({ id: "row-2", incidentKey: "host-b", snoozeUntil: FUTURE })];

    const result = reconcileTracking([incident], rows, NOW);

    expect(result.view).toHaveLength(0);
    expect(result.snoozedCriticals).toHaveLength(0);
  });

  it("keeps an elapsed-snooze incident visible (snoozeUntil <= now is no longer snoozed)", () => {
    const incident = makeIncident({ key: "host-c", severity: "critical" });
    const rows = [makeRow({ id: "row-3", incidentKey: "host-c", snoozeUntil: PAST })];

    const result = reconcileTracking([incident], rows, NOW);

    expect(result.view.map((i) => i.key)).toEqual(["host-c"]);
    expect(result.snoozedCriticals).toHaveLength(0);
  });
});

describe("reconcileTracking — D-05 ack stable-partition (lower, never hide)", () => {
  it("keeps an acked incident in view but partitions it BELOW all un-acked, preserving engine order", () => {
    const unacked1 = makeIncident({ key: "host-unacked-1" });
    const ackedMid = makeIncident({ key: "host-acked" });
    const unacked2 = makeIncident({ key: "host-unacked-2" });
    // Engine order is: unacked1, ackedMid, unacked2.
    const rows = [makeRow({ id: "row-4", incidentKey: "host-acked", ackedAt: NOW })];

    const result = reconcileTracking([unacked1, ackedMid, unacked2], rows, NOW);

    // Acked is never removed…
    expect(result.view.map((i) => i.key)).toContain("host-acked");
    // …but appears AFTER every un-acked, with each group in engine order.
    expect(result.view.map((i) => i.key)).toEqual([
      "host-unacked-1",
      "host-unacked-2",
      "host-acked",
    ]);
  });
});

describe("reconcileTracking — D-06 escalation breakthrough (runs BEFORE snooze filter)", () => {
  it("a snoozed critical that GAINED a new critical child re-surfaces in view, not the banner", () => {
    // Muted at 0 critical children; now carries 1 → breakthrough by count.
    const incident = makeIncident({
      key: "host-d",
      severity: "critical",
      children: [makeChild("critical")],
    });
    const rows = [
      makeRow({
        id: "row-5",
        incidentKey: "host-d",
        snoozeUntil: FUTURE,
        mutedAtSeverity: "critical",
        mutedCriticalChildren: 0,
      }),
    ];

    const result = reconcileTracking([incident], rows, NOW);

    // Proves ordering: breakthrough beats the snooze filter.
    expect(result.view.map((i) => i.key)).toEqual(["host-d"]);
    expect(result.snoozedCriticals).toHaveLength(0);
    // And it clears the mute so the loader resets ack/snooze state.
    expect(result.writes).toContainEqual<TrackingWrite>({ kind: "clear-mute", id: "row-5" });
  });

  it("an ACKED incident whose severity rose to critical breaks through and stays at the TOP", () => {
    const brokeThrough = makeIncident({ key: "host-e", severity: "critical" });
    const plainUnacked = makeIncident({ key: "host-f", severity: "warning" });
    // Engine order: brokeThrough first, plainUnacked second.
    const rows = [
      makeRow({
        id: "row-6",
        incidentKey: "host-e",
        ackedAt: PAST,
        mutedAtSeverity: "warning", // was below critical when acked
        mutedCriticalChildren: 0,
      }),
    ];

    const result = reconcileTracking([brokeThrough, plainUnacked], rows, NOW);

    // Never lowered by the ack-partition — natural (top) position preserved.
    expect(result.view.map((i) => i.key)).toEqual(["host-e", "host-f"]);
    expect(result.writes).toContainEqual<TrackingWrite>({ kind: "clear-mute", id: "row-6" });
  });

  it("does NOT break through when the muted incident is unchanged (no new critical, severity flat)", () => {
    const incident = makeIncident({
      key: "host-g",
      severity: "critical",
      children: [makeChild("critical")],
    });
    const rows = [
      makeRow({
        id: "row-7",
        incidentKey: "host-g",
        snoozeUntil: FUTURE,
        mutedAtSeverity: "critical",
        mutedCriticalChildren: 1, // already had 1; still 1 → no breakthrough
      }),
    ];

    const result = reconcileTracking([incident], rows, NOW);

    expect(result.view).toHaveLength(0);
    expect(result.snoozedCriticals.map((i) => i.key)).toEqual(["host-g"]);
    expect(result.writes).toHaveLength(0);
  });
});

describe("reconcileTracking — D-07 resolution + recurrence", () => {
  it("emits a cleared_at write for an active row whose key left the live incident set", () => {
    const live = makeIncident({ key: "host-still-live" });
    const rows = [
      makeRow({ id: "row-8", incidentKey: "host-still-live", ackedAt: NOW }),
      makeRow({ id: "row-9", incidentKey: "host-gone" }),
    ];

    const result = reconcileTracking([live], rows, NOW);

    // Only the resolved row gets a set-cleared write.
    expect(result.writes).toContainEqual<TrackingWrite>({
      kind: "set-cleared",
      id: "row-9",
      clearedAt: NOW,
    });
    expect(result.writes.some((w) => w.kind === "set-cleared" && w.id === "row-8")).toBe(false);
  });
});

describe("reconcileTracking — purity", () => {
  it("never mutates its inputs", () => {
    const incident = makeIncident({ key: "host-h", severity: "critical" });
    const incidents = [incident];
    const rows = [makeRow({ id: "row-10", incidentKey: "host-h", snoozeUntil: FUTURE })];
    const incidentsSnapshot = JSON.stringify(incidents);
    const rowsSnapshot = JSON.stringify(rows);

    reconcileTracking(incidents, rows, NOW);

    expect(JSON.stringify(incidents)).toBe(incidentsSnapshot);
    expect(JSON.stringify(rows)).toBe(rowsSnapshot);
  });

  it("returns an empty triple for empty inputs", () => {
    const result = reconcileTracking([], [], NOW);
    expect(result.view).toEqual([]);
    expect(result.snoozedCriticals).toEqual([]);
    expect(result.writes).toEqual([]);
  });
});
