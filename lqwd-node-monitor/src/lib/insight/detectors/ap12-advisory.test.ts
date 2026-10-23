import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AP12_NO_DATA_PLACEHOLDER,
  ap12AdvisoryCards,
  buildAp12Card,
  type Ap12NodeRef,
} from "@/lib/insight/detectors/ap12-advisory";
import { InsightCardSchema } from "@/lib/insight/schema";
import type { FleetPgHealthView, PgHealthVerdict } from "@/lib/read/pg-health";

// =====================================================
// COL-02 — deterministic AP-12 detector (LLM stopgap RETIRED)
// =====================================================
// The frozen retirement contract (RESEARCH §COL-02): the exported
// AP12_NO_DATA_PLACEHOLDER string and the two signal ids
// ap12a_conn_exhaustion / ap12b_serialization survive VERBATIM; the id dedupe
// rule `${signal}:${pubkey}:node` is unchanged; the InsightCard output shape is
// unchanged. What changed: cards are now emitted deterministically from
// pg_health counters (getFleetPgHealth → derivePgHealthVerdict), provenance is
// "deterministic" (never "llm-inference"), severity comes from the derived
// band, and NO AI SDK code runs on this path.

// getFleetPgHealth is mocked — no DB, no live pg_health table needed (the 0003
// migration is operator-gated). "ai" is mocked ONLY to assert it is never
// called: the deterministic detector must not touch the AI SDK at all.
const { getFleetPgHealthMock, generateTextMock } = vi.hoisted(() => ({
  getFleetPgHealthMock: vi.fn(),
  generateTextMock: vi.fn(async () => ({ text: "should never be called" })),
}));
vi.mock("@/lib/read/pg-health", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/read/pg-health")>()),
  getFleetPgHealth: getFleetPgHealthMock,
}));
vi.mock("ai", () => ({ generateText: generateTextMock }));

const PUBKEY_A = "02" + "ab".repeat(32);
const PUBKEY_B = "03" + "cd".repeat(32);

const NODE_A: Ap12NodeRef = { pubkey: PUBKEY_A, alias: "LQWD-Japan", backend: "lnd" };
const NODE_B: Ap12NodeRef = { pubkey: PUBKEY_B, alias: "LQWD-SouthAfrica", backend: "ldk" };

function makeVerdict(overrides: Partial<PgHealthVerdict> = {}): PgHealthVerdict {
  return {
    connSaturation: { value: 0.2, band: "healthy" },
    tooManyClients: 0,
    serialization40001PerDay: 500,
    rateMultiple: { value: 500 / 600, band: "healthy" },
    xactRollbackDelta: 10,
    ap12Variant: null,
    ...overrides,
  };
}

function makeView(overrides: Partial<FleetPgHealthView> = {}): FleetPgHealthView {
  return {
    hostId: "host-1",
    hostname: "canary",
    nodePubkeys: [PUBKEY_A],
    collectedAt: new Date(),
    stale: false,
    hasData: true,
    health: null,
    verdict: makeVerdict(),
    ...overrides,
  };
}

beforeEach(() => {
  getFleetPgHealthMock.mockReset();
  generateTextMock.mockClear();
});

describe("AP12_NO_DATA_PLACEHOLDER — frozen contract string", () => {
  it("is exported UNCHANGED (the honest no-data copy)", () => {
    expect(AP12_NO_DATA_PLACEHOLDER).toBe(
      "AP-12a/b — no data, needs log ingestion (PG log / pg_stat_* capture is an open Tier-2 gap)",
    );
  });
});

describe("ap12AdvisoryCards — no-data path", () => {
  it("no pg_health rows anywhere ⇒ { cards: [], hasData: false } (placeholder case)", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({ hasData: false, verdict: null, collectedAt: null }),
    ]);
    const result = await ap12AdvisoryCards([NODE_A]);
    expect(result.cards).toEqual([]);
    expect(result.hasData).toBe(false);
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("an empty node list short-circuits without a fleet query", async () => {
    const result = await ap12AdvisoryCards([]);
    expect(result).toEqual({ cards: [], hasData: false });
    expect(getFleetPgHealthMock).not.toHaveBeenCalled();
  });
});

describe("ap12AdvisoryCards — deterministic AP-12a (connection exhaustion)", () => {
  it("high too-many-clients emits an ap12a card deterministically (no LLM)", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        verdict: makeVerdict({
          ap12Variant: "ap12a",
          tooManyClients: 150,
          connSaturation: { value: 0.9, band: "warn" },
        }),
      }),
    ]);
    const { cards, hasData } = await ap12AdvisoryCards([NODE_A, NODE_B]);

    expect(hasData).toBe(true);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("ap12a_conn_exhaustion");
    expect(card.id).toBe(`ap12a_conn_exhaustion:${PUBKEY_A}:node`);
    expect(card.provenance).toBe("deterministic");
    expect(card.provenance).not.toBe("llm-inference");
    // >100 FATAL too-many-clients lines is the runbook's confirmed threshold.
    expect(card.severity).toBe("critical");
    expect(card.evidence.observed).toBe(150);
    expect(card.evidence.threshold).toBe(100);
    expect(card.suggestedAction).toBeNull();
    expect(card.suppressed.active).toBe(false);
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(InsightCardSchema.safeParse(card).success).toBe(true);
  });

  it("saturation-driven ap12a (zero too-many-clients) grades from the conn band", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        verdict: makeVerdict({
          ap12Variant: "ap12a",
          tooManyClients: 0,
          connSaturation: { value: 0.9, band: "warn" },
        }),
      }),
    ]);
    const { cards } = await ap12AdvisoryCards([NODE_A]);
    expect(cards).toHaveLength(1);
    expect(cards[0].severity).toBe("warn");
    expect(cards[0].evidence.metric).toBe("pg_conn_saturation");
    expect(cards[0].evidence.observed).toBeCloseTo(0.9);
    expect(cards[0].evidence.threshold).toBeCloseTo(0.8);
  });
});

describe("ap12AdvisoryCards — deterministic AP-12b (serialization storm)", () => {
  it("a ≥10× 40001 rate emits an ap12b card with band-derived severity", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        verdict: makeVerdict({
          ap12Variant: "ap12b",
          serialization40001PerDay: 10_000,
          rateMultiple: { value: 10_000 / 600, band: "critical" },
        }),
      }),
    ]);
    const { cards } = await ap12AdvisoryCards([NODE_A]);

    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("ap12b_serialization");
    expect(card.id).toBe(`ap12b_serialization:${PUBKEY_A}:node`);
    expect(card.severity).toBe("critical");
    expect(card.provenance).toBe("deterministic");
    expect(card.evidence.metric).toBe("pg_40001_rate_multiple");
    expect(card.evidence.observed).toBeCloseTo(10_000 / 600);
    expect(card.evidence.threshold).toBe(10);
    expect(InsightCardSchema.safeParse(card).success).toBe(true);
  });
});

describe("ap12AdvisoryCards — benign / unmapped cases", () => {
  it("a benign verdict (null variant) emits NO card but hasData stays true", async () => {
    getFleetPgHealthMock.mockResolvedValue([makeView()]);
    const result = await ap12AdvisoryCards([NODE_A]);
    expect(result.cards).toEqual([]);
    expect(result.hasData).toBe(true);
  });

  it("a flagged host whose pubkeys match no requested node emits nothing", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        nodePubkeys: ["02" + "99".repeat(32)],
        verdict: makeVerdict({ ap12Variant: "ap12a", tooManyClients: 500 }),
      }),
    ]);
    const { cards } = await ap12AdvisoryCards([NODE_A]);
    expect(cards).toEqual([]);
  });
});

// =====================================================
// D-04 regression guard — detector is pg_health-counter-driven, independent
// of the log "ap12" classification (Phase-16 16-04 taxonomy reconcile)
// =====================================================
// Phase 16 drops the "ap12" LOG classification from the collector taxonomy
// (classification becomes {info,warn,critical}). D-04 requires that removal to
// be inert for THIS detector: the AP-12 cards are derived PURELY from pg_health
// counters (tooManyClients, serialization40001PerDay via getFleetPgHealth →
// derivePgHealthVerdict), never from a log-classification string. These guards
// feed a fixture that carries ONLY pg_health counters and confirm the detector
// still fires — and that no AI/LLM path runs.
describe("D-04 guard — AP-12 fires from pg_health counters, not the log 'ap12' class", () => {
  it("ap12a fires from the tooManyClients COUNTER with no log classification present", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        verdict: makeVerdict({
          ap12Variant: "ap12a",
          tooManyClients: 150, // pure pg_health counter — the firing driver
          connSaturation: { value: 0.9, band: "warn" },
        }),
      }),
    ]);
    const { cards, hasData } = await ap12AdvisoryCards([NODE_A]);

    expect(hasData).toBe(true);
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("ap12a_conn_exhaustion");
    expect(cards[0].evidence.observed).toBe(150); // the counter, verbatim
    expect(cards[0].provenance).toBe("deterministic");
    // No log-classification input exists on FleetPgHealthView, and the AI SDK
    // must never run — proves D-04 independence from the dropped "ap12" class.
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("ap12b fires from the serialization-40001 COUNTER, AI path never touched", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        verdict: makeVerdict({
          ap12Variant: "ap12b",
          serialization40001PerDay: 12_000, // pure pg_health counter
          rateMultiple: { value: 12_000 / 600, band: "critical" },
        }),
      }),
    ]);
    const { cards } = await ap12AdvisoryCards([NODE_A]);

    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("ap12b_serialization");
    expect(cards[0].provenance).toBe("deterministic");
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("both signal ids survive VERBATIM — the frozen dedupe contract is untouched", () => {
    const asOf = new Date().toISOString();
    const a = buildAp12Card(
      NODE_A,
      makeVerdict({ ap12Variant: "ap12a", tooManyClients: 150 }),
      asOf,
      "host-1",
    );
    const b = buildAp12Card(
      NODE_B,
      makeVerdict({ ap12Variant: "ap12b", rateMultiple: { value: 25, band: "critical" } }),
      asOf,
      "host-2",
    );
    expect(a?.signal).toBe("ap12a_conn_exhaustion");
    expect(b?.signal).toBe("ap12b_serialization");
    expect(a?.id).toBe(`ap12a_conn_exhaustion:${PUBKEY_A}:node`);
    expect(b?.id).toBe(`ap12b_serialization:${PUBKEY_B}:node`);
  });
});

// =====================================================
// I-pg (18-03 / HARDEN-03) — asOf stamped from collectedAt, never a fresh now()
// =====================================================
// The detector used to stamp `evidence.asOf = new Date()` — a 3-day-old critical
// pg_health sample rendered as a fresh critical card. asOf must come from the
// view's OWN `collectedAt` (epoch sentinel when null), and a stale view must be
// badged `stale` in evidence detail rather than presented as fresh.
describe("ap12AdvisoryCards — honest asOf from collectedAt (I-pg)", () => {
  const OLD_SAMPLE = new Date("2026-07-19T00:00:00.000Z"); // 3 days before "today"

  it("a stale view stamps asOf from collectedAt and badges stale — never now()", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        collectedAt: OLD_SAMPLE,
        stale: true,
        verdict: makeVerdict({ ap12Variant: "ap12a", tooManyClients: 150 }),
      }),
    ]);
    const { cards } = await ap12AdvisoryCards([NODE_A]);
    expect(cards).toHaveLength(1);
    expect(cards[0].evidence.asOf).toBe(OLD_SAMPLE.toISOString());
    expect(cards[0].evidence.detail?.stale).toBe("true");
    expect(InsightCardSchema.safeParse(cards[0]).success).toBe(true);
  });

  it("a fresh view stamps asOf from its collectedAt verbatim (no wall-clock substitution)", async () => {
    const sampleAt = new Date("2026-07-22T11:55:00.000Z");
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        collectedAt: sampleAt,
        stale: false,
        verdict: makeVerdict({ ap12Variant: "ap12b", rateMultiple: { value: 25, band: "critical" } }),
      }),
    ]);
    const { cards } = await ap12AdvisoryCards([NODE_A]);
    expect(cards).toHaveLength(1);
    expect(cards[0].evidence.asOf).toBe(sampleAt.toISOString());
    expect(cards[0].evidence.detail).not.toHaveProperty("stale");
  });

  it("a null collectedAt stamps the epoch sentinel and badges stale — never a fabricated now()", async () => {
    getFleetPgHealthMock.mockResolvedValue([
      makeView({
        collectedAt: null,
        stale: false, // deriveStale of null would be true upstream — badge regardless
        verdict: makeVerdict({ ap12Variant: "ap12a", tooManyClients: 150 }),
      }),
    ]);
    const { cards } = await ap12AdvisoryCards([NODE_A]);
    expect(cards).toHaveLength(1);
    expect(cards[0].evidence.asOf).toBe(new Date(0).toISOString());
    expect(cards[0].evidence.detail?.stale).toBe("true");
    expect(InsightCardSchema.safeParse(cards[0]).success).toBe(true);
  });
});

describe("buildAp12Card — frozen InsightCard shape", () => {
  it("every emitted card parses via InsightCardSchema and follows the id rule", () => {
    const asOf = new Date().toISOString();
    const a = buildAp12Card(
      NODE_A,
      makeVerdict({ ap12Variant: "ap12a", tooManyClients: 150 }),
      asOf,
      "host-1",
    );
    const b = buildAp12Card(
      NODE_B,
      makeVerdict({
        ap12Variant: "ap12b",
        rateMultiple: { value: 25, band: "critical" },
      }),
      asOf,
      "host-2",
    );
    expect(a?.id).toBe(`ap12a_conn_exhaustion:${PUBKEY_A}:node`);
    expect(b?.id).toBe(`ap12b_serialization:${PUBKEY_B}:node`);
    for (const card of [a, b]) {
      expect(card).not.toBeNull();
      expect(InsightCardSchema.safeParse(card).success).toBe(true);
      expect(card!.provenance).toBe("deterministic");
      expect(card!.rateLimitGuidance).toBeNull();
    }
  });

  it("a null variant builds no card", () => {
    expect(buildAp12Card(NODE_A, makeVerdict(), new Date().toISOString(), "host-1")).toBeNull();
  });

  it("a deterministic card forged back to llm-inference provenance with warn severity FAILS parse (D-12)", () => {
    const card = buildAp12Card(
      NODE_A,
      makeVerdict({ ap12Variant: "ap12a", tooManyClients: 5, connSaturation: { value: 0.9, band: "warn" } }),
      new Date().toISOString(),
      "host-1",
    );
    const forged = { ...card!, provenance: "llm-inference" as const };
    expect(forged.severity).not.toBe("info");
    expect(InsightCardSchema.safeParse(forged).success).toBe(false);
  });
});
