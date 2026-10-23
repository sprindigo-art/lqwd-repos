import { describe, expect, it } from "vitest";
import {
  clampBelowCritical,
  severityFromBand,
  severityFromInsight,
  severityFromService,
  worstSeverity,
} from "@/lib/overview/severity-map";
import type { ServiceHealthState } from "@/lib/read/service-health";

// The canonical df Severity ramp — the ONLY values any mapper is allowed to emit
// (Pitfall 1: a blind passthrough that leaks an invalid `sev` falls through
// severityVariants to `healthy` and mis-colors incidents). Every mapper output is
// asserted to be a member of this literal set.
const DF_SEVERITY = ["critical", "warning", "watch", "healthy", "stale"] as const;

// Fixture factory — a minimal valid ServiceHealthState row. severity-map only reads
// the two-axis booleans (noData / stale / running / functioning); the timestamps and
// metadata are filler the mapper never touches.
interface ServiceOverrides {
  running?: boolean;
  functioning?: boolean;
  green?: boolean;
  stale?: boolean;
  collectorStale?: boolean;
  noData?: boolean;
}

function makeService({
  running = true,
  functioning = true,
  green,
  stale = false,
  collectorStale = false,
  noData = false,
}: ServiceOverrides = {}): ServiceHealthState {
  return {
    hostId: "host-1",
    serviceName: "svc-1",
    nodePubkey: null,
    running,
    functioning,
    green: green ?? (running && functioning),
    stale,
    collectorStale,
    noData,
    lastSuccessAt: null,
    lastArtifactMtime: null,
    collectedAt: null,
    errorCount: 0,
    expectedIntervalSeconds: null,
    detail: null,
    detectionMethod: null,
  };
}

describe("severityFromInsight (D-06)", () => {
  it("maps critical → critical", () => {
    expect(severityFromInsight("critical")).toBe("critical");
  });
  it("maps warn → warning (insight has no -ing)", () => {
    expect(severityFromInsight("warn")).toBe("warning");
  });
  it("maps info → watch (info cards are surfaced advisories, not hidden)", () => {
    expect(severityFromInsight("info")).toBe("watch");
  });
  it("every output is a member of the df Severity union", () => {
    for (const s of ["critical", "warn", "info"] as const) {
      expect(DF_SEVERITY).toContain(severityFromInsight(s));
    }
  });
});

describe("severityFromBand (D-06)", () => {
  it("maps critical → critical", () => {
    expect(severityFromBand("critical")).toBe("critical");
  });
  it("maps warn → warning (no native watch tier)", () => {
    expect(severityFromBand("warn")).toBe("warning");
  });
  it("maps healthy → healthy", () => {
    expect(severityFromBand("healthy")).toBe("healthy");
  });
  it("every output is a member of the df Severity union", () => {
    for (const b of ["healthy", "warn", "critical"] as const) {
      expect(DF_SEVERITY).toContain(severityFromBand(b));
    }
  });
});

describe("severityFromService (D-06 precedence)", () => {
  it("noData:true → stale (declared-but-silent, never a false outage)", () => {
    expect(severityFromService(makeService({ noData: true }))).toBe("stale");
  });
  it("noData wins even when running:false (precedence top)", () => {
    expect(severityFromService(makeService({ noData: true, running: false }))).toBe("stale");
  });
  it("stale:true → stale", () => {
    expect(severityFromService(makeService({ stale: true }))).toBe("stale");
  });
  it("running:false → critical", () => {
    expect(severityFromService(makeService({ running: false, functioning: false }))).toBe(
      "critical",
    );
  });
  it("functioning:false with running:true → critical (up-but-dead guard)", () => {
    expect(severityFromService(makeService({ running: true, functioning: false }))).toBe(
      "critical",
    );
  });
  it("both axes true → healthy", () => {
    expect(severityFromService(makeService({ running: true, functioning: true }))).toBe("healthy");
  });
  it("every output is a member of the df Severity union", () => {
    const rows = [
      makeService({ noData: true }),
      makeService({ stale: true }),
      makeService({ running: false }),
      makeService({ running: true, functioning: false }),
      makeService({ running: true, functioning: true }),
    ];
    for (const r of rows) {
      expect(DF_SEVERITY).toContain(severityFromService(r));
    }
  });
});

describe("worstSeverity (D-02 worst-child + D-08 stale orthogonality)", () => {
  it("returns the worst rung among children", () => {
    expect(worstSeverity(["healthy", "warning", "watch"])).toBe("warning");
  });
  it("critical dominates warning", () => {
    expect(worstSeverity(["critical", "warning"])).toBe("critical");
  });
  it("a single healthy stays healthy", () => {
    expect(worstSeverity(["healthy"])).toBe("healthy");
  });
  it("empty input → healthy (no children = nothing wrong)", () => {
    expect(worstSeverity([])).toBe("healthy");
  });
  it("stale never promotes a healthy parent to critical (orthogonal to the ramp)", () => {
    expect(worstSeverity(["healthy", "stale"])).toBe("healthy");
    expect(worstSeverity(["healthy", "stale"])).not.toBe("critical");
  });
  it("stale alongside a real rung does not change the worst non-stale rung", () => {
    expect(worstSeverity(["watch", "stale", "warning"])).toBe("warning");
  });
  it("all-stale collapses to healthy (no non-stale child is wrong)", () => {
    expect(worstSeverity(["stale", "stale"])).toBe("healthy");
  });
  it("every output is a member of the df Severity union", () => {
    expect(DF_SEVERITY).toContain(worstSeverity(["critical", "stale", "watch"]));
  });
});

describe("clampBelowCritical (LOCKED backlog #4 — fees are never critical)", () => {
  it("demotes critical → warning (a fee alert never pages the operator red)", () => {
    expect(clampBelowCritical("critical")).toBe("warning");
  });
  it("leaves warning unchanged", () => {
    expect(clampBelowCritical("warning")).toBe("warning");
  });
  it("leaves watch unchanged", () => {
    expect(clampBelowCritical("watch")).toBe("watch");
  });
  it("leaves healthy unchanged", () => {
    expect(clampBelowCritical("healthy")).toBe("healthy");
  });
  it("leaves stale unchanged (staleness stays orthogonal, never silently warned)", () => {
    expect(clampBelowCritical("stale")).toBe("stale");
  });
  it("every output is a member of the df Severity union", () => {
    for (const s of DF_SEVERITY) {
      expect(DF_SEVERITY).toContain(clampBelowCritical(s));
    }
  });
});
