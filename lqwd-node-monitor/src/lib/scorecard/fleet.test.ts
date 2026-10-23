import { describe, it, expect, vi, beforeEach } from "vitest";

// PERF-02 memo test — mock the fleet's warehouse reads so computeFleetView
// resolves with zero rows (no live DB). These mocks are hoisted and scoped to
// THIS test file only; the pure assembleScorecard/sortFleet tests below are
// unaffected (they import nothing that is mocked here).
vi.mock("@/lib/read/node-info", () => ({
  latestNodeInfoAll: vi.fn(async () => []),
  latestNodeInfo: vi.fn(async () => null),
}));
vi.mock("@/lib/scorecard/dimensions/routing", () => ({
  routingForFleet: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/scorecard/dimensions/revenue", () => ({
  revenueForFleet: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/scorecard/dimensions/liquidity", () => ({
  liquidityForFleet: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/scorecard/dimensions/force-close", () => ({
  forceCloseForFleet: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/scorecard/dimensions/restart", () => ({
  restartForFleet: vi.fn(async () => new Map()),
}));

import {
  assembleScorecard,
  sortFleet,
  loadFleetView,
  FLEET_TTL_MS,
  type ScorecardIdentity,
  type ScorecardInputs,
} from "@/lib/scorecard/fleet";
import { latestNodeInfoAll } from "@/lib/read/node-info";
import { SCORECARD_CONFIG } from "@/lib/scorecard/config";
import {
  COMPUTABLE_DIMENSIONS,
  NO_DATA_DIMENSIONS,
  type DimensionResult,
  type ScorecardView,
} from "@/lib/scorecard/types";

// =====================================================
// fleet.ts pure-part tests (NO DB): sortFleet (D-09) + assembleScorecard
// =====================================================
// loadFleetView's orchestration is exercised live by golden-scorecard.test.ts;
// here only the exported pure helpers run, with synthetic DimensionResults.

const NOW = new Date("2026-06-09T12:00:00Z");
const YEAR_AGO = new Date("2025-06-09T12:00:00Z");

/** Minimal ScorecardView fixture for sortFleet (sort only reads dot + compositePct). */
function mkView(over: Partial<ScorecardView>): ScorecardView {
  return {
    pubkey: "pk",
    alias: null,
    backend: "lnd",
    compositePct: null,
    compositeLetter: null,
    dot: "ok",
    reason: null,
    criticalChips: [],
    dimensions: [],
    asOf: null,
    stale: true,
    ...over,
  };
}

const fresh = (raw: number, extras?: Record<string, number>): DimensionResult => ({
  raw,
  asOf: NOW,
  extras,
});

/** A healthy full-input set (lnd bands): no Tier-1 breach, all dims gradable. */
function healthyInputs(): ScorecardInputs {
  return {
    routing: fresh(1200, { volumeSat: 500_000_000 }),
    revenue: fresh(600, { earnings7dSat: 200_000 }),
    liquidity: fresh(0.5, { localSat: 1_500_000_000, remoteSat: 1_500_000_000, capacitySat: 3_000_000_000 }),
    channelHealth: fresh(0.01, { activeChannels: 480, inactiveChannels: 5 }),
    forceClose: fresh(0, { maxHourlySelfCloses: 0 }),
    restart: { raw: 8760, asOf: YEAR_AGO }, // long uptime — asOf legitimately old
    peer: fresh(30),
  };
}

const IDENTITY: ScorecardIdentity = { pubkey: "02abc", alias: "LQWD-Canada", backend: "lnd" };
const CFG = SCORECARD_CONFIG.lnd;

describe("loadFleetView TTL memo (PERF-02)", () => {
  const mockLatest = vi.mocked(latestNodeInfoAll);

  beforeEach(() => {
    // Reset the process-global memo + mock call history between cases.
    (globalThis as unknown as { _fleetViewCache?: unknown })._fleetViewCache = undefined;
    vi.clearAllMocks();
    mockLatest.mockResolvedValue([]);
  });

  it("FLEET_TTL_MS matches the insight window (45s) so one read serves both", () => {
    expect(FLEET_TTL_MS).toBe(45_000);
  });

  it("collapses two calls within the TTL into ONE underlying compute", async () => {
    // loadFleetView is `async`, so the RETURNED promise is a fresh wrapper each
    // call (identity can't be asserted on it) — the memo's contract is the
    // single side-effect: both callers share one computeFleetView run, so the
    // sole warehouse read (latestNodeInfoAll) fires exactly once.
    const [a, b] = await Promise.all([loadFleetView(), loadFleetView()]);
    expect(mockLatest).toHaveBeenCalledTimes(1);
    // Both callers observe the same collapsed result.
    expect(a).toBe(b);
  });

  it("evicts the cache when the compute rejects, so the next call retries", async () => {
    mockLatest.mockRejectedValueOnce(new Error("boom"));
    await expect(loadFleetView()).rejects.toThrow("boom");
    // Cache evicted on reject → the next call recomputes rather than serving the
    // pinned rejection for the whole window.
    mockLatest.mockResolvedValue([]);
    const view = await loadFleetView();
    expect(view.nodes).toEqual([]);
    expect(mockLatest).toHaveBeenCalledTimes(2);
  });
});

describe("sortFleet (D-09, pure)", () => {
  it("a critical with a HIGH composite sorts before a warn with a LOW composite", () => {
    const warnLow = mkView({ pubkey: "warn", dot: "warn", compositePct: 20 });
    const criticalHigh = mkView({ pubkey: "crit", dot: "critical", compositePct: 95 });
    const sorted = sortFleet([warnLow, criticalHigh]);
    expect(sorted[0].pubkey).toBe("crit");
    expect(sorted[1].pubkey).toBe("warn");
  });

  it("within criticals, the worse (lower) compositePct sorts first", () => {
    const a = mkView({ pubkey: "a", dot: "critical", compositePct: 80 });
    const b = mkView({ pubkey: "b", dot: "critical", compositePct: 30 });
    const sorted = sortFleet([a, b]);
    expect(sorted.map((n) => n.pubkey)).toEqual(["b", "a"]);
  });

  it("null compositePct sorts LAST within its group (criticals and non-criticals)", () => {
    const critNull = mkView({ pubkey: "critNull", dot: "critical", compositePct: null });
    const crit10 = mkView({ pubkey: "crit10", dot: "critical", compositePct: 10 });
    const okNull = mkView({ pubkey: "okNull", dot: "ok", compositePct: null });
    const ok90 = mkView({ pubkey: "ok90", dot: "ok", compositePct: 90 });
    const sorted = sortFleet([okNull, critNull, ok90, crit10]);
    expect(sorted.map((n) => n.pubkey)).toEqual(["crit10", "critNull", "ok90", "okNull"]);
  });

  it("is pure — does not mutate the input array", () => {
    const a = mkView({ pubkey: "a", dot: "ok", compositePct: 90 });
    const b = mkView({ pubkey: "b", dot: "critical", compositePct: 50 });
    const input = [a, b];
    sortFleet(input);
    expect(input.map((n) => n.pubkey)).toEqual(["a", "b"]);
  });
});

describe("assembleScorecard (pure)", () => {
  it("returns all 10 dimensions in canonical order, with the 3 no-data dims greyed", () => {
    const view = assembleScorecard(IDENTITY, healthyInputs(), CFG);
    expect(view.dimensions).toHaveLength(10);
    expect(view.dimensions.map((d) => d.key)).toEqual([
      ...COMPUTABLE_DIMENSIONS,
      ...NO_DATA_DIMENSIONS,
    ]);
    const noData = view.dimensions.filter((d) =>
      (NO_DATA_DIMENSIONS as readonly string[]).includes(d.key),
    );
    expect(noData).toHaveLength(3);
    for (const dim of noData) {
      expect(dim.color).toBe("nodata");
      expect(dim.pct).toBeNull();
      expect(dim.letter).toBeNull();
    }
  });

  it("freshness floor ignores restart's legitimately-old asOf (D-13 deviation, RESEARCH A5)", () => {
    // restart asOf is a year old; every floor input is NOW → asOf = NOW, not stale.
    const view = assembleScorecard(IDENTITY, healthyInputs(), CFG);
    expect(view.asOf?.getTime()).toBe(NOW.getTime());
    // isStale compares against the real clock — NOW is the current date in this
    // fixture's frame, so guard via the floor value instead of wall-clock:
    // the floor must NOT have been dragged down to the restart timestamp.
    expect(view.asOf?.getTime()).not.toBe(YEAR_AGO.getTime());
  });

  it("an old restart asOf does not mark the node stale when all floor inputs are fresh", () => {
    const inputs = healthyInputs();
    const justNow = new Date(); // real clock — isStale uses Date.now()
    for (const key of ["routing", "revenue", "liquidity", "channelHealth", "forceClose", "peer"] as const) {
      inputs[key] = { ...(inputs[key] as DimensionResult), asOf: justNow };
    }
    inputs.restart = { raw: 8760, asOf: new Date(Date.now() - 365 * 24 * 3600 * 1000) };
    const view = assembleScorecard(IDENTITY, inputs, CFG);
    expect(view.stale).toBe(false);
    expect(view.asOf?.getTime()).toBe(justNow.getTime());
  });

  it("a missing dimension map entry (null input) → raw null no-data, still 10 dims", () => {
    const inputs = healthyInputs();
    inputs.routing = null; // node absent from the fleet map = zero rows in window
    const view = assembleScorecard(IDENTITY, inputs, CFG);
    expect(view.dimensions).toHaveLength(10);
    const routing = view.dimensions.find((d) => d.key === "routing")!;
    expect(routing.raw).toBeNull();
    expect(routing.color).toBe("nodata");
    expect(routing.note).toBe("no rows in window");
  });

  it("a synthetic Tier-1 breach (maxHourlySelfCloses 60) → dot critical + 'close storm' chip", () => {
    const inputs = healthyInputs();
    inputs.forceClose = fresh(0, { maxHourlySelfCloses: 60 }); // ≥50 = AP-11 storm
    const view = assembleScorecard(IDENTITY, inputs, CFG);
    expect(view.dot).toBe("critical");
    expect(view.criticalChips).toContain("close storm");
    expect(view.reason).toBe("critical: close storm");
  });

  it("leaves peerRelative null on every dimension (attached by loadFleetView's second pass)", () => {
    const view = assembleScorecard(IDENTITY, healthyInputs(), CFG);
    for (const dim of view.dimensions) {
      expect(dim.peerRelative).toBeNull();
    }
  });

  it("healthy inputs produce a non-null composite and an ok/warn dot (never critical without Tier-1)", () => {
    const view = assembleScorecard(IDENTITY, healthyInputs(), CFG);
    expect(view.compositePct).not.toBeNull();
    expect(view.compositePct).toBeGreaterThan(0);
    expect(view.compositePct).toBeLessThanOrEqual(100);
    expect(["ok", "warn"]).toContain(view.dot);
    expect(view.criticalChips).toEqual([]);
  });
});
