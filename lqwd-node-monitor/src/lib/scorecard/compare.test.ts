import { describe, expect, it } from "vitest";
import { mad, median, outlierCheck, outlierFor } from "@/lib/scorecard/compare";

// D-10/D-11/D-12: MAD outlier math — small-cohort suppression, MAD===0 guard,
// and the direction-aware bad-tail filter. The outlier result is a SEPARATE
// signal and never feeds a grade (compare.ts has no grade inputs/outputs).

describe("median", () => {
  it("odd-length: middle element", () => {
    expect(median([5, 1, 9])).toBe(5);
  });

  it("even-length: mean of the two middle elements", () => {
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });
});

describe("outlierCheck (D-11 suppression + D-12 MAD guard)", () => {
  it("cohort of 2 → suppressed ('no peer baseline yet' trigger, D-11)", () => {
    expect(outlierCheck(100, [1, 2])).toEqual({ suppressed: true });
  });

  it("identical cohort (MAD 0) → nobody is an outlier, even a far value", () => {
    const cohort = [50, 50, 50, 50, 50];
    expect(mad(cohort)).toBe(0);
    const result = outlierCheck(1_000_000, cohort);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.isOutlier).toBe(false);
      expect(result.median).toBe(50);
    }
  });

  it("clear outlier in a 25-value cohort → isOutlier true with correct deltaFromMedian sign", () => {
    // 25 values tightly around 100, candidate far below
    const cohort = Array.from({ length: 25 }, (_, i) => 95 + (i % 11)); // 95..105
    const result = outlierCheck(2, cohort);
    expect(result.suppressed).toBe(false);
    if (!result.suppressed) {
      expect(result.isOutlier).toBe(true);
      expect(result.deltaFromMedian).toBeLessThan(0); // below the median → negative delta
      expect(result.deltaFromMedian).toBe(2 - result.median);
    }
  });
});

describe("outlierFor (D-12 direction-aware bad tail)", () => {
  // tight cohort around 100 so any extreme is a raw MAD outlier on either side
  const cohort = Array.from({ length: 25 }, (_, i) => 95 + (i % 11));

  it("higher-better: HIGH-side outlier NOT flagged, LOW-side flagged", () => {
    const high = outlierFor(10_000, cohort, "higher-better");
    expect(high.suppressed).toBe(false);
    expect(high.isOutlier).toBe(false); // doing GREAT is not a bad-tail outlier

    const low = outlierFor(2, cohort, "higher-better");
    expect(low.suppressed).toBe(false);
    expect(low.isOutlier).toBe(true);
    expect(low.deltaFromMedian).toBeLessThan(0);
  });

  it("lower-better: LOW-side outlier NOT flagged, HIGH-side flagged", () => {
    const low = outlierFor(0, cohort, "lower-better");
    expect(low.isOutlier).toBe(false); // lowest force-close count is healthy

    const high = outlierFor(10_000, cohort, "lower-better");
    expect(high.isOutlier).toBe(true);
    expect(high.deltaFromMedian).toBeGreaterThan(0);
  });

  it("mid-better: flags BOTH tails", () => {
    expect(outlierFor(10_000, cohort, "mid-better").isOutlier).toBe(true);
    expect(outlierFor(2, cohort, "mid-better").isOutlier).toBe(true);
  });

  it("small cohort suppresses regardless of direction (D-11)", () => {
    expect(outlierFor(100, [1, 2], "higher-better")).toEqual({ suppressed: true });
  });
});
