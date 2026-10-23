import { describe, expect, it } from "vitest";
import {
  compositeOf,
  criticalChips,
  gradeDimension,
  gradeNoData,
  letterFor,
  nodeDot,
  pctFor,
  reasonFor,
} from "@/lib/scorecard/grade";
import { SCORECARD_CONFIG } from "@/lib/scorecard/config";
import type { Band } from "@/lib/scorecard/config";
import type { DimensionKey, GradedDimension, Letter } from "@/lib/scorecard/types";

// D-07 verification is the point of this file: red comes ONLY from Tier-1
// breaches; warn-level issues cap at yellow; composite excludes no-data dims.

const LND = SCORECARD_CONFIG.lnd;

/** Fabricate a GradedDimension at a given pct (letter derived), optionally breached. */
function gd(
  key: DimensionKey,
  pct: number | null,
  opts: { breachLabel?: string } = {},
): GradedDimension {
  const letter: Letter | null = pct === null ? null : letterFor(pct);
  return {
    key,
    raw: pct,
    pct,
    letter,
    color: opts.breachLabel ? "critical" : pct === null ? "nodata" : "ok",
    tier1Breach: opts.breachLabel ? { label: opts.breachLabel } : null,
    asOf: null,
  };
}

describe("D-07 hard rule: red is Tier-1 ONLY", () => {
  it("a single tier1 breach yields nodeDot 'critical' even with 9 healthy dims (never diluted)", () => {
    // revenue raw 5 PPM < 10 → "fee crash" breach via the real config
    const breached = gradeDimension("revenue", { raw: 5, asOf: null }, LND.revenue);
    expect(breached.tier1Breach).toEqual({ label: "fee crash" });

    const dims: GradedDimension[] = [
      gd("routing", 95),
      breached,
      gd("liquidity", 95),
      gd("channelHealth", 95),
      gd("forceClose", 95),
      gd("restart", 95),
      gd("peer", 95),
      gd("stability", null),
      gd("pgHealth", null),
      gd("visibility", null),
    ];
    expect(nodeDot(dims)).toBe("critical");
    expect(criticalChips(dims)).toEqual(["fee crash"]);

    // composite still averages ALL gradable pcts — the breached dim is NOT
    // excluded from the mean; the chip is the separate signal (D-07).
    const breachedPct = breached.pct as number;
    const expected = Math.round((95 * 6 + breachedPct) / 7);
    expect(compositeOf(dims)).toEqual({ pct: expected, letter: letterFor(expected) });
  });

  it("multiple C/D/F dims with ZERO tier1 → nodeDot 'warn', never 'critical' (operator hard rule)", () => {
    const dims: GradedDimension[] = [
      gd("routing", 40), // F
      gd("revenue", 55), // F
      gd("liquidity", 65), // D
      gd("channelHealth", 72), // C
      gd("forceClose", 95),
      gd("restart", 95),
      gd("peer", 95),
    ];
    expect(dims.every((d) => d.tier1Breach === null)).toBe(true);
    expect(nodeDot(dims)).toBe("warn");
    expect(nodeDot(dims)).not.toBe("critical");
  });

  it("all A/B → 'ok' and reasonFor null", () => {
    const dims: GradedDimension[] = [gd("routing", 92), gd("revenue", 85), gd("peer", 81)];
    expect(nodeDot(dims)).toBe("ok");
    expect(reasonFor(dims, LND)).toBeNull();
  });
});

describe("compositeOf (D-06: unweighted mean of AVAILABLE dims)", () => {
  it("excludes no-data dims: 7 gradable @80 + 3 nodata → 80", () => {
    const dims: GradedDimension[] = [
      gd("routing", 80),
      gd("revenue", 80),
      gd("liquidity", 80),
      gd("channelHealth", 80),
      gd("forceClose", 80),
      gd("restart", 80),
      gd("peer", 80),
      gradeNoData("stability"),
      gradeNoData("pgHealth"),
      gradeNoData("visibility"),
    ];
    expect(compositeOf(dims)).toEqual({ pct: 80, letter: "B" });
  });

  it("returns null when no dim is gradable", () => {
    expect(compositeOf([gradeNoData("stability"), gradeNoData("pgHealth")])).toBeNull();
  });
});

describe("letterFor boundaries", () => {
  it("90→A, 89.99→B, 60→D, 59→F", () => {
    expect(letterFor(90)).toBe("A");
    expect(letterFor(89.99)).toBe("B");
    expect(letterFor(60)).toBe("D");
    expect(letterFor(59)).toBe("F");
  });
});

describe("pctFor direction handling", () => {
  it("higher-better: raw at cutoff a → 90", () => {
    const band: Band = { a: 100, b: 50, c: 30, d: 10, direction: "higher-better" };
    expect(pctFor(100, band)).toBe(90);
  });

  it("lower-better: raw at cutoff d → 60", () => {
    const band: Band = { a: 0.02, b: 0.05, c: 0.08, d: 0.15, direction: "lower-better" };
    expect(pctFor(0.15, band)).toBeCloseTo(60, 6);
  });

  it("mid-better: raw at center → max pct (100)", () => {
    const band: Band = { a: 0.15, b: 0.25, c: 0.3, d: 0.4, direction: "mid-better", center: 0.5 };
    expect(pctFor(0.5, band)).toBe(100);
  });

  it("mid-better is symmetric: raw 0.9 grades the same as raw 0.1 (center 0.5)", () => {
    const band: Band = { a: 0.15, b: 0.25, c: 0.3, d: 0.4, direction: "mid-better", center: 0.5 };
    expect(pctFor(0.9, band)).toBeCloseTo(pctFor(0.1, band), 9);
  });

  it("forceClose lower-better a:0 edge — raw 0 → 90 (no NaN from the zero cutoff)", () => {
    expect(pctFor(0, LND.forceClose.band)).toBeGreaterThanOrEqual(90);
  });
});

describe("tier1 evaluation from extras (D-08)", () => {
  it("forceClose: raw 0 is healthy but extras.maxHourlySelfCloses 60 ≥ 50 → close-storm breach", () => {
    const graded = gradeDimension(
      "forceClose",
      { raw: 0, asOf: null, extras: { maxHourlySelfCloses: 60 } },
      LND.forceClose,
    );
    expect(graded.tier1Breach).toEqual({ label: "close storm" });
    expect(graded.color).toBe("critical");
    // the band grade itself is still healthy — the breach came from the extras metric
    expect(graded.pct).toBeGreaterThanOrEqual(90);
  });

  it("forceClose: raw 0 with calm extras → no breach, ok", () => {
    const graded = gradeDimension(
      "forceClose",
      { raw: 0, asOf: null, extras: { maxHourlySelfCloses: 1 } },
      LND.forceClose,
    );
    expect(graded.tier1Breach).toBeNull();
    expect(graded.color).toBe("ok");
  });
});

describe("reasonFor (D-06 reason subtext)", () => {
  it("picks the tier1 label over a LOWER-graded non-critical dim", () => {
    const dims: GradedDimension[] = [
      gd("routing", 30), // F — far worse pct, but NOT critical
      gd("revenue", 85, { breachLabel: "fee crash" }),
      gd("peer", 95),
    ];
    expect(reasonFor(dims, LND)).toBe("critical: fee crash");
  });

  it("with no breach, names the lowest-pct C/D/F dim via its configured reasonLabel", () => {
    const dims: GradedDimension[] = [
      gd("routing", 75), // C
      gd("channelHealth", 62), // D — lowest
      gd("peer", 95),
    ];
    expect(reasonFor(dims, LND)).toBe("high inactive channels");
  });
});

describe("gradeDimension null raw / gradeNoData (D-01)", () => {
  it("null raw delegates to a no-data result preserving note and asOf", () => {
    const asOf = new Date("2026-06-01T00:00:00Z");
    const graded = gradeDimension(
      "routing",
      { raw: null, asOf, note: "no forwards rows" },
      LND.routing,
    );
    expect(graded.pct).toBeNull();
    expect(graded.letter).toBeNull();
    expect(graded.color).toBe("nodata");
    expect(graded.note).toBe("no forwards rows");
    expect(graded.asOf).toBe(asOf);
  });
});
