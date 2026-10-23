import { describe, expect, it } from "vitest";
import {
  closeStormFlaggedPubkeys,
  detectCloseStorm,
} from "@/lib/insight/detectors/close-storm";
import { InsightCardSchema } from "@/lib/insight/schema";
import { SCORECARD_CONFIG } from "@/lib/scorecard/config";
import type { FleetView, GradedDimension, PeerRelative, ScorecardView } from "@/lib/scorecard/types";

// AP-11 close-storm detector tests (pure — no DB, no server-only). The detector
// consumes FleetView extras already computed by forceCloseForFleet(); the
// threshold is READ from SCORECARD_CONFIG[backend].forceClose.tier1.value
// (D-13 — never restated), so the firing line in these tests is derived from
// the config import, never a literal.

const LND_TIER1_VALUE = SCORECARD_CONFIG.lnd.forceClose.tier1!.value;

const FETCHED_AT = new Date("2026-06-12T06:00:00.000Z");
const DIM_AS_OF = new Date("2026-06-12T05:30:00.000Z");

/** 66-lowercase-hex pubkeys (buildDeepLink validates the format). */
const PK_A = "aa".repeat(33);
const PK_B = "bb".repeat(33);
const PK_C = "cc".repeat(33);

type FleetDimension = GradedDimension & { peerRelative: PeerRelative | null };

interface NodeOverrides {
  pubkey: string;
  /** undefined → omit the forceClose dimension entirely. */
  maxHourlySelfCloses?: number;
  /** true → omit extras on the forceClose dimension (null-extras case). */
  omitExtras?: boolean;
  tier1Breach?: { label: string } | null;
  backend?: "lnd" | "ldk";
  includeDim?: boolean;
}

function makeNode({
  pubkey,
  maxHourlySelfCloses,
  omitExtras = false,
  tier1Breach = null,
  backend = "lnd",
  includeDim = true,
}: NodeOverrides): ScorecardView {
  const dimensions: FleetDimension[] = [];
  if (includeDim) {
    dimensions.push({
      key: "forceClose",
      raw: 1,
      pct: 80,
      letter: "B",
      color: tier1Breach ? "critical" : "ok",
      tier1Breach,
      asOf: DIM_AS_OF,
      ...(omitExtras
        ? {}
        : {
            extras:
              maxHourlySelfCloses === undefined
                ? {}
                : { maxHourlySelfCloses },
          }),
      peerRelative: null,
    });
  }
  return {
    pubkey,
    alias: "test-node",
    backend,
    compositePct: 80,
    compositeLetter: "B",
    dot: tier1Breach ? "critical" : "ok",
    reason: null,
    criticalChips: [],
    dimensions,
    asOf: DIM_AS_OF,
    stale: false,
  };
}

function makeView(nodes: ScorecardView[]): FleetView {
  return { nodes, fetchedAt: FETCHED_AT };
}

describe("detectCloseStorm (AP-11)", () => {
  it("fires one critical card at the configured tier-1 line, with the full evidence contract", () => {
    const view = makeView([makeNode({ pubkey: PK_A, maxHourlySelfCloses: LND_TIER1_VALUE })]);
    const cards = detectCloseStorm(view);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.severity).toBe("critical");
    expect(card.signal).toBe("ap11_close_storm");
    expect(card.id).toBe(`ap11_close_storm:${PK_A}:node`);
    expect(card.node).toEqual({ pubkey: PK_A, alias: "test-node", backend: "lnd" });
    expect(card.target).toEqual({ kind: "node" });
    expect(card.suggestedAction).toEqual({ type: "investigate", params: {} });
    expect(card.provenance).toBe("deterministic");
    expect(card.suppressed).toEqual({ active: false, reason: null });
    expect(card.evidence.metric).toBe("maxHourlySelfCloses");
    expect(card.evidence.observed).toBe(LND_TIER1_VALUE);
    expect(card.evidence.threshold).toBe(LND_TIER1_VALUE);
    expect(card.evidence.unit).toBe("closes/hr");
    expect(card.evidence.window).toBe("24h");
    expect(card.evidence.asOf).toBe(DIM_AS_OF.toISOString());
    expect(card.evidence.deepLink).toBe(`/${PK_A}/closes`);
  });

  it("does NOT fire one below the configured line", () => {
    const view = makeView([
      makeNode({ pubkey: PK_A, maxHourlySelfCloses: LND_TIER1_VALUE - 1 }),
    ]);
    expect(detectCloseStorm(view)).toEqual([]);
  });

  it("missing forceClose dimension → no card, no throw", () => {
    const view = makeView([makeNode({ pubkey: PK_A, includeDim: false })]);
    expect(detectCloseStorm(view)).toEqual([]);
  });

  it("missing extras / missing metric key → no card, no throw", () => {
    const view = makeView([
      makeNode({ pubkey: PK_A, omitExtras: true }),
      makeNode({ pubkey: PK_B }), // extras present but no maxHourlySelfCloses key
    ]);
    expect(detectCloseStorm(view)).toEqual([]);
  });

  it("threshold is a config READ — changing a mock config value moves the firing line", () => {
    const mockConfig = structuredClone(SCORECARD_CONFIG);
    mockConfig.lnd.forceClose.tier1!.value = 7;
    const view = makeView([makeNode({ pubkey: PK_A, maxHourlySelfCloses: 7 })]);
    // Default config: 7 is far below the real line → silent.
    expect(detectCloseStorm(view)).toEqual([]);
    // Mock config: the SAME observation now fires — the module holds no number.
    const cards = detectCloseStorm(view, mockConfig);
    expect(cards).toHaveLength(1);
    expect(cards[0].evidence.threshold).toBe(7);
  });

  it("resolves the line per-backend (ldk node reads the ldk config)", () => {
    const mockConfig = structuredClone(SCORECARD_CONFIG);
    mockConfig.ldk.forceClose.tier1!.value = 3;
    const view = makeView([
      makeNode({ pubkey: PK_A, maxHourlySelfCloses: 3, backend: "ldk" }),
      makeNode({ pubkey: PK_B, maxHourlySelfCloses: 3, backend: "lnd" }),
    ]);
    const cards = detectCloseCards(mockConfig, view);
    expect(cards.map((c) => c.node?.pubkey)).toEqual([PK_A]);
  });

  it("every emitted card parses via InsightCardSchema", () => {
    const view = makeView([
      makeNode({ pubkey: PK_A, maxHourlySelfCloses: LND_TIER1_VALUE }),
      makeNode({ pubkey: PK_B, maxHourlySelfCloses: LND_TIER1_VALUE + 43 }),
    ]);
    const cards = detectCloseStorm(view);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(() => InsightCardSchema.parse(card)).not.toThrow();
    }
  });
});

/** Helper for the per-backend test above — keeps the call-site arg order readable. */
function detectCloseCards(config: typeof SCORECARD_CONFIG, view: FleetView) {
  return detectCloseStorm(view, config);
}

// ── 18-06: malformed-pubkey fail-soft (review I2) ─────────────────────────────
describe("detectCloseStorm — malformed pubkey fail-soft (I2)", () => {
  // 66 UPPERCASE hex chars — fails buildDeepLink's `^[0-9a-f]{66}$` gate.
  const UPPER_PK = "AA".repeat(33);

  it("degrades an uppercase-pubkey node to no card instead of throwing", () => {
    const view = makeView([makeNode({ pubkey: UPPER_PK, maxHourlySelfCloses: LND_TIER1_VALUE })]);
    expect(() => detectCloseStorm(view)).not.toThrow();
    expect(detectCloseStorm(view)).toEqual([]);
  });

  it("still emits the valid-pubkey card when another node's pubkey is malformed", () => {
    const view = makeView([
      makeNode({ pubkey: UPPER_PK, maxHourlySelfCloses: LND_TIER1_VALUE }),
      makeNode({ pubkey: PK_A, maxHourlySelfCloses: LND_TIER1_VALUE }),
    ]);
    const cards = detectCloseStorm(view);
    expect(cards).toHaveLength(1);
    expect(cards[0].node?.pubkey).toBe(PK_A);
  });
});

describe("closeStormFlaggedPubkeys (suppression flag source for 04-07)", () => {
  it("returns exactly the tier1Breach-flagged pubkeys from a 3-node fixture (typed access, never labels)", () => {
    const view = makeView([
      makeNode({
        pubkey: PK_A,
        maxHourlySelfCloses: LND_TIER1_VALUE,
        tier1Breach: { label: "close storm" },
      }),
      makeNode({ pubkey: PK_B, maxHourlySelfCloses: 0, tier1Breach: null }),
      makeNode({ pubkey: PK_C, includeDim: false }),
    ]);
    expect(closeStormFlaggedPubkeys(view)).toEqual(new Set([PK_A]));
  });

  it("a RELABELED breach still flags (label-independence — RESEARCH Pitfall 5)", () => {
    const view = makeView([
      makeNode({
        pubkey: PK_A,
        maxHourlySelfCloses: LND_TIER1_VALUE,
        tier1Breach: { label: "operator renamed this chip" },
      }),
    ]);
    expect(closeStormFlaggedPubkeys(view)).toEqual(new Set([PK_A]));
  });

  it("missing forceClose dimension never flags (undefined !== null guard)", () => {
    const view = makeView([makeNode({ pubkey: PK_A, includeDim: false })]);
    expect(closeStormFlaggedPubkeys(view)).toEqual(new Set());
  });
});
