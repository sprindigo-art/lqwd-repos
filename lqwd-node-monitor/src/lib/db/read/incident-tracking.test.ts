import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TrackingRow, TrackingWrite } from "@/lib/overview/incident-tracking";

// =====================================================
// INC-02 — transactional tracking loader + write executor (unit, mocked DB)
// =====================================================
// Proves the nodemon-only read/write layer over `incident_tracking`:
//   • loadActiveTracking() selects cleared_at IS NULL rows and snake→camel maps them;
//   • applyTrackingWrites() runs EVERY write inside ONE dbNodemon.transaction —
//     clear-mute nulls ackedAt/snoozeUntil/mutedAtSeverity/mutedCriticalChildren,
//     set-cleared stamps cleared_at — each guarded WHERE id=? (no string-concat);
//   • reconcileAndGetView() wires the Plan-02 pure reconcile to the DB.
// We MOCK `@/lib/db/nodemon` so the loop/transaction/mapping semantics are exercised
// deterministically — the live guarded write path needs no elevated-DDL integration.

// Hoisted mock state so vi.mock's factory (also hoisted) can close over it.
const h = vi.hoisted(() => {
  let activeRows: unknown[] = [];
  const setCalls: Array<{ set: Record<string, unknown>; where: unknown }> = [];
  let inTransaction = false;
  let sawWriteOutsideTx = false;

  const txUpdate = vi.fn((_table: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (whereArg: unknown) => {
        if (!inTransaction) sawWriteOutsideTx = true;
        setCalls.push({ set: values, where: whereArg });
        return Promise.resolve();
      },
    }),
  }));

  const transaction = vi.fn(async (cb: (tx: { update: typeof txUpdate }) => Promise<unknown>) => {
    inTransaction = true;
    try {
      return await cb({ update: txUpdate });
    } finally {
      inTransaction = false;
    }
  });

  const selectFromWhere = vi.fn(async () => activeRows);
  const dbNodemon = {
    select: () => ({ from: () => ({ where: selectFromWhere }) }),
    transaction,
  };

  return {
    setCalls,
    txUpdate,
    transaction,
    dbNodemon,
    setActiveRows: (rows: unknown[]) => {
      activeRows = rows;
    },
    sawWriteOutsideTx: () => sawWriteOutsideTx,
    reset: () => {
      activeRows = [];
      setCalls.length = 0;
      inTransaction = false;
      sawWriteOutsideTx = false;
      txUpdate.mockClear();
      transaction.mockClear();
      selectFromWhere.mockClear();
    },
  };
});

vi.mock("@/lib/db/nodemon", () => ({ dbNodemon: h.dbNodemon }));

beforeEach(() => {
  h.reset();
});

function dbRow(overrides: Partial<TrackingRow> = {}): Record<string, unknown> {
  return {
    id: "row-1",
    incidentKey: "host-a",
    openedAt: new Date("2026-07-20T00:00:00Z"),
    ackedAt: null,
    owner: null,
    snoozeUntil: null,
    mutedAtSeverity: null,
    mutedCriticalChildren: null,
    clearedAt: null,
    ...overrides,
  };
}

describe("loadActiveTracking", () => {
  it("selects active rows and maps snake→camel to TrackingRow[]", async () => {
    const acked = new Date("2026-07-20T01:00:00Z");
    h.setActiveRows([dbRow({ id: "r1", incidentKey: "host-a", ackedAt: acked, owner: "op" })]);

    const { loadActiveTracking } = await import("@/lib/db/read/incident-tracking");
    const rows = await loadActiveTracking();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "r1",
      incidentKey: "host-a",
      ackedAt: acked,
      owner: "op",
      clearedAt: null,
    });
  });

  it("returns an empty array when there are no active rows", async () => {
    h.setActiveRows([]);
    const { loadActiveTracking } = await import("@/lib/db/read/incident-tracking");
    expect(await loadActiveTracking()).toEqual([]);
  });
});

describe("applyTrackingWrites", () => {
  it("runs all writes inside ONE dbNodemon.transaction", async () => {
    const writes: TrackingWrite[] = [
      { kind: "clear-mute", id: "a" },
      { kind: "set-cleared", id: "b", clearedAt: new Date("2026-07-20T02:00:00Z") },
    ];
    const { applyTrackingWrites } = await import("@/lib/db/read/incident-tracking");
    await applyTrackingWrites(writes);

    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.setCalls).toHaveLength(2);
    expect(h.sawWriteOutsideTx()).toBe(false);
  });

  it("clear-mute nulls ackedAt/snoozeUntil/mutedAtSeverity/mutedCriticalChildren", async () => {
    const { applyTrackingWrites } = await import("@/lib/db/read/incident-tracking");
    await applyTrackingWrites([{ kind: "clear-mute", id: "a" }]);

    expect(h.setCalls).toHaveLength(1);
    expect(h.setCalls[0].set).toMatchObject({
      ackedAt: null,
      snoozeUntil: null,
      mutedAtSeverity: null,
      mutedCriticalChildren: null,
    });
  });

  it("set-cleared stamps cleared_at", async () => {
    const clearedAt = new Date("2026-07-20T03:00:00Z");
    const { applyTrackingWrites } = await import("@/lib/db/read/incident-tracking");
    await applyTrackingWrites([{ kind: "set-cleared", id: "b", clearedAt }]);

    expect(h.setCalls).toHaveLength(1);
    expect(h.setCalls[0].set).toMatchObject({ clearedAt });
  });

  it("no writes → no transaction opened", async () => {
    const { applyTrackingWrites } = await import("@/lib/db/read/incident-tracking");
    await applyTrackingWrites([]);
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

describe("reconcileAndGetView", () => {
  it("loads active rows, reconciles, applies writes, and returns view + snoozedCriticals", async () => {
    // A row whose incidentKey left the live set → D-07 set-cleared write.
    h.setActiveRows([dbRow({ id: "gone", incidentKey: "host-gone" })]);

    const { reconcileAndGetView } = await import("@/lib/db/read/incident-tracking");
    const now = new Date("2026-07-20T04:00:00Z");
    const result = await reconcileAndGetView([], now);

    expect(result).toHaveProperty("view");
    expect(result).toHaveProperty("snoozedCriticals");
    // The departed row was cleared transactionally.
    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.setCalls[0].set).toMatchObject({ clearedAt: now });
  });

  it("defaults readsHealthy to true — writes still apply when the flag is omitted", async () => {
    h.setActiveRows([dbRow({ id: "gone", incidentKey: "host-gone" })]);

    const { reconcileAndGetView } = await import("@/lib/db/read/incident-tracking");
    // Explicit healthy read — the departed row must be cleared.
    await reconcileAndGetView([], new Date("2026-07-20T05:00:00Z"), true);

    expect(h.transaction).toHaveBeenCalledTimes(1);
    expect(h.setCalls).toHaveLength(1);
  });

  // CR-01: on a degraded warehouse read (readsHealthy=false) the incident set is
  // empty/partial, so D-07 would `set-cleared` every active row. The reconcile must
  // compute the read-only view WITHOUT persisting any writes — no transaction, no
  // clears — so a transient outage can never wipe operator ack/snooze tracking.
  it("performs NO writes when readsHealthy is false, even with an empty incident set", async () => {
    // Every active row's key is absent from the (empty) live set → D-07 would clear
    // them all if the write pass ran. It must be skipped.
    h.setActiveRows([
      dbRow({ id: "a", incidentKey: "host-a" }),
      dbRow({ id: "b", incidentKey: "host-b" }),
    ]);

    const { reconcileAndGetView } = await import("@/lib/db/read/incident-tracking");
    const result = await reconcileAndGetView([], new Date("2026-07-20T06:00:00Z"), false);

    // View/banner still computed (read-only), but nothing was persisted.
    expect(result).toHaveProperty("view");
    expect(result).toHaveProperty("snoozedCriticals");
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.setCalls).toHaveLength(0);
  });
});

describe("import-set invariant — nodemon-only write surface (T-17-11)", () => {
  it("imports no warehouse/fleet client", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./incident-tracking.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/routing|ldk|warehouse|loadFleetView|getChainTelemetry/);
    expect(src).toMatch(/dbNodemon\.transaction/);
  });
});
