import { describe, it, expect } from "vitest";
import {
  humanizeDaysToFull,
  projectionStatusCopy,
  formatPctPerDay,
} from "@/lib/read/storage-projection";

// =====================================================
// HOST-02 storage-projection copy (pure, NO DB)
// =====================================================
// Pins the D-15 humanize bands (never a calendar date, never decimals) and the
// D-14 honest status copy — every no-projection status maps to DISTINCT copy so
// the operator always knows WHY a projection is missing. Strings here are the
// UI-SPEC Copywriting Contract verbatim; changing one is a design decision.

const HOUR_MS = 60 * 60 * 1000;

describe("humanizeDaysToFull — D-15 bands", () => {
  it("≥ 365 days reads calm: '>1 year to full'", () => {
    expect(humanizeDaysToFull(400)).toBe(">1 year to full");
    expect(humanizeDaysToFull(365)).toBe(">1 year to full");
  });

  it("90–365 days reads in months (round d/30)", () => {
    expect(humanizeDaysToFull(180)).toBe("~6 months to full");
    expect(humanizeDaysToFull(90)).toBe("~3 months to full");
  });

  it("28–90 days rounds to the nearest 5 days", () => {
    expect(humanizeDaysToFull(45)).toBe("~45 days to full");
    expect(humanizeDaysToFull(43)).toBe("~45 days to full");
    expect(humanizeDaysToFull(28)).toBe("~30 days to full");
  });

  it("7–28 days reads in weeks (round d/7), singular at one week", () => {
    expect(humanizeDaysToFull(21)).toBe("~3 weeks to full");
    expect(humanizeDaysToFull(7)).toBe("~1 week to full");
  });

  it("< 7 days reads in whole days, singular at one day", () => {
    expect(humanizeDaysToFull(5)).toBe("~5 days to full");
    expect(humanizeDaysToFull(1.2)).toBe("~1 day to full");
  });

  it("sub-day never renders '~0 days': pinned to '<1 day to full'", () => {
    expect(humanizeDaysToFull(0.4)).toBe("<1 day to full");
  });

  it("never emits decimals or a calendar date", () => {
    for (const d of [0.4, 1.2, 5, 7, 21, 28, 43, 45, 90, 180, 365, 400]) {
      const s = humanizeDaysToFull(d);
      expect(s).not.toMatch(/\d\.\d/);
      expect(s).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });
});

describe("projectionStatusCopy — D-14 honest status copy", () => {
  it("stale: names the age of the last good reading", () => {
    expect(projectionStatusCopy("stale", { ageMs: 2 * HOUR_MS })).toBe(
      "projection unavailable — data stale (2h old)",
    );
    expect(projectionStatusCopy("stale", { ageMs: 30 * 60 * 1000 })).toBe(
      "projection unavailable — data stale (30m old)",
    );
    expect(projectionStatusCopy("stale", { ageMs: 3 * 24 * HOUR_MS })).toBe(
      "projection unavailable — data stale (3d old)",
    );
  });

  it("stale without a known age omits the parenthetical", () => {
    expect(projectionStatusCopy("stale", {})).toBe("projection unavailable — data stale");
  });

  it("gathering: N = ceil((minWindow − currentSpan)/1h), default 1h window", () => {
    expect(projectionStatusCopy("insufficient-samples", { currentSpanMs: 0 })).toBe(
      "gathering data — projection in ~1h",
    );
    expect(projectionStatusCopy("insufficient-window", { currentSpanMs: 30 * 60 * 1000 })).toBe(
      "gathering data — projection in ~1h",
    );
    expect(
      projectionStatusCopy("insufficient-window", {
        minWindowMs: 4 * HOUR_MS,
        currentSpanMs: 1 * HOUR_MS,
      }),
    ).toBe("gathering data — projection in ~3h");
  });

  it("gathering floors at ~1h even when the span already exceeds the window", () => {
    expect(
      projectionStatusCopy("insufficient-samples", { currentSpanMs: 5 * HOUR_MS }),
    ).toBe("gathering data — projection in ~1h");
  });

  it("flat-or-negative reads 'not growing'", () => {
    expect(projectionStatusCopy("flat-or-negative", {})).toBe("not growing");
  });

  it("every no-projection status yields DISTINCT copy (operator always knows why)", () => {
    const copies = new Set([
      projectionStatusCopy("stale", { ageMs: 2 * HOUR_MS }),
      projectionStatusCopy("insufficient-samples", { currentSpanMs: 0 }),
      projectionStatusCopy("flat-or-negative", {}),
    ]);
    expect(copies.size).toBe(3);
  });
});

describe("formatPctPerDay — signed growth rate", () => {
  it("positive growth always carries an explicit +", () => {
    expect(formatPctPerDay(0.4)).toBe("+0.4%/day");
    expect(formatPctPerDay(0.44)).toBe("+0.4%/day");
  });

  it("negative growth keeps its minus (Pitfall 4: rendered alongside 'not growing')", () => {
    expect(formatPctPerDay(-0.2)).toBe("-0.2%/day");
  });

  it("zero renders unsigned", () => {
    expect(formatPctPerDay(0)).toBe("0.0%/day");
  });
});
