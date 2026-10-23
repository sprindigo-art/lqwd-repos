import { describe, expect, it } from "vitest";
import { rollupLayer, type LayerVitals } from "@/lib/overview/vitals";
import type { Severity } from "@/components/df/Severity";

// vitals.ts is the PURE proportional rollup behind the fleet-vitals bar
// (OVW-03 / D-07). A bar segment's width is strictly `count / total` — no
// severity weighting — with `total` = EVERY entity in the layer (healthy
// included) and `stale` carrying its own segment, never folded into healthy
// (D-08). The caller reduces a multi-signal entity to ONE ramp value before
// passing it in, so each entity contributes exactly 1 (Pitfall 4).

const emptyCounts = (): Record<Severity, number> => ({
  critical: 0,
  warning: 0,
  watch: 0,
  healthy: 0,
  stale: 0,
});

describe("rollupLayer (OVW-03 / D-07)", () => {
  it("counts each entity into its df state and reports total = entity count", () => {
    const v = rollupLayer("nodes", ["healthy", "healthy", "critical", "stale"]);
    expect(v.counts).toEqual({ critical: 1, warning: 0, watch: 0, healthy: 2, stale: 1 });
    expect(v.total).toBe(4);
    expect(v.worst).toBe("critical");
    expect(v.layer).toBe("nodes");
  });

  it("proportionality contract: a segment width is exactly count / total", () => {
    const v = rollupLayer("nodes", ["healthy", "healthy", "critical", "stale"]);
    // 1 critical of 4 entities → the bar segment is literally 0.25 wide.
    expect(v.counts.critical / v.total).toBe(0.25);
    expect(v.counts.healthy / v.total).toBe(0.5);
  });

  it("includes healthy in the denominator: an all-healthy layer is total === N, healthy === N", () => {
    const severities: Severity[] = ["healthy", "healthy", "healthy", "healthy", "healthy"];
    const v = rollupLayer("services", severities);
    expect(v.total).toBe(5);
    expect(v.counts.healthy).toBe(5);
    expect(v.counts.healthy / v.total).toBe(1.0); // proportion healthy = 1.0
    expect(v.worst).toBe("healthy");
  });

  it("stale is its own bucket — stale entities never increment healthy (D-08)", () => {
    const v = rollupLayer("hosts", ["stale", "stale", "healthy"]);
    expect(v.counts.stale).toBe(2);
    expect(v.counts.healthy).toBe(1); // the lone healthy, not 3
    expect(v.total).toBe(3);
  });

  it("worst is worstSeverity over present severities; stale is orthogonal", () => {
    // stale never promotes a healthy parent — worst of [healthy, stale] is healthy.
    expect(rollupLayer("storage", ["healthy", "stale"]).worst).toBe("healthy");
    // active rungs do reduce normally.
    expect(rollupLayer("bitcoind", ["watch", "warning", "stale"]).worst).toBe("warning");
  });

  it("empty layer: all counts 0, total 0, worst healthy (caller guards divide-by-zero)", () => {
    const v: LayerVitals = rollupLayer("storage", []);
    expect(v.counts).toEqual(emptyCounts());
    expect(v.total).toBe(0);
    expect(v.worst).toBe("healthy");
  });

  it("does not mutate the input array", () => {
    const severities: Severity[] = ["critical", "healthy", "stale"];
    const snapshot = [...severities];
    rollupLayer("nodes", severities);
    expect(severities).toEqual(snapshot);
  });
});
