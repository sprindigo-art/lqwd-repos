import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================
// INC-02 — ack/assign/snooze/unsnooze server actions (unit, mocked DB + loader)
// =====================================================
// Proves the operator tracking gestures and the phase's zero-fleet-write boundary:
//   • KEY_RE validation BEFORE any use — a traversal key ("../etc/passwd") returns
//     {ok:false} and issues NO DB call (T-17-12);
//   • ack/snooze capture the D-06 mute baseline (severity + critical-child count)
//     from the RECOMPUTED live incident (T-17-04, race-free capture);
//   • snooze rejects an unknown preset;
//   • assign toggles the single operator id on the active row;
//   • the import-set invariant — only dbNodemon + incidentTracking + loadIncidents
//     (no fleet/queue write path, T-17-11).
// dbNodemon + loadIncidents are MOCKED so the guarded upsert + baseline snapshot are
// exercised without an elevated-DDL integration.

const OPERATOR = "op-under-test";

const h = vi.hoisted(() => {
  let existing: Record<string, unknown>[] = [];
  const setCalls: Record<string, unknown>[] = [];
  const insertValues: Record<string, unknown>[] = [];

  const update = vi.fn((_t: unknown) => ({
    set: (values: Record<string, unknown>) => ({
      where: (_w: unknown) => {
        setCalls.push(values);
        return Promise.resolve();
      },
    }),
  }));
  const insert = vi.fn((_t: unknown) => ({
    values: (values: Record<string, unknown>) => {
      insertValues.push(values);
      return Promise.resolve();
    },
  }));
  const select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => existing }) }),
  }));

  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ update, insert, select }),
  );
  const dbNodemon = { transaction };

  const loadIncidents = vi.fn(async () => [] as unknown[]);

  return {
    dbNodemon,
    loadIncidents,
    transaction,
    update,
    insert,
    select,
    setCalls,
    insertValues,
    setExisting: (rows: Record<string, unknown>[]) => {
      existing = rows;
    },
    reset: () => {
      existing = [];
      setCalls.length = 0;
      insertValues.length = 0;
      transaction.mockClear();
      update.mockClear();
      insert.mockClear();
      select.mockClear();
      loadIncidents.mockClear();
      loadIncidents.mockResolvedValue([]);
    },
  };
});

vi.mock("@/lib/db/nodemon", () => ({ dbNodemon: h.dbNodemon }));
vi.mock("@/lib/overview/load-incidents", () => ({ loadIncidents: h.loadIncidents }));

beforeEach(() => {
  h.reset();
  process.env.NODEMON_OPERATOR_ID = OPERATOR;
});

afterEach(() => {
  delete process.env.NODEMON_OPERATOR_ID;
});

/** A recomputed live incident with 2 critical children at critical severity. */
function criticalIncident(key: string) {
  return {
    key,
    layer: "hosts",
    severity: "critical",
    stale: false,
    why: "down",
    entityLabel: key,
    asOf: null,
    children: [
      { key: `${key}-a`, severity: "critical", children: [] },
      { key: `${key}-b`, severity: "critical", children: [] },
      { key: `${key}-c`, severity: "warning", children: [] },
    ],
  };
}

describe("ackIncident", () => {
  it("rejects a path-traversal key with {ok:false} and issues NO DB call", async () => {
    const { ackIncident } = await import("@/app/actions/incident-tracking");
    const result = await ackIncident("../etc/passwd");
    expect(result).toEqual({ ok: false });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.loadIncidents).not.toHaveBeenCalled();
  });

  it("captures the D-06 mute baseline (severity + critical-child count) on ack", async () => {
    h.loadIncidents.mockResolvedValue([criticalIncident("host-a")]);
    h.setExisting([]); // no active row → insert path
    const { ackIncident } = await import("@/app/actions/incident-tracking");

    const result = await ackIncident("host-a");

    expect(result).toEqual({ ok: true });
    const written = h.insertValues[0];
    expect(written).toMatchObject({
      incidentKey: "host-a",
      owner: OPERATOR,
      mutedAtSeverity: "critical",
      mutedCriticalChildren: 2,
    });
    expect(written.ackedAt).toBeInstanceOf(Date);
  });

  it("updates the existing active row when one is present", async () => {
    h.loadIncidents.mockResolvedValue([criticalIncident("host-a")]);
    h.setExisting([{ id: "row-1", incidentKey: "host-a", owner: null }]);
    const { ackIncident } = await import("@/app/actions/incident-tracking");

    await ackIncident("host-a");

    expect(h.setCalls[0]).toMatchObject({ owner: OPERATOR, mutedAtSeverity: "critical" });
    expect(h.insert).not.toHaveBeenCalled();
  });
});

describe("snoozeIncident", () => {
  it("rejects an unknown preset with {ok:false} and no DB write", async () => {
    const { snoozeIncident } = await import("@/app/actions/incident-tracking");
    // deliberately invalid preset
    const result = await snoozeIncident("host-a", "5m" as never);
    expect(result).toEqual({ ok: false });
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it("sets snoozeUntil in the future and captures the baseline for a valid preset", async () => {
    h.loadIncidents.mockResolvedValue([criticalIncident("host-a")]);
    h.setExisting([]);
    const { snoozeIncident } = await import("@/app/actions/incident-tracking");

    const before = Date.now();
    const result = await snoozeIncident("host-a", "4h");

    expect(result).toEqual({ ok: true });
    const written = h.insertValues[0];
    const snoozeUntil = written.snoozeUntil as Date;
    expect(snoozeUntil).toBeInstanceOf(Date);
    // 4h ≈ 14_400_000 ms ahead.
    expect(snoozeUntil.getTime()).toBeGreaterThanOrEqual(before + 4 * 3600_000);
    expect(written).toMatchObject({ mutedAtSeverity: "critical", mutedCriticalChildren: 2 });
  });

  it("rejects a path-traversal key before any preset check", async () => {
    const { snoozeIncident } = await import("@/app/actions/incident-tracking");
    expect(await snoozeIncident("bad/key", "1h")).toEqual({ ok: false });
    expect(h.transaction).not.toHaveBeenCalled();
  });
});

describe("assignIncident (solo assign-to-me / unassign toggle)", () => {
  it("assigns the operator when the active row is unowned", async () => {
    h.setExisting([{ id: "row-1", incidentKey: "host-a", owner: null }]);
    const { assignIncident } = await import("@/app/actions/incident-tracking");

    expect(await assignIncident("host-a")).toEqual({ ok: true });
    expect(h.setCalls[0]).toMatchObject({ owner: OPERATOR });
  });

  it("unassigns when the operator already owns the row", async () => {
    h.setExisting([{ id: "row-1", incidentKey: "host-a", owner: OPERATOR }]);
    const { assignIncident } = await import("@/app/actions/incident-tracking");

    expect(await assignIncident("host-a")).toEqual({ ok: true });
    expect(h.setCalls[0]).toMatchObject({ owner: null });
  });
});

describe("unsnoozeIncident", () => {
  it("nulls snoozeUntil and the mute baseline on the active row", async () => {
    h.setExisting([{ id: "row-1", incidentKey: "host-a", owner: OPERATOR }]);
    const { unsnoozeIncident } = await import("@/app/actions/incident-tracking");

    expect(await unsnoozeIncident("host-a")).toEqual({ ok: true });
    expect(h.setCalls[0]).toMatchObject({
      snoozeUntil: null,
      mutedAtSeverity: null,
      mutedCriticalChildren: null,
    });
  });
});

describe("import-set invariant — no fleet/queue write path (T-17-11)", () => {
  it("references no fleet/queue client", () => {
    const src = readFileSync(
      fileURLToPath(new URL("./incident-tracking.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/loadFleetView|routing|ldk|export\/commands/);
    expect(src).not.toMatch(/\bcommands\b/);
    // The three sanctioned dependencies are present.
    expect(src).toMatch(/@\/lib\/db\/nodemon/);
    expect(src).toMatch(/incidentTracking/);
    expect(src).toMatch(/loadIncidents/);
  });
});
