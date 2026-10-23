import { describe, expect, it } from "vitest";

import { resolveNodeServices } from "@/lib/read/node-services";
import type { ServiceHealthState } from "@/lib/read/service-health";

// =====================================================
// node-services.test.ts — locks pubkey→hostId + service attribution (RESEARCH Drift 3)
// =====================================================
// Pure-module discipline: every input is a hand-built fixture; no DB, no fetch.
// The load-bearing contract: getServiceHealth(hostId) is HOST-keyed but Node
// Detail routes by pubkey — feeding a pubkey where a hostId is wanted renders an
// empty grid on every node (RESEARCH Pitfall 3). resolveNodeServices does the
// explicit inversion (reusing ownership.ts) and partitions node-scoped LQWD
// services from host-level infra services.

const PK = (tag: string): string => tag.repeat(66).slice(0, 66);
const PK_A = PK("a");
const PK_B = PK("b");

// Minimal valid ServiceHealthState fixture — the resolver only reads hostId +
// nodePubkey for attribution; the rest are carried through untouched.
function svc(over: {
  hostId: string;
  serviceName: string;
  nodePubkey: string | null;
  running?: boolean;
  functioning?: boolean;
}): ServiceHealthState {
  return {
    hostId: over.hostId,
    serviceName: over.serviceName,
    nodePubkey: over.nodePubkey,
    running: over.running ?? true,
    functioning: over.functioning ?? true,
    green: (over.running ?? true) && (over.functioning ?? true),
    stale: false,
    collectorStale: false,
    noData: false,
    lastSuccessAt: null,
    lastArtifactMtime: null,
    collectedAt: new Date("2026-07-08T00:00:00Z"),
    errorCount: 0,
    expectedIntervalSeconds: null,
    detail: null,
    detectionMethod: null,
  };
}

describe("resolveNodeServices", () => {
  // A host running one node (PK_A) with node-scoped LQWD services + host-level infra.
  const services: ServiceHealthState[] = [
    svc({ hostId: "host-1", serviceName: "bitcoind", nodePubkey: null }),
    svc({ hostId: "host-1", serviceName: "esplora", nodePubkey: null }),
    svc({ hostId: "host-1", serviceName: "aiLiquidityManager", nodePubkey: PK_A }),
    svc({ hostId: "host-1", serviceName: "nodeAuditor", nodePubkey: PK_A }),
    // sibling node on the SAME host — must NOT leak into PK_A's node-scoped set.
    svc({ hostId: "host-1", serviceName: "internalRebalancer", nodePubkey: PK_B }),
  ];

  it("returns the node-scoped LQWD services for a pubkey attached to a host", () => {
    const result = resolveNodeServices({ pubkey: PK_A, services });
    expect(result.hostId).toBe("host-1");
    const names = result.lqwdServices.map((s) => s.serviceName).sort();
    expect(names).toEqual(["aiLiquidityManager", "nodeAuditor"]);
  });

  it("returns the host's infra services separated from the node-scoped LQWD set", () => {
    const result = resolveNodeServices({ pubkey: PK_A, services });
    const infra = result.infraServices.map((s) => s.serviceName).sort();
    expect(infra).toEqual(["bitcoind", "esplora"]);
    // infra and lqwd sets are disjoint — a node-scoped service never appears as infra.
    const lqwd = result.lqwdServices.map((s) => s.serviceName);
    for (const name of infra) expect(lqwd).not.toContain(name);
  });

  it("returns an honest empty result for an unattached pubkey (never throws)", () => {
    const unattached = PK("c");
    const result = resolveNodeServices({ pubkey: unattached, services });
    expect(result.hostId).toBeUndefined();
    expect(result.lqwdServices).toEqual([]);
    expect(result.infraServices).toEqual([]);
  });

  it("does not leak sibling-node services into the node-scoped set (filters by nodePubkey)", () => {
    const result = resolveNodeServices({ pubkey: PK_A, services });
    const names = result.lqwdServices.map((s) => s.serviceName);
    // internalRebalancer belongs to PK_B, not PK_A.
    expect(names).not.toContain("internalRebalancer");
  });

  it("derives hostId first — never keys service attribution off the raw pubkey", () => {
    // Regression guard for Drift 3: passing the pubkey where a hostId is wanted
    // would return no infra services (no host row keyed by a pubkey). A correct
    // resolver derives host-1 from PK_A first, so infra services resolve.
    const result = resolveNodeServices({ pubkey: PK_A, services });
    expect(result.infraServices.length).toBeGreaterThan(0);
    expect(result.hostId).not.toBe(PK_A);
  });
});
