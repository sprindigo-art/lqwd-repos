import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildStepdownSql,
  detectStepdown,
  type StepdownNodeRow,
} from "@/lib/insight/detectors/fee-stepdown";
import { InsightCardSchema } from "@/lib/insight/schema";
import { INSIGHT_CONFIG } from "@/lib/insight/config";
import { SCORECARD_CONFIG } from "@/lib/scorecard/config";

// Fee-stepdown (D-09) detector tests. Two surfaces:
//  1. SQL shape (NO DB) — one fleet-wide pass over lnd_node_forwards with
//     three FILTER windows (24h / 7d / baseline now-35d…now-7d); BOTH baseline
//     bounds in the ns-window ×1e9 form with ::int casts (Pitfall 2); identity
//     column lnd_pubkey (Pitfall 6).
//  2. Golden fixture — the France routing-pnl.md weekly series encoded
//     verbatim; asserts exactly which weeks fire across the whole series.

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildStepdownSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

// Valid 66-lowercase-hex pubkey (buildDeepLink validates before interpolation).
const FRANCE_PUBKEY = "03" + "fa".repeat(32);
const FRANCE_NODE = { pubkey: FRANCE_PUBKEY, alias: "france", backend: "lnd" as const };

// =====================================================
// France golden fixture — routing-pnl.md weekly table, encoded verbatim
// =====================================================
// Source: ../lqwdLogs/france/lqwd-france-node-analytics/routing-pnl.md
// ("Weekly PPM and earnings (cropped to the inflection)"). The contiguous
// 16-row span 2025-11-03 … 2026-02-23 is encoded; the non-contiguous tail
// (2026-03-30 / 05-04 / 05-25) is excluded — the 4-week-trailing-baseline
// transform below requires weekly contiguity. (The source table is cropped:
// 2025-11-10 is also absent; rows are treated as consecutive weeks, which
// matches the RESEARCH §Detector 7 validation arithmetic.)
//
// PPM column from the doc is redundant — it derives from earnedSat/routedBtc
// (PPM = SUM(fee_msat)/SUM(amt_in_msat)×1e6); the fixture stores the source
// columns and lets the detector derive, exactly as production will.
interface FranceWeek {
  week: string;
  forwards: number;
  routedBtc: number;
  earnedSat: number;
  /** Doc's printed PPM — kept for readability/cross-check only. */
  docPpm: number;
}

const FRANCE_WEEKLY: FranceWeek[] = [
  { week: "2025-11-03", forwards: 3416, routedBtc: 2.81, earnedSat: 10355, docPpm: 36.8 },
  { week: "2025-11-17", forwards: 3843, routedBtc: 4.78, earnedSat: 14871, docPpm: 31.1 },
  { week: "2025-11-24", forwards: 3830, routedBtc: 4.76, earnedSat: 14818, docPpm: 31.1 },
  { week: "2025-12-01", forwards: 2690, routedBtc: 3.07, earnedSat: 11901, docPpm: 38.8 },
  { week: "2025-12-08", forwards: 6673, routedBtc: 11.43, earnedSat: 16206, docPpm: 14.2 },
  { week: "2025-12-15", forwards: 11288, routedBtc: 16.61, earnedSat: 25334, docPpm: 15.3 },
  { week: "2025-12-22", forwards: 7338, routedBtc: 9.87, earnedSat: 22099, docPpm: 22.4 },
  { week: "2025-12-29", forwards: 3402, routedBtc: 5.6, earnedSat: 11599, docPpm: 20.7 },
  { week: "2026-01-05", forwards: 7823, routedBtc: 4.9, earnedSat: 1113, docPpm: 2.27 },
  { week: "2026-01-12", forwards: 8569, routedBtc: 5.6, earnedSat: 565, docPpm: 1.01 },
  { week: "2026-01-19", forwards: 7370, routedBtc: 4.23, earnedSat: 429, docPpm: 1.01 },
  { week: "2026-01-26", forwards: 2692, routedBtc: 3.55, earnedSat: 402, docPpm: 1.13 },
  { week: "2026-02-02", forwards: 2514, routedBtc: 3.8, earnedSat: 1003, docPpm: 2.64 },
  { week: "2026-02-09", forwards: 3071, routedBtc: 4.22, earnedSat: 1174, docPpm: 2.78 },
  { week: "2026-02-16", forwards: 1637, routedBtc: 2.14, earnedSat: 585, docPpm: 2.73 },
  { week: "2026-02-23", forwards: 1559, routedBtc: 2.69, earnedSat: 852, docPpm: 3.17 },
];

// Fixture-encoding constants (mirror units.ts MSAT_PER_SAT; routed BTC →
// amt_in msat: 1 BTC = 1e8 sat = 1e11 msat). These exist only to turn the
// doc's sat/BTC columns into the warehouse's msat aggregates.
const MSAT_PER_SAT = 1000;
const MSAT_PER_BTC = 1e11;

function feesMsat(w: FranceWeek): number {
  return w.earnedSat * MSAT_PER_SAT;
}
function amtMsat(w: FranceWeek): number {
  return w.routedBtc * MSAT_PER_BTC;
}

/**
 * Detector input for evaluating week i: current 7d = week i; baseline = the
 * 4 prior weeks aggregated as ONE window (trailing 28d ending 7d ago). The
 * 24h sub-window assumes a uniform week (÷7 on both numerator and denominator
 * — preserves the week's PPM exactly), since the doc has weekly resolution.
 */
function rowForWeek(i: number): StepdownNodeRow {
  const cur = FRANCE_WEEKLY[i];
  const base = FRANCE_WEEKLY.slice(i - 4, i);
  return {
    node: FRANCE_NODE,
    fees7dMsat: feesMsat(cur),
    amtIn7dMsat: amtMsat(cur),
    forwards7d: cur.forwards,
    fees24hMsat: feesMsat(cur) / 7,
    amtIn24hMsat: amtMsat(cur) / 7,
    feesBaselineMsat: base.reduce((s, w) => s + feesMsat(w), 0),
    amtInBaselineMsat: base.reduce((s, w) => s + amtMsat(w), 0),
    forwardsBaseline: base.reduce((s, w) => s + w.forwards, 0),
  };
}

describe("buildStepdownSql shape", () => {
  it("carries the ns ×1e9 factor on BOTH baseline bounds (Pitfall 2) — at least twice overall", () => {
    const { sql } = render(buildStepdownSql());
    const occurrences = (sql.match(/1e9/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("casts bound window factors ::int and binds only numbers", () => {
    const { sql, params } = render(buildStepdownSql());
    expect(sql).toContain("::int");
    expect(params.length).toBeGreaterThan(0);
    expect(params.every((p) => typeof p === "number")).toBe(true);
  });

  it("aggregates per lnd_pubkey (Pitfall 6) and excludes NULL identity", () => {
    const { sql } = render(buildStepdownSql());
    expect(sql).toContain("group by lnd_pubkey");
    expect(sql).toContain("lnd_pubkey is not null");
  });

  it("computes all three windows in one pass via FILTER, with a bounded baseline (upper bound present)", () => {
    const { sql } = render(buildStepdownSql());
    expect(sql).toContain("filter");
    expect(sql).toContain("<=");
  });

  it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
    const { sql } = render(buildStepdownSql());
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("PPM-LOW reads the scorecard band — never a forked literal", () => {
  it("module source contains no restated tier-1 PPM literal (T-04-05 drift guard)", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./fee-stepdown.ts", import.meta.url)),
      "utf8",
    );
    expect(source.includes("= 10")).toBe(false);
    expect(source.includes("< 10")).toBe(false);
  });

  it("fires critical PPM-LOW below SCORECARD_CONFIG revenue tier1 with healthy drift/earnings", () => {
    const tier1 = SCORECARD_CONFIG.lnd.revenue.tier1;
    expect(tier1).toBeDefined();
    const targetPpm = (tier1?.value ?? 0) * 0.8; // below the band, above ppmBaselineMin
    expect(targetPpm).toBeGreaterThanOrEqual(INSIGHT_CONFIG.lnd.ppmBaselineMin);

    const amt7d = 1e12;
    const fees7d = (targetPpm * amt7d) / 1e6; // ppm7d === targetPpm
    const row: StepdownNodeRow = {
      node: FRANCE_NODE,
      fees7dMsat: fees7d,
      amtIn7dMsat: amt7d,
      forwards7d: 500,
      fees24hMsat: fees7d / 7,
      amtIn24hMsat: amt7d / 7,
      // Baseline at the SAME ppm → drift ratio 1; weekly earnings equal → ratio 1.
      feesBaselineMsat: fees7d * 4,
      amtInBaselineMsat: amt7d * 4,
      forwardsBaseline: 2000,
    };
    const cards = detectStepdown([row]);
    expect(cards).toHaveLength(1);
    expect(cards[0].severity).toBe("critical");
    expect(cards[0].signal).toBe("fee_stepdown");
    expect(cards[0].evidence.metric).toBe("ppm_24h_low");
    expect(cards[0].evidence.observed).toBeCloseTo(targetPpm, 6);
    expect(cards[0].evidence.threshold).toBe(tier1?.value);
  });
});

describe("noise floors and null-PPM discipline", () => {
  it("baseline forwards under baselineForwardsMin → no card (no baseline to step down from)", () => {
    const crashed = rowForWeek(8); // Jan-05 crash shape
    const cards = detectStepdown([{ ...crashed, forwardsBaseline: 150 }]);
    expect(cards).toHaveLength(0);
  });

  it("null PPM (zero 7d flow) → no card — never coerced to 0 (Pitfall 4)", () => {
    const row: StepdownNodeRow = {
      node: FRANCE_NODE,
      fees7dMsat: 0,
      amtIn7dMsat: 0, // zero flow → ppm7d is null, not 0
      forwards7d: 0,
      fees24hMsat: 0,
      amtIn24hMsat: 0,
      // Healthy baseline — an idle week must NOT read as a fee crash.
      feesBaselineMsat: 60_000_000,
      amtInBaselineMsat: 3e12,
      forwardsBaseline: 5000,
    };
    expect(detectStepdown([row])).toHaveLength(0);
  });

  it("already-crashed baseline (ppmBaseline below ppmBaselineMin) → no card", () => {
    const cards = detectStepdown([rowForWeek(12)]); // Feb-02: baseline is the crashed Jan weeks
    expect(cards).toHaveLength(0);
  });
});

describe("France golden series — exact fire matrix", () => {
  // Evaluate every week that has a full 4-week baseline (i = 4 … 15).
  const fired: string[] = [];
  for (let i = 4; i < FRANCE_WEEKLY.length; i++) {
    if (detectStepdown([rowForWeek(i)]).length > 0) fired.push(FRANCE_WEEKLY[i].week);
  }

  it("fires at the 2026-01-05 crash week", () => {
    expect(fired).toContain("2026-01-05");
  });

  it("fires through the post-crash weeks while the baseline is still healthy, then the noise floor silences", () => {
    expect(fired).toContain("2026-01-12");
    expect(fired).toContain("2026-01-19");
    expect(fired).toContain("2026-01-26");
    // Feb onward: baseline itself is crashed (ppmBaseline < ppmBaselineMin).
    expect(fired).not.toContain("2026-02-02");
    expect(fired).not.toContain("2026-02-09");
    expect(fired).not.toContain("2026-02-16");
    expect(fired).not.toContain("2026-02-23");
  });

  it("does NOT fire on the healthy pre-crash weeks (Dec-15, Dec-22, Dec-29)", () => {
    expect(fired).not.toContain("2025-12-15");
    expect(fired).not.toContain("2025-12-22");
    expect(fired).not.toContain("2025-12-29");
  });

  // Dec-8 BOUNDARY WEEK — documented assertion (RESEARCH §Detector 7 note).
  // The doc's rounded arithmetic (14.2 vs ~30.6) estimated ratio ≈0.46; the
  // exact msat-derived fixture gives 14.18 / 33.69 ≈ 0.42 — under the 0.5
  // ppmDriftRatio knob, so Dec-8 FIRES. Per the research note this is arguably
  // a TRUE positive (a real ~2.4× fee softening week). If the operator finds
  // it noisy, retune ppmDriftRatio in INSIGHT_CONFIG (D-13) — this assertion
  // then flips and must be updated deliberately alongside the knob.
  it("fires at the 2025-12-08 boundary week (drift ratio ≈0.42 — arguably a true 2.4× softening)", () => {
    expect(fired).toContain("2025-12-08");
    const card = detectStepdown([rowForWeek(4)])[0];
    expect(card.evidence.metric).toBe("ppm_7d_vs_baseline");
    expect(card.evidence.observed).toBeCloseTo(0.42, 2);
    expect(card.evidence.threshold).toBe(INSIGHT_CONFIG.lnd.ppmDriftRatio);
  });

  it("the complete fire set is exactly {Dec-08, Jan-05, Jan-12, Jan-19, Jan-26}", () => {
    expect(fired).toEqual([
      "2025-12-08",
      "2026-01-05",
      "2026-01-12",
      "2026-01-19",
      "2026-01-26",
    ]);
  });

  it("Jan-05 card carries the validation arithmetic in detail (restoration target included)", () => {
    const card = detectStepdown([rowForWeek(8)])[0];
    expect(() => InsightCardSchema.parse(card)).not.toThrow();
    expect(card.severity).toBe("critical");
    expect(card.evidence.window).toBe("7d vs 28d-prior");
    expect(card.evidence.deepLink).toBe(`/${FRANCE_PUBKEY}/forwards`);
    // PPM-DRIFT arithmetic: 2.27 / 17.29 ≈ 0.13 < 0.5.
    expect(card.evidence.detail?.ppm7d).toBeCloseTo(2.27, 2);
    expect(card.evidence.detail?.ppmBaseline).toBeCloseTo(17.29, 1);
    // EARNINGS-DROP arithmetic: 1,113 < 0.3 × 18,809.5.
    expect(card.evidence.detail?.earnings7dSat).toBe(1113);
    expect(card.evidence.detail?.baselineWeeklyEarningsSat).toBeCloseTo(18809.5, 1);
    // D-08 dedupe id: one card per node max.
    expect(card.id).toBe(`fee_stepdown:${FRANCE_PUBKEY}:node`);
    expect(card.target.kind).toBe("node");
  });

  it("every fired card suggests investigate — NEVER update_fee (France post-mortem)", () => {
    for (let i = 4; i < FRANCE_WEEKLY.length; i++) {
      for (const card of detectStepdown([rowForWeek(i)])) {
        expect(card.suggestedAction?.type).toBe("investigate");
        expect(card.suggestedAction?.params).toEqual({});
        // investigate is not a write card → no D-16 guidance text.
        expect(card.rateLimitGuidance).toBeNull();
      }
    }
  });

  it("emits one card per node max even when all three rules fire", () => {
    expect(detectStepdown([rowForWeek(8)])).toHaveLength(1);
  });
});

// ── 18-06: malformed-pubkey fail-soft (review I2) ─────────────────────────────
describe("detectStepdown — malformed pubkey fail-soft (I2)", () => {
  // uppercase hex — fails buildDeepLink's `^[0-9a-f]{66}$` gate.
  const BAD_NODE = { pubkey: "FF".repeat(33), alias: "bad", backend: "lnd" as const };

  it("degrades a malformed-pubkey row to no card instead of throwing", () => {
    const row: StepdownNodeRow = { ...rowForWeek(8), node: BAD_NODE };
    expect(() => detectStepdown([row])).not.toThrow();
    expect(detectStepdown([row])).toEqual([]);
  });

  it("still emits the valid-pubkey card when another row's pubkey is malformed", () => {
    const bad: StepdownNodeRow = { ...rowForWeek(8), node: BAD_NODE };
    const cards = detectStepdown([bad, rowForWeek(8)]);
    expect(cards).toHaveLength(1);
    expect(cards[0].node?.pubkey).toBe(FRANCE_PUBKEY);
  });
});
