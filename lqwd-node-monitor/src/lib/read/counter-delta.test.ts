import { describe, it, expect } from "vitest";
import { clampCounterDelta } from "@/lib/read/counter-delta";

// Pitfall 7 — cumulative counters (`xact_rollback`, `net_*_bytes`, `tcp_retrans_segs`)
// reset to 0 on a PG restart / `pg_stat_reset()` / interface reset. A naive
// `curr - prev` then goes NEGATIVE. `clampCounterDelta` is the single pure clamp
// every rate derivation goes through: Δ is ALWAYS ≥ 0 or null (honest no-data).
//
// Contract under test:
//   - normal case (curr ≥ prev, same reset stamp)  → curr − prev
//   - curr < prev (counter went backwards ⇒ reset) → curr (fresh baseline, never negative)
//   - currReset ≠ prevReset (stats_reset moved)    → curr (reset boundary, even if curr ≥ prev)
//   - prev null/undefined (no prior sample)        → null (no rate derivable yet)
//   - bigint | number inputs both accepted; result is a plain number

describe("clampCounterDelta — Pitfall 7 counter-reset clamp", () => {
  it("normal case: curr >= prev, same reset stamp → curr - prev", () => {
    expect(clampCounterDelta(100, 150)).toBe(50);
    expect(clampCounterDelta(100, 150, "t1", "t1")).toBe(50);
  });

  it("zero delta: unchanged counter → 0, not null", () => {
    expect(clampCounterDelta(100, 100)).toBe(0);
  });

  it("backwards counter (curr < prev) → curr as fresh baseline, never -70", () => {
    expect(clampCounterDelta(100n, 30n)).toBe(30);
    expect(clampCounterDelta(100, 30)).toBe(30);
  });

  it("stats_reset moved → curr, even though curr >= prev", () => {
    expect(clampCounterDelta(100, 150, "t1", "t2")).toBe(150);
  });

  it("stats_reset moved from null to a stamp counts as a boundary", () => {
    expect(clampCounterDelta(100, 150, null, "t2")).toBe(150);
    expect(clampCounterDelta(100, 150, "t1", null)).toBe(150);
  });

  it("both reset stamps absent behaves as same-epoch (normal delta)", () => {
    expect(clampCounterDelta(10, 25, null, null)).toBe(15);
    expect(clampCounterDelta(10, 25, undefined, undefined)).toBe(15);
  });

  it("no prior sample (prev null/undefined) → null, honest no-data", () => {
    expect(clampCounterDelta(null, 150)).toBeNull();
    expect(clampCounterDelta(undefined, 150)).toBeNull();
  });

  it("bigint inputs: normal delta and reset boundary both return plain numbers", () => {
    expect(clampCounterDelta(1000n, 1500n)).toBe(500);
    expect(clampCounterDelta(1000n, 1500n, "t1", "t2")).toBe(1500);
    expect(typeof clampCounterDelta(1000n, 1500n)).toBe("number");
  });

  it("mixed bigint/number inputs normalize", () => {
    expect(clampCounterDelta(100n, 150)).toBe(50);
    expect(clampCounterDelta(100, 150n)).toBe(50);
  });

  it("property: every non-null result is >= 0 across the boundary matrix", () => {
    const prevs = [null, undefined, 0, 50, 100, 100n] as const;
    const currs = [0, 30, 100, 150, 150n] as const;
    const resets = [
      [undefined, undefined],
      ["t1", "t1"],
      ["t1", "t2"],
      [null, "t2"],
    ] as const;
    for (const prev of prevs) {
      for (const curr of currs) {
        for (const [pr, cr] of resets) {
          const d = clampCounterDelta(prev, curr, pr, cr);
          if (d !== null) {
            expect(d).toBeGreaterThanOrEqual(0);
          } else {
            // null ONLY when there is no prior sample
            expect(prev === null || prev === undefined).toBe(true);
          }
        }
      }
    }
  });
});
