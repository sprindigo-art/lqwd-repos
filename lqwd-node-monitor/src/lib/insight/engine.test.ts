import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assembleCards,
  enrichCloseCardPeerAlias,
  liquidityImbalanceFromFleet,
  loadInsightView,
  type AssembleInputs,
} from "@/lib/insight/engine";
import { AP12_NO_DATA_PLACEHOLDER } from "@/lib/insight/detectors/ap12-advisory";
import type { HtlcNodeMeta } from "@/lib/insight/detectors/htlc-timeout";
import type { RebalanceAggRow } from "@/lib/insight/detectors/rebalance";
import type { ChannelVolumeRow } from "@/lib/insight/detectors/fee-signals";
import type { InsightCard } from "@/lib/insight/types";
import type {
  DimensionKey,
  FleetView,
  GradedDimension,
  PeerRelative,
  ScorecardView,
} from "@/lib/scorecard/types";

// =====================================================
// engine.ts pure-composition tests (NO DB)
// =====================================================
// assembleCards is the exported dependency seam (fleet.ts assembleScorecard
// precedent): steps 3–5 of the computation — detect* → guardrail post-passes
// IN ORDER → rank → InsightCardArraySchema.parse — run here over fixtures.
// loadInsightView's read fan is exercised with mocked executors to prove the
// fail-soft degrade contract (one rejected detector read ⇒ that detector's
// cards absent, every other card present). The live path is golden-insight.

// All read-side functions the engine fans over are hoisted mocks so the
// degrade test controls them; the pure detect* functions stay REAL (partial
// module mocks below keep everything except the fetchers).
const mocks = vi.hoisted(() => ({
  loadFleetView: vi.fn(),
  fetchHtlcTimeoutRows: vi.fn(),
  channelVolumeForFleet: vi.fn(),
  feeSignalChannelsForNode: vi.fn(),
  stepdownForFleet: vi.fn(),
  feeHistoryByChannel: vi.fn(),
  currentPendingChannels: vi.fn(),
  currentPendingSweeps: vi.fn(),
  dbExecute: vi.fn(),
}));

vi.mock("@/lib/scorecard/fleet", () => ({ loadFleetView: mocks.loadFleetView }));
vi.mock("@/lib/insight/detectors/htlc-timeout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insight/detectors/htlc-timeout")>()),
  fetchHtlcTimeoutRows: mocks.fetchHtlcTimeoutRows,
}));
vi.mock("@/lib/insight/detectors/fee-signals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insight/detectors/fee-signals")>()),
  channelVolumeForFleet: mocks.channelVolumeForFleet,
  feeSignalChannelsForNode: mocks.feeSignalChannelsForNode,
}));
vi.mock("@/lib/insight/detectors/fee-stepdown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insight/detectors/fee-stepdown")>()),
  stepdownForFleet: mocks.stepdownForFleet,
}));
vi.mock("@/lib/insight/fee-history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/insight/fee-history")>()),
  feeHistoryByChannel: mocks.feeHistoryByChannel,
}));
vi.mock("@/lib/read/pending", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/read/pending")>()),
  currentPendingChannels: mocks.currentPendingChannels,
  currentPendingSweeps: mocks.currentPendingSweeps,
}));
// Covers the cluster + rebalance row fetchers' lazy dbRouting import.
vi.mock("@/lib/db/warehouse-routing", () => ({ dbRouting: { execute: mocks.dbExecute } }));

const NOW = new Date("2026-06-11T00:00:00Z");

// Valid 66-lowercase-hex pubkeys (buildDeepLink validates before interpolation).
const PUBKEY_FLAGGED = "02" + "ab".repeat(32); // AP-11 flagged node
const PUBKEY_HEALTHY = "03" + "cd".repeat(32);
const PARTNER = "03" + "ef".repeat(32);
const CHAN_ID = "111111111111111111";

function gdim(
  key: DimensionKey,
  over: Partial<GradedDimension> = {},
): GradedDimension & { peerRelative: PeerRelative | null } {
  return {
    key,
    raw: 0,
    pct: 80,
    letter: "B",
    color: "ok",
    tier1Breach: null,
    asOf: NOW,
    peerRelative: null,
    ...over,
  };
}

interface NodeOpts {
  flagged?: boolean;
  maxHourlySelfCloses?: number;
  localSat?: number;
  remoteSat?: number;
}

function makeNode(pubkey: string, alias: string, opts: NodeOpts = {}): ScorecardView {
  const { flagged = false, maxHourlySelfCloses = 0, localSat, remoteSat } = opts;
  const liquidityExtras: Record<string, number> = {};
  if (localSat !== undefined) liquidityExtras.localSat = localSat;
  if (remoteSat !== undefined) liquidityExtras.remoteSat = remoteSat;
  return {
    pubkey,
    alias,
    backend: "lnd",
    compositePct: 75,
    compositeLetter: "B",
    dot: flagged ? "critical" : "ok",
    reason: null,
    criticalChips: flagged ? ["close storm"] : [],
    dimensions: [
      gdim("forceClose", {
        raw: flagged ? 5 : 0,
        tier1Breach: flagged ? { label: "close storm" } : null,
        extras: { maxHourlySelfCloses },
      }),
      gdim("liquidity", { raw: 0.5, extras: liquidityExtras }),
      gdim("channelHealth", { raw: 0.01, extras: { activeChannels: 100, inactiveChannels: 2 } }),
    ],
    asOf: NOW,
    stale: false,
  };
}

/** Node A is AP-11 flagged (storm metric past the ≥50/hr line); node B is healthy with a liquidity imbalance. */
function makeFleet(): FleetView {
  return {
    nodes: [
      makeNode(PUBKEY_FLAGGED, "flagged-node", { flagged: true, maxHourlySelfCloses: 60 }),
      makeNode(PUBKEY_HEALTHY, "healthy-node", { localSat: 10_000_000, remoteSat: 2_000_000 }),
    ],
    fetchedAt: NOW,
  };
}

/** Channel row that fires fee_raise: 150 forwards (≥100) at 5 PPM (< floor 30). */
function feeRaiseChannel(): Record<string, unknown> {
  return {
    chan_id: CHAN_ID,
    channel_point: "deadbeef:0",
    remote_pubkey: PARTNER,
    outgoing_fee_base_msat: "1000",
    outgoing_fee_rate_milli_msat: "5",
    lifetime: String(200 * 86400),
    closed: false,
    timestamp: "2026-06-10 12:00:00",
  };
}

const FEE_VOLUME: ChannelVolumeRow[] = [
  { lnd_pubkey: PUBKEY_FLAGGED, chan_id: CHAN_ID, forwards: 150 },
];

/** Degraded node B with one VIABLE partner (paid > 0) — rebalance-action input. */
const REBALANCE_ROWS: RebalanceAggRow[] = [
  {
    requesting_node_pubkey: PUBKEY_HEALTHY,
    requesting_node_alias: "healthy-node",
    remote_pubkey: PARTNER,
    remote_alias: "partner",
    attempts: 25,
    paid: 5, // viable (rate 0.2 < warn 0.5; attempts 25 ≥ min 20)
    success_rate: 0.2,
    as_of: "2026-06-10 12:00:00",
  },
];

function baseInputs(over: Partial<AssembleInputs> = {}): AssembleInputs {
  return {
    fleet: makeFleet(),
    htlcRows: [],
    feeSignalNodes: [],
    volumeRows: [],
    stepdownAggregates: [],
    clusterRows: [],
    rebalanceRows: [],
    feeHistory: new Map(),
    pendingView: { nodes: [], asOf: null },
    ap12Cards: [],
    now: NOW,
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("liquidityImbalanceFromFleet", () => {
  it("computes signed localSat − remoteSat via typed key access; omits nodes without extras", () => {
    const map = liquidityImbalanceFromFleet(makeFleet());
    expect(map.get(PUBKEY_HEALTHY)).toBe(8_000_000);
    // Flagged node carries empty liquidity extras → no entry (unknown ≠ balanced).
    expect(map.has(PUBKEY_FLAGGED)).toBe(false);
  });
});

describe("assembleCards — guardrail post-pass ORDER (hysteresis → suppression → rate-limit)", () => {
  it("a fee card on an AP-11-flagged node ends SUPPRESSED with its hysteresis state already stamped", () => {
    const cards = assembleCards(
      baseInputs({
        feeSignalNodes: [
          {
            node: { pubkey: PUBKEY_FLAGGED, alias: "flagged-node", backend: "lnd" },
            channels: [feeRaiseChannel()],
          },
        ],
        volumeRows: FEE_VOLUME,
      }),
    );

    const feeCard = cards.find((c) => c.signal === "fee_raise");
    expect(feeCard).toBeDefined();
    // Hysteresis ran FIRST: its state landed on the card (delta 25 ≥ 10 → clear)
    // BEFORE suppression nulled the action — had suppression run first,
    // applyHysteresis would have skipped the already-null action entirely.
    expect(feeCard!.evidence.detail?.hysteresis).toBe("clear");
    expect(feeCard!.suppressed.active).toBe(true);
    expect(feeCard!.suppressed.reason).toBe(
      "node flagged AP-11 — write recommendations withheld",
    );
    expect(feeCard!.suggestedAction).toBeNull();
    expect(feeCard!.evidence.detail?.withheldAction).toBe("update_fee");
    // Suppressed writes never enter the D-16 per-load rate-limit count — the
    // card keeps the detector's static cap string, never the counter format
    // applyRateLimitGuidance stamps on counted writes.
    expect(feeCard!.rateLimitGuidance).not.toMatch(/^\d+ write recommendation/);
  });
});

describe("assembleCards — D-06 rank applied", () => {
  it("orders critical (close storm) before info cards", () => {
    const cards = assembleCards(
      baseInputs({
        feeSignalNodes: [
          {
            node: { pubkey: PUBKEY_FLAGGED, alias: "flagged-node", backend: "lnd" },
            channels: [feeRaiseChannel()],
          },
        ],
        volumeRows: FEE_VOLUME,
        rebalanceRows: REBALANCE_ROWS,
      }),
    );

    expect(cards[0].signal).toBe("ap11_close_storm");
    expect(cards[0].severity).toBe("critical");
    const order = { critical: 0, warn: 1, info: 2 } as const;
    for (let i = 1; i < cards.length; i++) {
      expect(order[cards[i].severity]).toBeGreaterThanOrEqual(order[cards[i - 1].severity]);
    }
  });
});

describe("assembleCards — InsightCardArraySchema parse gate", () => {
  it("THROWS on a hand-forged contract-violating card (llm-inference with a non-null action)", () => {
    const forged: InsightCard = {
      schemaVersion: 1,
      id: `ap12a_conn_exhaustion:${PUBKEY_HEALTHY}:node`,
      severity: "info",
      node: { pubkey: PUBKEY_HEALTHY, alias: null, backend: "lnd" },
      target: { kind: "node" },
      signal: "ap12a_conn_exhaustion",
      evidence: {
        metric: "ap12_advisory",
        observed: 0,
        threshold: 0,
        unit: "n/a",
        window: "n/a",
        asOf: NOW.toISOString(),
        deepLink: `/${PUBKEY_HEALTHY}/scorecard`,
      },
      // D-12 violation: llm-inference provenance with a non-null action.
      suggestedAction: { type: "investigate", params: {} },
      suppressed: { active: false, reason: null },
      provenance: "llm-inference",
      rateLimitGuidance: null,
    };

    expect(() => assembleCards(baseInputs({ ap12Cards: [forged] }))).toThrow();
  });

  it("passes valid output through the gate (every emitted card parses)", () => {
    expect(() => assembleCards(baseInputs({ rebalanceRows: REBALANCE_ROWS }))).not.toThrow();
  });
});

describe("assembleCards — rebalance SuggestedAction reachability", () => {
  it("a viable partner + fleet liquidity imbalance yields suggestedAction.type === 'rebalance'", () => {
    const cards = assembleCards(baseInputs({ rebalanceRows: REBALANCE_ROWS }));
    const degraded = cards.find((c) => c.signal === "rebalance_degraded");
    expect(degraded).toBeDefined();
    // Proves the engine supplies liquidityImbalanceByPubkey from the loaded
    // fleet view: +8,000,000 sat imbalance → half (4M), direction "out".
    expect(degraded!.suggestedAction).toEqual({
      type: "rebalance",
      params: { partnerPubkey: PARTNER, amountSat: 4_000_000, direction: "out" },
    });
  });
});

describe("loadInsightView — fail-soft detector degrade (mocked reads)", () => {
  beforeEach(() => {
    vi.stubEnv("INSIGHT_LLM_ENABLED", "");
    mocks.loadFleetView.mockResolvedValue(makeFleet());
    mocks.fetchHtlcTimeoutRows.mockRejectedValue(new Error("htlc read boom"));
    mocks.channelVolumeForFleet.mockResolvedValue(FEE_VOLUME);
    mocks.feeSignalChannelsForNode.mockImplementation(
      async (node: { pubkey: string; alias: string | null; backend: "lnd" | "ldk" }) => ({
        node,
        channels: node.pubkey === PUBKEY_FLAGGED ? [feeRaiseChannel()] : [],
      }),
    );
    mocks.stepdownForFleet.mockResolvedValue([]);
    mocks.feeHistoryByChannel.mockResolvedValue(new Map());
    mocks.currentPendingChannels.mockResolvedValue([]);
    mocks.currentPendingSweeps.mockResolvedValue([]);
    mocks.dbExecute.mockResolvedValue([]);
  });

  it("one rejected detector read degrades to [] — its cards absent, the rest present", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = await loadInsightView();

      // The failed detector's cards are absent…
      expect(view.cards.some((c) => c.signal === "htlc_timeout_fc")).toBe(false);
      // …and every other detector's cards are present.
      expect(view.cards.some((c) => c.signal === "ap11_close_storm")).toBe(true);
      expect(view.cards.some((c) => c.signal === "fee_raise")).toBe(true);

      // Fail-loud in logs.
      expect(
        errorSpy.mock.calls.some((args) => String(args[0]).includes("htlc-timeout")),
      ).toBe(true);

      // LLM off (default): honest placeholder, no advisory cards.
      expect(view.llmEnabled).toBe(false);
      expect(view.ap12Placeholder).toBe(AP12_NO_DATA_PLACEHOLDER);
      expect(view.fetchedAt).toBeInstanceOf(Date);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

// =====================================================
// EXPORT-01 — enrichCloseCardPeerAlias post-pass (Phase 5 plan 05-02)
// =====================================================
// Intra-fleet peer alias on close-candidate cards from the fleet alias map
// nodeMetaFromFleet already derives — zero new queries. Non-fleet peers carry
// nothing (RESEARCH A5: builders render truncated pubkey + "alias unknown").

const FLEET_PEER = "03" + "11".repeat(32); // a fleet node that is the remote peer

function closeCard(remotePubkey: string | null, id = "c1"): InsightCard {
  return {
    schemaVersion: 1,
    id: `channel_close_candidate:${PUBKEY_HEALTHY}:${id}`,
    severity: "info",
    node: { pubkey: PUBKEY_HEALTHY, alias: "healthy-node", backend: "lnd" },
    target: { kind: "channel", chanId: id, channelPoint: `${id}:0`, remotePubkey },
    signal: "channel_close_candidate",
    evidence: {
      metric: "forwards_90d",
      observed: 0,
      threshold: 0,
      unit: "forwards",
      window: "90d",
      asOf: NOW.toISOString(),
      deepLink: `/${PUBKEY_HEALTHY}/fees`,
      detail: { forwards90d: 0 },
    },
    suggestedAction: { type: "close_channel", params: { chanId: id, channelPoint: `${id}:0`, force: false } },
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: "Suggested cap: 10 write recommendations per node per day (guidance only, not enforced).",
  };
}

function feeRaiseCard(): InsightCard {
  return {
    schemaVersion: 1,
    id: `fee_raise:${PUBKEY_HEALTHY}:f1`,
    severity: "info",
    node: { pubkey: PUBKEY_HEALTHY, alias: "healthy-node", backend: "lnd" },
    target: { kind: "channel", chanId: "f1", channelPoint: "f1:0", remotePubkey: FLEET_PEER },
    signal: "fee_raise",
    evidence: {
      metric: "policy_ppm_vs_floor",
      observed: 5,
      threshold: 30,
      unit: "ppm",
      window: "90d",
      asOf: NOW.toISOString(),
      deepLink: `/${PUBKEY_HEALTHY}/fees`,
      detail: { forwards90d: 150, currentPpm: 5 },
    },
    suggestedAction: {
      type: "update_fee",
      params: { chanId: "f1", channelPoint: "f1:0", currentPpm: 5, suggestedPpm: 30, baseFeeMsat: 1000, timeLockDelta: 80 },
    },
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  };
}

function fleetMeta(): Map<string, HtlcNodeMeta> {
  return new Map<string, HtlcNodeMeta>([
    [FLEET_PEER, { alias: "LQWD-Canada", backend: "lnd" }],
    [PUBKEY_HEALTHY, { alias: "healthy-node", backend: "lnd" }],
  ]);
}

describe("enrichCloseCardPeerAlias", () => {
  it("stamps peerAlias on a close-candidate whose remotePubkey is an intra-fleet node", () => {
    const out = enrichCloseCardPeerAlias([closeCard(FLEET_PEER)], fleetMeta());
    expect(out[0].evidence.detail?.peerAlias).toBe("LQWD-Canada");
  });

  it("adds NO peerAlias when the remote peer is not in the fleet map", () => {
    const out = enrichCloseCardPeerAlias([closeCard(PARTNER)], fleetMeta());
    expect(out[0].evidence.detail).not.toHaveProperty("peerAlias");
  });

  it("adds NO peerAlias when the matched fleet node has a null alias", () => {
    const meta = new Map<string, HtlcNodeMeta>([[FLEET_PEER, { alias: null, backend: "lnd" }]]);
    const out = enrichCloseCardPeerAlias([closeCard(FLEET_PEER)], meta);
    expect(out[0].evidence.detail).not.toHaveProperty("peerAlias");
  });

  it("leaves non-close-candidate cards byte-identical (same reference)", () => {
    const fee = feeRaiseCard();
    const out = enrichCloseCardPeerAlias([fee], fleetMeta());
    expect(out[0]).toBe(fee); // unchanged reference — minimal blast radius
  });

  it("never mutates the input card (spread-copy like withDetail)", () => {
    const card = closeCard(FLEET_PEER);
    const before = JSON.stringify(card);
    enrichCloseCardPeerAlias([card], fleetMeta());
    expect(JSON.stringify(card)).toBe(before);
  });
});

describe("assembleCards — peerAlias enrichment wired before the parse gate", () => {
  it("close-candidate cards for intra-fleet peers carry peerAlias through the full pipeline", () => {
    // A close-candidate channel whose remote_pubkey is the OTHER fleet node.
    const cards = assembleCards(
      baseInputs({
        feeSignalNodes: [
          {
            node: { pubkey: PUBKEY_HEALTHY, alias: "healthy-node", backend: "lnd" },
            channels: [
              {
                chan_id: "900",
                channel_point: "dead:9",
                remote_pubkey: PUBKEY_FLAGGED, // an intra-fleet node
                outgoing_fee_rate_milli_msat: "100",
                outgoing_fee_base_msat: "1000",
                lifetime: String(200 * 86400),
                capacity: "7000000",
                closed: false,
                timestamp: "2026-06-10 12:00:00",
              },
            ],
          },
        ],
        volumeRows: [], // 0 forwards → close-candidate
      }),
    );

    const close = cards.find((c) => c.signal === "channel_close_candidate");
    expect(close).toBeDefined();
    expect(close!.evidence.detail?.peerAlias).toBe("flagged-node");
    // capacitySat from Task 1 also rides through the pipeline.
    expect(close!.evidence.detail?.capacitySat).toBe(7000000);
  });
});

describe("assembleCards — FAILED volume read (null) never yields close/lower cards (I-fee)", () => {
  it("the same close-shaped channel with volumeRows: null emits NO channel_close_candidate", () => {
    const cards = assembleCards(
      baseInputs({
        feeSignalNodes: [
          {
            node: { pubkey: PUBKEY_HEALTHY, alias: "healthy-node", backend: "lnd" },
            channels: [
              {
                chan_id: "900",
                channel_point: "dead:9",
                remote_pubkey: PUBKEY_FLAGGED,
                outgoing_fee_rate_milli_msat: "100",
                outgoing_fee_base_msat: "1000",
                lifetime: String(200 * 86400),
                capacity: "7000000",
                closed: false,
                timestamp: "2026-06-10 12:00:00",
              },
            ],
          },
        ],
        volumeRows: null, // the 90d volume read FAILED — UNKNOWN, not 0 forwards
      }),
    );

    expect(cards.some((c) => c.signal === "channel_close_candidate")).toBe(false);
    expect(cards.some((c) => c.signal === "fee_lower")).toBe(false);
  });
});
