import { describe, it, expect } from "vitest";
import {
  computeStorageGrowth,
  type StorageGrowthSample,
} from "@/lib/read/storage-growth";

// =====================================================
// HOST-02 storage-growth honesty gate (pure, NO DB)
// =====================================================
// %/day growth + projected time-to-full are computed at READ time from a passed-in
// host_storage history series. The HONESTY gate returns an explicit no-projection
// marker (never a fabricated number) when the window is too short, too sparse, or
// stale, and never projects on flat/negative growth (no Infinity-as-a-number).

const DAY_MS = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 5, 1, 0, 0, 0);

function sample(offsetDays: number, used: number, total = 1000): StorageGrowthSample {
  return { collectedAt: new Date(T0 + offsetDays * DAY_MS), usedBytes: used, totalBytes: total };
}

describe("computeStorageGrowth — healthy growth", () => {
  it("projects a finite days-to-full from a clean rising series", () => {
    const series = [sample(0, 500), sample(2, 700)];
    const r = computeStorageGrowth(series, { now: T0 + 2 * DAY_MS });
    expect(r.status).toBe("ok");
    // 0.5 → 0.7 over 2 days = 10 percentage-points/day.
    expect(r.pctPerDay).toBeCloseTo(10, 5);
    // remaining 0.3 / 0.1 per day = 3 days.
    expect(r.daysToFull).toBeCloseTo(3, 5);
    expect(r.latestPctUsed).toBeCloseTo(70, 5);
  });
});

describe("computeStorageGrowth — honesty gate", () => {
  it("a single-sample window is insufficient (no projection)", () => {
    const r = computeStorageGrowth([sample(0, 500)], { now: T0 });
    expect(r.status).toBe("insufficient-samples");
    expect(r.daysToFull).toBeNull();
  });

  it("an empty window is insufficient", () => {
    const r = computeStorageGrowth([], { now: T0 });
    expect(r.status).toBe("insufficient-samples");
    expect(r.daysToFull).toBeNull();
    expect(r.latestPctUsed).toBeNull();
  });

  it("a stale latest sample yields no projection", () => {
    const series = [sample(0, 500), sample(2, 700)];
    // now is 60 min past the latest reading → stale (default 15-min window).
    const r = computeStorageGrowth(series, { now: T0 + 2 * DAY_MS + 60 * 60 * 1000 });
    expect(r.status).toBe("stale");
    expect(r.daysToFull).toBeNull();
  });

  it("too-short a span is insufficient-window (rate untrustworthy)", () => {
    const series = [sample(0, 500), { ...sample(0, 510), collectedAt: new Date(T0 + 60 * 1000) }];
    const r = computeStorageGrowth(series, { now: T0 + 60 * 1000 });
    expect(r.status).toBe("insufficient-window");
    expect(r.daysToFull).toBeNull();
  });

  it("flat growth never projects time-to-full (no divide-by-~0 Infinity)", () => {
    const series = [sample(0, 500), sample(2, 500)];
    const r = computeStorageGrowth(series, { now: T0 + 2 * DAY_MS });
    expect(r.status).toBe("flat-or-negative");
    expect(r.daysToFull).toBeNull();
  });

  it("negative growth (disk freeing) never projects time-to-full", () => {
    const series = [sample(0, 700), sample(2, 500)];
    const r = computeStorageGrowth(series, { now: T0 + 2 * DAY_MS });
    expect(r.status).toBe("flat-or-negative");
    expect(r.daysToFull).toBeNull();
    expect(r.pctPerDay).toBeLessThan(0);
  });

  it("accepts unsorted input and bigint byte columns", () => {
    const series: StorageGrowthSample[] = [
      { collectedAt: new Date(T0 + 2 * DAY_MS), usedBytes: 700n, totalBytes: 1000n },
      { collectedAt: new Date(T0), usedBytes: 500n, totalBytes: 1000n },
    ];
    const r = computeStorageGrowth(series, { now: T0 + 2 * DAY_MS });
    expect(r.status).toBe("ok");
    expect(r.daysToFull).toBeCloseTo(3, 5);
  });
});
