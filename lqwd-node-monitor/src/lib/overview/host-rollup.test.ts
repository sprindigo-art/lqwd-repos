import { describe, it, expect } from "vitest";
import { buildHostRollup, type HostRollupInput } from "@/lib/overview/host-rollup";
import type { HostMetricsView, LatestHostStorageRow } from "@/lib/read/host-metrics";
import type { ServiceHealthState } from "@/lib/read/service-health";
import type { ChainTelemetryView } from "@/lib/read/chain-telemetry";
import type { StorageGrowth } from "@/lib/read/storage-growth";

// buildHostRollup is the VIEW-SIDE worst-of host severity + D-05 driver line. It
// composes ONLY the sanctioned mappers (worstSeverity / severityFromBand /
// severityFromService / evaluateBand / evaluateDaysToFull) — never an inline
// `=== "warn"` ramp — and NEVER touches the Phase-12 incident tree. These fixtures
// pin: per-contributor grading, worst-of reduction, D-05 driver precedence
// (infra → nodes → resources → storage), stale-never-promotes (D-08), healthy →
// no driver, and the %-FREE disk inversion (band receives 100 − usedPct).

// ── Fixture factories ────────────────────────────────────────────────────────

function storageRow(over: Partial<LatestHostStorageRow> = {}): LatestHostStorageRow {
  return {
    host_id: "h1",
    collected_at: new Date(),
    mount_point: "/",
    total_bytes: 100,
    used_bytes: 10, // 10% used → 90% free → healthy
    avail_bytes: 90,
    ...over,
  };
}

function host(over: Partial<HostMetricsView> = {}): HostMetricsView {
  const metrics = over.metrics ?? {
    host_id: "h1",
    collected_at: new Date(),
    cpu_pct: 10, // idle → healthy
    load_1: 0,
    load_5: 0,
    load_15: 0,
    mem_total_kb: 1000,
    mem_available_kb: 500, // 50% available → healthy
    swap_total_kb: 0,
    swap_free_kb: 0,
    uptime_seconds: 100,
    net_rx_bytes: 0,
    net_tx_bytes: 0,
  };
  return {
    hostId: "h1",
    hostname: "host-1",
    collectedAt: new Date(),
    stale: false,
    hasData: true,
    metrics,
    storage: over.storage ?? [storageRow()],
    ...over,
  };
}

function service(over: Partial<ServiceHealthState> = {}): ServiceHealthState {
  return {
    hostId: "h1",
    serviceName: "bitcoind",
    nodePubkey: null,
    running: true,
    functioning: true,
    green: true,
    stale: false,
    collectorStale: false,
    noData: false,
    lastSuccessAt: new Date(),
    lastArtifactMtime: new Date(),
    collectedAt: new Date(),
    errorCount: 0,
    expectedIntervalSeconds: null,
    detail: null,
    detectionMethod: null,
    ...over,
  };
}

function chain(over: Partial<ChainTelemetryView> = {}): ChainTelemetryView {
  return {
    hostId: "h1",
    hostname: "host-1",
    collectedAt: new Date(),
    stale: false,
    hasData: true,
    ibd: false,
    blocksBehind: 0,
    chain: null,
    bands: { blocksBehind: null, verificationProgress: null, peers: null },
    ...over,
  };
}

function growth(over: Partial<StorageGrowth> = {}): StorageGrowth {
  return {
    status: "ok",
    pctPerDay: 1,
    daysToFull: 500, // >1yr → healthy
    latestPctUsed: 10,
    ...over,
  };
}

function baseInput(over: Partial<HostRollupInput> = {}): HostRollupInput {
  return {
    host: host(),
    services: [],
    chain: null,
    nodeSeverities: [],
    storage: [],
    ...over,
  };
}

// ── Per-contributor grading ──────────────────────────────────────────────────

describe("buildHostRollup — per-contributor grading", () => {
  it("resources: a saturated CPU drives critical via the cpu band", () => {
    const out = buildHostRollup(
      baseInput({ host: host({ metrics: { ...host().metrics!, cpu_pct: 95 } }) }),
    );
    expect(out.sev).toBe("critical");
    expect(out.driver).toBe("driven by: CPU saturated");
  });

  it("infra: an up-but-dead bitcoind (running, not functioning) drives critical", () => {
    const out = buildHostRollup(
      baseInput({ services: [service({ running: true, functioning: false })] }),
    );
    expect(out.sev).toBe("critical");
    expect(out.driver).toBe("driven by: bitcoind not functioning");
  });

  it("nodes: 2 of 3 on-host nodes critical → '2 nodes critical'", () => {
    const out = buildHostRollup(
      baseInput({ nodeSeverities: ["critical", "critical", "healthy"] }),
    );
    expect(out.sev).toBe("critical");
    expect(out.driver).toBe("driven by: 2 nodes critical");
  });

  it("storage: an ok mount ~5 days to full grades critical with the humanized driver", () => {
    const out = buildHostRollup(baseInput({ storage: [growth({ daysToFull: 5 })] }));
    expect(out.sev).toBe("critical");
    expect(out.driver).toBe("driven by: disk filling — ~5 days to full");
  });

  it("infra: bitcoind far behind the chain tip drives critical via the chain bands", () => {
    const out = buildHostRollup(
      baseInput({
        chain: chain({ bands: { blocksBehind: { value: 20, band: "critical" }, verificationProgress: null, peers: null } }),
      }),
    );
    expect(out.sev).toBe("critical");
    expect(out.driver).toBe("driven by: bitcoind 20 blocks behind");
  });
});

// ── Worst-of reduction + driver precedence ───────────────────────────────────

describe("buildHostRollup — worst-of reduction (D-02) and driver precedence (D-05)", () => {
  it("reduces to the worst contributor: resources warning + 1 node critical → critical", () => {
    const out = buildHostRollup(
      baseInput({
        host: host({ metrics: { ...host().metrics!, cpu_pct: 80 } }), // warn
        nodeSeverities: ["critical"],
      }),
    );
    expect(out.sev).toBe("critical");
    // nodes precede resources → the node contributor names the driver (singular grammar).
    expect(out.driver).toBe("driven by: 1 node critical");
  });

  it("breaks a tie by precedence: infra beats nodes at equal severity (warning)", () => {
    const out = buildHostRollup(
      baseInput({
        chain: chain({ bands: { blocksBehind: { value: 3, band: "warn" }, verificationProgress: null, peers: null } }),
        nodeSeverities: ["warning"],
      }),
    );
    expect(out.sev).toBe("warning");
    expect(out.driver).toBe("driven by: bitcoind 3 blocks behind");
  });

  it("%-FREE inversion: 95% used → 5% free → disk band critical (not healthy)", () => {
    const out = buildHostRollup(
      baseInput({ host: host({ storage: [storageRow({ used_bytes: 95, avail_bytes: 5 })] }) }),
    );
    expect(out.sev).toBe("critical");
    expect(out.driver).toBe("driven by: disk space low");
  });
});

// ── Honesty invariants (D-08) ────────────────────────────────────────────────

describe("buildHostRollup — stale never promotes, healthy omits the driver", () => {
  it("all-stale infra + no other signal → healthy after the stale filter, no driver", () => {
    const out = buildHostRollup(
      baseInput({
        services: [
          service({ serviceName: "bitcoind", stale: true }),
          service({ serviceName: "esplora", stale: true }),
        ],
        chain: chain({ stale: true }),
        nodeSeverities: ["stale", "stale"],
      }),
    );
    expect(out.sev).toBe("healthy");
    expect(out.driver).toBeNull();
  });

  it("a fully healthy host reports healthy with a null driver", () => {
    const out = buildHostRollup(
      baseInput({
        services: [service()],
        nodeSeverities: ["healthy"],
        storage: [growth()],
      }),
    );
    expect(out.sev).toBe("healthy");
    expect(out.driver).toBeNull();
  });
});
