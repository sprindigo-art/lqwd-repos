// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// ownership.ts — read-time host→service→node containment map (D-01/D-03)
// =====================================================
// The host dimension is the spine of root-cause grouping. This helper produces
// the parent↔child edges the Wave-2 incident roll-up (incidents.ts) consumes to
// fold child alerts up to their owning host. There is NO stored graph (D-03):
// the map is assembled in memory each read from columns that already exist —
//   • hosts.node_pubkeys          → the ONLY host→node edge
//   • service-health rows carry    their own hostId + nodePubkey
// so it can never drift from source (T-12-OWN-02). Channels are deliberately NOT
// attached here — they attach lazily per node only when an incident needs
// blast-radius (RESEARCH), keeping the top-level map cheap.
//
// Honesty invariants (locked by ownership.test.ts BEFORE any consumer):
//  - hostByNode inverts node_pubkeys: every declared node maps to exactly one host.
//  - A node in no host returns undefined from hostByNode — the caller treats it
//    as unattached; grouping degrades, never throws (Pitfall 6 / T-12-OWN-01).
//  - A host-level service (nodePubkey NULL) rolls up to its host and is ABSENT
//    from every node-scoped list — it is not silently dropped or mis-attributed.
//  - A node-scoped service appears in BOTH its host list and its node list.
//  - `node_pubkeys ?? []` guards the array column even though postgres-js returns
//    a real array — malformed fleet data degrades, never crashes (T-12-OWN-01).

import type { ServiceHealthState } from "@/lib/read/service-health";

/** Read-time parent↔child edges over the existing host/service columns (D-03). */
export interface OwnershipMap {
  /** host_id → declared node pubkeys (a copy of node_pubkeys, never the source ref). */
  nodesByHost: Map<string, string[]>;
  /** node pubkey → host_id — the inversion; absent key = unattached node. */
  hostByNode: Map<string, string>;
  /** host_id → every service on the host (host-level AND node-scoped). */
  servicesByHost: Map<string, ServiceHealthState[]>;
  /** node pubkey → node-scoped services only (host-level services excluded). */
  servicesByNode: Map<string, ServiceHealthState[]>;
}

/**
 * Build the full containment map in a single pass per input array (no sort —
 * group/partition only, mirroring triage.ts). Inputs are never mutated: the
 * stored node arrays are fresh copies.
 */
export function buildOwnershipMap(inputs: {
  hosts: { hostId: string; nodePubkeys: string[] }[];
  services: ServiceHealthState[];
}): OwnershipMap {
  const nodesByHost = new Map<string, string[]>();
  const hostByNode = new Map<string, string>();
  const servicesByHost = new Map<string, ServiceHealthState[]>();
  const servicesByNode = new Map<string, ServiceHealthState[]>();

  for (const host of inputs.hosts) {
    // Guard the array column; copy so the map never aliases the source row.
    const pubkeys = [...(host.nodePubkeys ?? [])];
    nodesByHost.set(host.hostId, pubkeys);
    for (const pubkey of pubkeys) {
      hostByNode.set(pubkey, host.hostId);
    }
  }

  for (const service of inputs.services) {
    // Every service rolls up to its host.
    const byHost = servicesByHost.get(service.hostId) ?? [];
    byHost.push(service);
    servicesByHost.set(service.hostId, byHost);
    // Node-scoped services (non-null pubkey) ALSO index under their node.
    if (service.nodePubkey !== null) {
      const byNode = servicesByNode.get(service.nodePubkey) ?? [];
      byNode.push(service);
      servicesByNode.set(service.nodePubkey, byNode);
    }
  }

  return { nodesByHost, hostByNode, servicesByHost, servicesByNode };
}
