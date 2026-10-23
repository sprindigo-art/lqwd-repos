import { describe, it, expect, vi, beforeEach } from "vitest";

// =====================================================
// load-incidents.test.ts — locks the shared server-only assembly loader (INC-01)
// =====================================================
// The DB/warehouse reads are hoisted-mocked so the loader runs under plain node
// with zero live connections; `assembleIncidents` + `rankCards` stay REAL, so the
// test exercises the genuine read→assemble integration (not a re-mock of the pure
// core). The behaviors pinned here ARE the contract every consumer builds on:
//   • the loader returns the assembled `GroupedIncident[]` (host-grouped tree);
//   • selection is by `.key` — `.find((i) => i.key === hostId)` returns the match;
//   • a bogus key returns `undefined` (the `.key`-not-`.hostId` footgun this
//     extraction fixes for all four future consumers).

// ── Hoisted read mocks (this file only). fleet/insight modules are mocked whole,
//    so their `server-only` + lazy-DB imports never load. `vi.hoisted` lifts the
//    fn handles alongside the hoisted `vi.mock` factories that reference them. ──
const { getLatestHostMetrics, getChainTelemetry, getServiceHealth, loadFleetView, loadInsightView } =
  vi.hoisted(() => ({
    getLatestHostMetrics: vi.fn(),
    getChainTelemetry: vi.fn(),
    getServiceHealth: vi.fn(),
    loadFleetView: vi.fn(),
    loadInsightView: vi.fn(),
  }));

vi.mock("@/lib/read/host-metrics", () => ({ getLatestHostMetrics }));
vi.mock("@/lib/read/chain-telemetry", () => ({ getChainTelemetry }));
vi.mock("@/lib/read/service-health", () => ({ getServiceHealth }));
vi.mock("@/lib/scorecard/fleet", () => ({ loadFleetView }));
vi.mock("@/lib/insight/engine", () => ({ loadInsightView }));

import { loadIncidents } from "@/lib/overview/load-incidents";
import type { HostMetricsView } from "@/lib/read/host-metrics";
import type { ServiceHealthState } from "@/lib/read/service-health";
import type { ScorecardView } from "@/lib/scorecard/types";
import type { InsightCard } from "@/lib/insight/types";

// Fixture stamps are RELATIVE to the real clock: the loader now applies the
// LOCKED 30-day freshness cutoff internally (O-load), which judges against
// Date.now(). FRESH = well within the window; DEAD = far beyond it.
const DAY_MS = 24 * 60 * 60 * 1000;
const FRESH = new Date(Date.now() - 1 * DAY_MS);
const DEAD = new Date(Date.now() - 40 * DAY_MS);

// ── Minimal valid fixtures (the assembler reads only the consumed fields). ─────
function makeHost(hostId: string, collectedAt: Date = FRESH): HostMetricsView {
  return {
    hostId,
    hostname: hostId,
    collectedAt,
    stale: false,
    hasData: true,
    metrics: null,
    storage: [],
  } as HostMetricsView;
}

function makeNode(pubkey: string, asOf: Date = FRESH): ScorecardView {
  return {
    pubkey,
    alias: `alias-${pubkey.slice(0, 4)}`,
    backend: "lnd",
    compositePct: null,
    compositeLetter: null,
    dot: "ok",
    reason: null,
    criticalChips: [],
    dimensions: [],
    asOf,
    stale: false,
  } as ScorecardView;
}

function makeCard(id: string, pubkey: string): InsightCard {
  return {
    schemaVersion: 1,
    id,
    severity: "critical",
    node: { pubkey, alias: `alias-${id}`, backend: "lnd" },
    target: { kind: "node" },
    signal: "channel_close_candidate",
    evidence: {
      metric: "test",
      observed: 10,
      threshold: 30,
      unit: "ppm",
      window: "7d",
      asOf: FRESH.toISOString(),
      deepLink: "/x",
    },
    suggestedAction: null,
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  } as InsightCard;
}

function makeService(over: {
  hostId: string;
  serviceName: string;
  running?: boolean;
  functioning?: boolean;
  collectedAt?: Date;
}): ServiceHealthState {
  const running = over.running ?? true;
  const functioning = over.functioning ?? true;
  return {
    hostId: over.hostId,
    serviceName: over.serviceName,
    nodePubkey: null,
    running,
    functioning,
    green: running && functioning,
    stale: false,
    collectorStale: false,
    noData: false,
    lastSuccessAt: null,
    lastArtifactMtime: null,
    collectedAt: over.collectedAt ?? FRESH,
    errorCount: 0,
    expectedIntervalSeconds: 3600,
  } as ServiceHealthState;
}

const FLEET = { nodes: [], fetchedAt: new Date("2026-07-01T00:00:00.000Z") };
const INSIGHT = {
  cards: [],
  fetchedAt: new Date("2026-07-01T00:00:00.000Z"),
  llmEnabled: false,
  ap12Placeholder: null,
};

describe("loadIncidents (INC-01 shared server loader)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getChainTelemetry.mockResolvedValue([]);
    loadFleetView.mockResolvedValue(FLEET);
    loadInsightView.mockResolvedValue(INSIGHT);
  });

  it("returns the assembled GroupedIncident[] and selects the matching host by .key", async () => {
    // Two hosts; h1 runs a down bitcoind (→ one host-keyed incident), h2 is clean.
    getLatestHostMetrics.mockResolvedValue([makeHost("h1"), makeHost("h2")]);
    getServiceHealth.mockImplementation(async (hostId: string) =>
      hostId === "h1"
        ? [makeService({ hostId: "h1", serviceName: "bitcoind", running: false, functioning: false })]
        : [],
    );

    const incidents = await loadIncidents();

    // The loader assembled a host-grouped tree — h1 surfaces, keyed by its host id.
    const forH1 = incidents.find((i) => i.key === "h1");
    expect(forH1).toBeDefined();
    expect(forH1!.layer).toBe("hosts");
    expect(forH1!.children.some((c) => c.layer === "services")).toBe(true);

    // CONTRACT: selection is by `.key`. GroupedIncident has NO `.hostId` field, so
    // a bogus key returns undefined (never a silent all-host miss).
    expect(incidents.find((i) => i.key === "does-not-exist")).toBeUndefined();
    // Per-host reads were fanned out over the hosts dimension.
    expect(getServiceHealth).toHaveBeenCalledWith("h1");
    expect(getServiceHealth).toHaveBeenCalledWith("h2");
  });

  it("returns the all-clear empty queue when nothing is alerting (OVW-04)", async () => {
    getLatestHostMetrics.mockResolvedValue([makeHost("h1")]);
    getServiceHealth.mockResolvedValue([makeService({ hostId: "h1", serviceName: "bitcoind" })]);

    const incidents = await loadIncidents();
    expect(incidents).toEqual([]);
  });

  it("degrades fail-soft: a rejected supplementary read yields an empty queue, not a throw", async () => {
    getLatestHostMetrics.mockResolvedValue([makeHost("h1")]);
    getServiceHealth.mockResolvedValue([]);
    loadInsightView.mockRejectedValue(new Error("insight down"));
    loadFleetView.mockRejectedValue(new Error("fleet down"));
    getChainTelemetry.mockRejectedValue(new Error("chain down"));

    await expect(loadIncidents()).resolves.toEqual([]);
  });

  // ── O-load (18-03 / HARDEN-03): the loader IS the operator-visible pipeline ──
  // page.tsx applies the LOCKED 30-day freshness cutoff + surviving-pubkey card
  // filter before assembly; loadIncidents() previously did NOT — so narration
  // (narrateIncident) and the mute baseline (incident-tracking) operated on a
  // DIFFERENT incident set than the operator sees. The cutoff + filter now live
  // INSIDE loadIncidents() so there is ONE incident set.

  it("eliminates a host silent >30 days — its incident never reaches narration/mute (LOCKED #8)", async () => {
    // h-dead last reported 40 days ago; its down service is equally dead.
    getLatestHostMetrics.mockResolvedValue([makeHost("h-dead", DEAD), makeHost("h-live")]);
    getServiceHealth.mockImplementation(async (hostId: string) =>
      hostId === "h-dead"
        ? [
            makeService({
              hostId: "h-dead",
              serviceName: "bitcoind",
              running: false,
              functioning: false,
              collectedAt: DEAD,
            }),
          ]
        : [
            makeService({
              hostId: "h-live",
              serviceName: "bitcoind",
              running: false,
              functioning: false,
            }),
          ],
    );

    const incidents = await loadIncidents();

    // The dead host left the incident set entirely; the live one still surfaces.
    expect(incidents.find((i) => i.key === "h-dead")).toBeUndefined();
    expect(incidents.find((i) => i.key === "h-live")).toBeDefined();
  });

  it("drops insight cards whose node was eliminated — narration/mute see the operator-visible set", async () => {
    const PK_LIVE = "02" + "ab".repeat(32);
    const PK_DEAD = "03" + "cd".repeat(32);
    getLatestHostMetrics.mockResolvedValue([]);
    getServiceHealth.mockResolvedValue([]);
    loadFleetView.mockResolvedValue({
      nodes: [makeNode(PK_LIVE), makeNode(PK_DEAD, DEAD)],
      fetchedAt: FRESH,
    });
    loadInsightView.mockResolvedValue({
      cards: [makeCard("card-live", PK_LIVE), makeCard("card-dead", PK_DEAD)],
      fetchedAt: FRESH,
      llmEnabled: false,
      ap12Placeholder: null,
    });

    const incidents = await loadIncidents();

    // Flatten every child key across the tree (unattached cards nest under the
    // Unattributed bucket) — the dead node's card must appear NOWHERE.
    const allKeys = incidents.flatMap((i) => [i.key, ...i.children.map((c) => c.key)]);
    expect(allKeys).toContain("card-live");
    expect(allKeys).not.toContain("card-dead");
  });
});
