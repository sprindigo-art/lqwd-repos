import { describe, expect, it } from "vitest";
import { rankCards } from "@/lib/insight/rank";
import type { InsightCard } from "@/lib/insight/types";

// Fixture factory — minimal valid InsightCard shapes; rank.ts never validates,
// it only reads severity / signal / evidence / id.

interface CardOverrides {
  id: string;
  severity?: InsightCard["severity"];
  signal?: InsightCard["signal"];
  observed?: number;
  threshold?: number;
  detail?: Record<string, string | number>;
}

function makeCard({
  id,
  severity = "warn",
  signal = "fee_raise",
  observed = 10,
  threshold = 30,
  detail,
}: CardOverrides): InsightCard {
  return {
    schemaVersion: 1,
    id,
    severity,
    node: { pubkey: "ab".repeat(33), alias: "test-node", backend: "lnd" },
    target: { kind: "node" },
    signal,
    evidence: {
      metric: "test",
      observed,
      threshold,
      unit: "ppm",
      window: "7d",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${"ab".repeat(33)}/fees`,
      ...(detail === undefined ? {} : { detail }),
    },
    suggestedAction: null,
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  };
}

describe("rankCards (D-06)", () => {
  it("returns [] for [] and never throws", () => {
    expect(rankCards([])).toEqual([]);
  });

  it("orders severity bands strictly: critical, warn, info — regardless of input order", () => {
    const cards = [
      makeCard({ id: "i", severity: "info" }),
      makeCard({ id: "c", severity: "critical" }),
      makeCard({ id: "w", severity: "warn" }),
    ];
    for (const perm of [cards, [...cards].reverse(), [cards[1], cards[0], cards[2]]]) {
      expect(rankCards(perm).map((c) => c.severity)).toEqual(["critical", "warn", "info"]);
    }
  });

  it("orders stuck-pending cards by limboSat descending within a band", () => {
    const small = makeCard({
      id: "small",
      signal: "stuck_sweep",
      detail: { limboSat: 1_000 },
    });
    const big = makeCard({
      id: "big",
      signal: "stuck_fc_past_maturity",
      detail: { limboSat: 87_191_667 },
    });
    expect(rankCards([small, big]).map((c) => c.id)).toEqual(["big", "small"]);
  });

  it("never throws on missing/non-numeric limboSat — those stuck cards sort last among stuck", () => {
    const missing = makeCard({ id: "missing", signal: "stuck_open" });
    const garbage = makeCard({
      id: "garbage",
      signal: "stuck_sweep",
      detail: { limboSat: "not-a-number" },
    });
    const present = makeCard({
      id: "present",
      signal: "stuck_sweep",
      detail: { limboSat: 5 },
    });
    const ranked = rankCards([missing, garbage, present]);
    expect(ranked[0].id).toBe("present");
    // null-limbo cards tie → id lexicographic.
    expect(ranked.slice(1).map((c) => c.id)).toEqual(["garbage", "missing"]);
  });

  it("stuck-pending cards precede non-stuck cards within the same severity band", () => {
    const breach = makeCard({ id: "breach", observed: 1000, threshold: 30 });
    const stuck = makeCard({
      id: "stuck",
      signal: "stuck_open",
      detail: { limboSat: 1 },
    });
    expect(rankCards([breach, stuck]).map((c) => c.id)).toEqual(["stuck", "breach"]);
  });

  it("orders non-stuck cards by normalized breach magnitude descending", () => {
    // |10-30|/30 ≈ 0.667 vs |29-30|/30 ≈ 0.033 vs |500-30|/30 ≈ 15.67
    const mild = makeCard({ id: "mild", observed: 29, threshold: 30 });
    const medium = makeCard({ id: "medium", observed: 10, threshold: 30 });
    const severe = makeCard({ id: "severe", observed: 500, threshold: 30 });
    expect(rankCards([mild, medium, severe]).map((c) => c.id)).toEqual([
      "severe",
      "medium",
      "mild",
    ]);
  });

  it("normalizes magnitude with max(|threshold|, 1) — zero threshold never divides by zero", () => {
    const zeroThresh = makeCard({ id: "zero", observed: 3, threshold: 0 }); // |3-0|/1 = 3
    const ratio = makeCard({ id: "ratio", observed: 0.1, threshold: 0.5 }); // |0.1-0.5|/1 = 0.4
    expect(rankCards([ratio, zeroThresh]).map((c) => c.id)).toEqual(["zero", "ratio"]);
  });

  it("breaks ties by id lexicographic", () => {
    const b = makeCard({ id: "b", observed: 10, threshold: 30 });
    const a = makeCard({ id: "a", observed: 10, threshold: 30 });
    expect(rankCards([b, a]).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const cards = [
      makeCard({ id: "i", severity: "info" }),
      makeCard({ id: "c", severity: "critical" }),
    ];
    const snapshot = [...cards];
    rankCards(cards);
    expect(cards).toEqual(snapshot);
    expect(cards[0].id).toBe("i");
  });

  it("is deterministic: any permutation of the same input yields the identical sequence", () => {
    const pool = [
      makeCard({ id: "c1", severity: "critical", observed: 60, threshold: 50 }),
      makeCard({
        id: "c2",
        severity: "critical",
        signal: "stuck_fc_past_maturity",
        detail: { limboSat: 9_000_000 },
      }),
      makeCard({ id: "w1", severity: "warn", observed: 4, threshold: 30 }),
      makeCard({
        id: "w2",
        severity: "warn",
        signal: "stuck_sweep",
        detail: { limboSat: 250_000 },
      }),
      makeCard({ id: "i1", severity: "info", observed: 700, threshold: 500 }),
      makeCard({ id: "i2", severity: "info", observed: 510, threshold: 500 }),
    ];
    const expected = rankCards(pool).map((c) => c.id);
    const permutations = [
      [...pool].reverse(),
      [pool[3], pool[0], pool[5], pool[2], pool[4], pool[1]],
      [pool[5], pool[4], pool[3], pool[0], pool[1], pool[2]],
    ];
    for (const perm of permutations) {
      expect(rankCards(perm).map((c) => c.id)).toEqual(expected);
    }
    // Repeated calls on the same input are identical.
    expect(rankCards(pool).map((c) => c.id)).toEqual(expected);
  });
});
