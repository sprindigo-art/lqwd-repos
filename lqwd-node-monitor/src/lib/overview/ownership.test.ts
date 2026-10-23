import { describe, expect, it } from "vitest";
import { buildOwnershipMap, type OwnershipMap } from "@/lib/overview/ownership";
import type { ServiceHealthState } from "@/lib/read/service-health";

// Fixture factory — minimal valid ServiceHealthState shapes. buildOwnershipMap
// never validates a row; it only reads hostId + nodePubkey to route the row.
function makeService(overrides: Partial<ServiceHealthState> = {}): ServiceHealthState {
  return {
    hostId: "h1",
    serviceName: "lnd",
    nodePubkey: null,
    running: true,
    functioning: true,
    green: true,
    stale: false,
    collectorStale: false,
    noData: false,
    lastSuccessAt: null,
    lastArtifactMtime: null,
    collectedAt: null,
    errorCount: 0,
    expectedIntervalSeconds: null,
    detail: null,
    detectionMethod: null,
    ...overrides,
  };
}

const PK_A = "aa".repeat(33);
const PK_B = "bb".repeat(33);
const PK_Z = "cc".repeat(33);

describe("buildOwnershipMap — read-time containment (D-03)", () => {
  it("inverts hosts.node_pubkeys: nodesByHost forward, hostByNode reverse", () => {
    const map: OwnershipMap = buildOwnershipMap({
      hosts: [{ hostId: "h1", nodePubkeys: [PK_A, PK_B] }],
      services: [],
    });
    expect(map.nodesByHost.get("h1")).toEqual([PK_A, PK_B]);
    expect(map.hostByNode.get(PK_A)).toBe("h1");
    expect(map.hostByNode.get(PK_B)).toBe("h1");
  });

  it("treats a node present in no host as unattached — undefined, never a throw (Pitfall 6)", () => {
    const map = buildOwnershipMap({
      hosts: [{ hostId: "h1", nodePubkeys: [PK_A] }],
      services: [],
    });
    expect(map.hostByNode.get(PK_Z)).toBeUndefined();
    expect(map.nodesByHost.get("nope")).toBeUndefined();
  });

  it("routes a host-level service (nodePubkey NULL) to the host, NOT to any node list", () => {
    const svc = makeService({ hostId: "h1", serviceName: "bitcoind", nodePubkey: null });
    const map = buildOwnershipMap({
      hosts: [{ hostId: "h1", nodePubkeys: [PK_A] }],
      services: [svc],
    });
    expect(map.servicesByHost.get("h1")).toEqual([svc]);
    // host-level services live nowhere in the node-scoped index
    expect(map.servicesByNode.get(PK_A)).toBeUndefined();
    expect([...map.servicesByNode.values()].flat()).toHaveLength(0);
  });

  it("routes a node-scoped service to BOTH its host and its node", () => {
    const svc = makeService({ hostId: "h1", serviceName: "lnd", nodePubkey: PK_A });
    const map = buildOwnershipMap({
      hosts: [{ hostId: "h1", nodePubkeys: [PK_A] }],
      services: [svc],
    });
    expect(map.servicesByHost.get("h1")).toEqual([svc]);
    expect(map.servicesByNode.get(PK_A)).toEqual([svc]);
  });

  it("groups host-level and node-scoped services on the same host without dropping any", () => {
    const hostSvc = makeService({ hostId: "h1", serviceName: "bitcoind", nodePubkey: null });
    const nodeSvc = makeService({ hostId: "h1", serviceName: "lnd", nodePubkey: PK_A });
    const map = buildOwnershipMap({
      hosts: [{ hostId: "h1", nodePubkeys: [PK_A] }],
      services: [hostSvc, nodeSvc],
    });
    expect(map.servicesByHost.get("h1")).toEqual([hostSvc, nodeSvc]);
    expect(map.servicesByNode.get(PK_A)).toEqual([nodeSvc]);
  });

  it("does not throw on an empty node_pubkeys array or a missing array", () => {
    expect(() =>
      buildOwnershipMap({
        hosts: [
          { hostId: "h1", nodePubkeys: [] },
          { hostId: "h2", nodePubkeys: undefined as unknown as string[] },
        ],
        services: [],
      }),
    ).not.toThrow();
    const map = buildOwnershipMap({
      hosts: [{ hostId: "h1", nodePubkeys: [] }],
      services: [],
    });
    expect(map.nodesByHost.get("h1")).toEqual([]);
  });

  it("never mutates the input arrays", () => {
    const hosts = [{ hostId: "h1", nodePubkeys: [PK_A, PK_B] }];
    const services = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const hostsSnapshot = JSON.stringify(hosts);
    const servicesSnapshot = JSON.stringify(services);
    buildOwnershipMap({ hosts, services });
    expect(JSON.stringify(hosts)).toBe(hostsSnapshot);
    expect(JSON.stringify(services)).toBe(servicesSnapshot);
    // the stored node array is a copy, not the source reference
    const map = buildOwnershipMap({ hosts, services });
    expect(map.nodesByHost.get("h1")).not.toBe(hosts[0].nodePubkeys);
  });
});
