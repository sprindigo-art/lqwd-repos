// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// node-services.ts — pubkey→hostId + node/infra service attribution (RESEARCH Drift 3)
// =====================================================
// `getServiceHealth(hostId)` is HOST-keyed, but Node Detail routes by pubkey
// (RESEARCH Drift 3 / Pitfall 3). Feeding a pubkey where a hostId is wanted
// renders an EMPTY grid on every node. This resolver makes the inversion explicit
// and reuses the shipped ownership.ts containment map — it NEVER passes the pubkey
// into a host-keyed read.
//
// It is pure over already-loaded reads (the route in Plan 07/08 supplies the
// `services` from getServiceHealth per host). Given a pubkey it:
//   1. synthesizes the hosts { hostId, nodePubkeys } input from the service
//      (hostId, nodePubkey) pairs — exactly as incidents.ts does (no separate
//      hosts read required);
//   2. builds the ownership map and derives hostId = hostByNode.get(pubkey);
//   3. partitions the host's services into the node-scoped LQWD set
//      (servicesByNode.get(pubkey)) and the host-level INFRA set (nodePubkey null
//      services on the host — bitcoind/esplora/postgres).
//
// An unattached pubkey (hostByNode undefined) returns an honest empty result —
// never a throw (ownership.ts invariant / Pitfall 6).

import { buildOwnershipMap } from "@/lib/overview/ownership";
import type { ServiceHealthState } from "@/lib/read/service-health";

/** Node-scoped LQWD services + host-level infra services for one node pubkey. */
export interface ResolvedNodeServices {
  /** The owning host_id — undefined when the pubkey is unattached to any host. */
  hostId: string | undefined;
  /** Node-scoped LQWD services (nodePubkey === pubkey). Empty when unattached. */
  lqwdServices: ServiceHealthState[];
  /** Host-level infra services (nodePubkey === null) on the owning host. */
  infraServices: ServiceHealthState[];
}

/**
 * Resolve a node pubkey to its host + attributed services. Pure/DB-free: the
 * caller supplies the already-loaded `services`. Derives hostId FIRST (never keys
 * attribution off the raw pubkey), then partitions node-scoped LQWD services from
 * host-level infra. Unattached pubkey → honest empty, never a throw.
 */
export function resolveNodeServices(input: {
  pubkey: string;
  services: ServiceHealthState[];
}): ResolvedNodeServices {
  const { pubkey, services } = input;

  // Synthesize the host→node edge from the service (hostId, nodePubkey) pairs
  // (mirror incidents.ts) — no separate hosts read is required.
  const nodePubkeysByHost = new Map<string, Set<string>>();
  for (const s of services) {
    if (s.nodePubkey !== null) {
      const set = nodePubkeysByHost.get(s.hostId) ?? new Set<string>();
      set.add(s.nodePubkey);
      nodePubkeysByHost.set(s.hostId, set);
    }
  }

  const ownership = buildOwnershipMap({
    hosts: [...nodePubkeysByHost.entries()].map(([hostId, pubkeys]) => ({
      hostId,
      nodePubkeys: [...pubkeys],
    })),
    services,
  });

  // Derive hostId FIRST — the Drift 3 guard. Unattached ⇒ undefined ⇒ honest empty.
  const hostId = ownership.hostByNode.get(pubkey);
  if (hostId === undefined) {
    return { hostId: undefined, lqwdServices: [], infraServices: [] };
  }

  // Node-scoped LQWD services (attribution filters by nodePubkey via ownership).
  const lqwdServices = ownership.servicesByNode.get(pubkey) ?? [];

  // Host-level infra services: everything on the host with a NULL pubkey — kept
  // SEPARATE from the node-scoped set so the two grid sections never overlap.
  const infraServices = (ownership.servicesByHost.get(hostId) ?? []).filter(
    (s) => s.nodePubkey === null,
  );

  return { hostId, lqwdServices, infraServices };
}
