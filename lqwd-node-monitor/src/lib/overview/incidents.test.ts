import { describe, expect, it } from "vitest";
import { assembleIncidents, type GroupedIncident } from "@/lib/overview/incidents";
import type { InsightCard } from "@/lib/insight/types";
import type { ServiceHealthState } from "@/lib/read/service-health";
import type { HostMetricsView } from "@/lib/read/host-metrics";
import type { ChainTelemetryView } from "@/lib/read/chain-telemetry";
import type { ScorecardView } from "@/lib/scorecard/types";

// =====================================================
// incidents.test.ts — locks the cross-layer assembler (D-01/D-02/D-08) BEFORE impl.
// =====================================================
// Pure-module discipline: every input is a hand-built fixture; no DB, no fetch.
// The behaviors proven here ARE the contract the page + Wave-3 (ai-band/filter)
// build against — host roll-up, worst-child severity, stale orthogonality, the
// unattached-node fallback, the all-clear empty queue, and engine-order
// preservation (no second sort over the ranked input).

const PK = (tag: string): string => tag.repeat(66).slice(0, 66);
const PK_A = PK("a");
const PK_B = PK("b");
const PK_C = PK("c");
const PK_Z = PK("z");

// ── Fixture factories (minimal valid shapes; the assembler only reads the
//    fields the mappers consume — it never validates). ────────────────────────

function makeCard(over: {
  id: string;
  severity: InsightCard["severity"];
  pubkey: string | null;
  signal?: string;
}): InsightCard {
  const pubkey = over.pubkey;
  return {
    schemaVersion: 1,
    id: over.id,
    severity: over.severity,
    node: pubkey === null ? null : { pubkey, alias: `alias-${over.id}`, backend: "lnd" },
    target: { kind: pubkey === null ? "fleet" : "node" },
    // Default is a NON-fee signal so the generic-leaf cases below exercise the
    // ordinary leaf path; fee grouping is covered explicitly via makeFeeCard.
    signal: (over.signal ?? "channel_close_candidate") as InsightCard["signal"],
    evidence: {
      metric: "test",
      observed: 10,
      threshold: 30,
      unit: "ppm",
      window: "7d",
      asOf: "2026-06-30T00:00:00.000Z",
      deepLink: "/x",
    },
    suggestedAction: null,
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  } as InsightCard;
}

// Fee-card factory — mirrors makeCard but pins a fee signal + unique id so a node
// can carry several fee_raise/fee_lower cards (the per-channel noise this plan groups).
let feeCardSeq = 0;
function makeFeeCard(
  signal: "fee_raise" | "fee_lower",
  pubkey: string | null,
  severity: InsightCard["severity"] = "warn",
): InsightCard {
  feeCardSeq += 1;
  return makeCard({ id: `fee-${signal}-${feeCardSeq}`, severity, pubkey, signal });
}

function makeService(over: {
  hostId: string;
  nodePubkey: string | null;
  serviceName?: string;
  running?: boolean;
  functioning?: boolean;
  stale?: boolean;
  noData?: boolean;
}): ServiceHealthState {
  const running = over.running ?? true;
  const functioning = over.functioning ?? true;
  return {
    hostId: over.hostId,
    serviceName: over.serviceName ?? `svc-${over.hostId}-${over.nodePubkey ?? "host"}`,
    nodePubkey: over.nodePubkey,
    running,
    functioning,
    green: running && functioning,
    stale: over.stale ?? false,
    collectorStale: false,
    noData: over.noData ?? false,
    lastSuccessAt: null,
    lastArtifactMtime: null,
    collectedAt: new Date("2026-06-30T00:00:00.000Z"),
    errorCount: 0,
    expectedIntervalSeconds: 3600,
    detail: null,
    detectionMethod: null,
  };
}

function makeHost(over: { hostId: string; stale?: boolean; hasData?: boolean }): HostMetricsView {
  return {
    hostId: over.hostId,
    hostname: over.hostId,
    collectedAt: new Date("2026-06-30T00:00:00.000Z"),
    stale: over.stale ?? false,
    hasData: over.hasData ?? true,
    metrics: null,
    storage: [],
  };
}

function makeChain(over: {
  hostId: string;
  band?: "healthy" | "warn" | "critical";
  stale?: boolean;
}): ChainTelemetryView {
  const band = over.band ?? "healthy";
  return {
    hostId: over.hostId,
    hostname: over.hostId,
    collectedAt: new Date("2026-06-30T00:00:00.000Z"),
    stale: over.stale ?? false,
    hasData: true,
    ibd: false,
    blocksBehind: 0,
    chain: null,
    bands: {
      blocksBehind: { value: 0, band },
      verificationProgress: null,
      peers: null,
    },
  };
}

function makeNode(over: {
  pubkey: string;
  dot?: "ok" | "warn" | "critical";
  stale?: boolean;
}): ScorecardView {
  return {
    pubkey: over.pubkey,
    alias: `alias-${over.pubkey.slice(0, 4)}`,
    backend: "lnd",
    compositePct: null,
    compositeLetter: null,
    dot: over.dot ?? "ok",
    reason: null,
    criticalChips: [],
    dimensions: [],
    asOf: new Date("2026-06-30T00:00:00.000Z"),
    stale: over.stale ?? false,
  };
}

const EMPTY = { rankedCards: [], hosts: [], chain: [], services: [], nodes: [] };

describe("assembleIncidents (D-01/D-02/D-08)", () => {
  it("rolls a host's services + on-host node alerts into ONE incident keyed by the host (D-01)", () => {
    // Ownership: pkA, pkB are declared on h1 via their (healthy) node-scoped services.
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: PK_A }),
      makeService({ hostId: "h1", nodePubkey: PK_B }),
      makeService({ hostId: "h1", nodePubkey: null, serviceName: "bitcoind", running: false }),
    ];
    const rankedCards = [
      makeCard({ id: "cardA", severity: "warn", pubkey: PK_A }),
      makeCard({ id: "cardB", severity: "critical", pubkey: PK_B }),
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    const incident = result[0];
    expect(incident.key).toBe("h1");
    // children carry both node alerts + the down service; node alerts are NOT top-level.
    const childKeys = incident.children.map((c) => c.key);
    expect(childKeys).toContain("cardA");
    expect(childKeys).toContain("cardB");
    expect(incident.children.some((c) => c.layer === "services")).toBe(true);
    // node alerts absent from the top level (collapsed under the host).
    expect(result.map((i) => i.key)).not.toContain("cardA");
    expect(result.map((i) => i.key)).not.toContain("cardB");
  });

  it("sets incident severity to the worst child on the ramp (D-02): [warning, critical, watch] -> critical", () => {
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: PK_A }),
      makeService({ hostId: "h1", nodePubkey: PK_B }),
      makeService({ hostId: "h1", nodePubkey: PK_C }),
    ];
    const rankedCards = [
      makeCard({ id: "w", severity: "warn", pubkey: PK_A }), // warn -> warning
      makeCard({ id: "c", severity: "critical", pubkey: PK_B }), // critical
      makeCard({ id: "i", severity: "info", pubkey: PK_C }), // info -> watch
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("critical");
  });

  it("keeps stale orthogonal: a stale/no-data child never promotes the parent; severity is the worst non-stale rung (D-08)", () => {
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: PK_A }), // ownership for the warn card
      // host-level no-data service -> normalizes to `stale`
      makeService({ hostId: "h1", nodePubkey: null, serviceName: "batch", noData: true }),
    ];
    const rankedCards = [makeCard({ id: "warnCard", severity: "warn", pubkey: PK_A })];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    const incident = result[0];
    // worst NON-stale child is the warning card — the stale child does NOT raise it to critical.
    expect(incident.severity).toBe("warning");
    // staleness is surfaced honestly via a separate flag.
    expect(incident.stale).toBe(true);
  });

  it("nests an unattached node alert under the SINGLE 'Unattributed' bucket — no crash, never a bare top-level row (Pitfall 6 / D-R3)", () => {
    // PK_Z is in no host (no service ties it) -> hostByNode miss.
    const rankedCards = [makeCard({ id: "lonely", severity: "critical", pubkey: PK_Z })];
    const result = assembleIncidents({ ...EMPTY, rankedCards });

    expect(result).toHaveLength(1);
    const bucket = result[0];
    expect(bucket.key).toBe("unattributed");
    expect(bucket.entityLabel).toBe("Unattributed");
    // the orphan alert nests UNDER the bucket, never as a bare top-level incident.
    const lonely = bucket.children.find((c) => c.key === "lonely");
    expect(lonely).toBeDefined();
    expect(lonely!.layer).toBe("nodes");
    expect(lonely!.severity).toBe("critical");
    expect(result.map((i) => i.key)).not.toContain("lonely");
    // bucket rolls up its worst child + carries an honest, labeled why.
    expect(bucket.severity).toBe("critical");
    expect(bucket.why).toContain("unattributed");
  });

  it("returns an empty top-level queue when nothing is alerting (all healthy/fresh) — the OVW-04 all-clear path", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const result = assembleIncidents({
      rankedCards: [],
      hosts: [makeHost({ hostId: "h1" })],
      chain: [makeChain({ hostId: "h1", band: "healthy" })],
      services,
      nodes: [makeNode({ pubkey: PK_A, dot: "ok" })],
    });

    expect(result).toEqual([]);
  });

  it("never re-sorts: order follows the engine-ranked input, even when severities would reorder under a sort (Pitfall 3)", () => {
    // Two UNATTACHED node alerts -> both nest in the SINGLE Unattributed bucket, in
    // input order. Input order is [warn, critical]; a naive severity sort would flip them.
    const rankedCards = [
      makeCard({ id: "first", severity: "warn", pubkey: PK_Z }),
      makeCard({ id: "second", severity: "critical", pubkey: PK("y") }),
    ];
    const result = assembleIncidents({ ...EMPTY, rankedCards });

    const bucket = result.find((i: GroupedIncident) => i.key === "unattributed");
    expect(bucket).toBeDefined();
    expect(bucket!.children.map((c) => c.key)).toEqual(["first", "second"]);
  });

  it("dedups a service present as both a host-level and a node-scoped row into ONE child (D-R3), keeping the worst severity + most specific reason", () => {
    // Same (hostId, serviceName) twice: host-level row is stale (no data); the
    // node-scoped duplicate is critically not-running (the worst, most specific row).
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: null, serviceName: "addressBalances", noData: true }),
      makeService({ hostId: "h1", nodePubkey: PK_A, serviceName: "addressBalances", running: false }),
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services });

    expect(result).toHaveLength(1);
    const host = result[0];
    expect(host.key).toBe("h1");
    // EXACTLY ONE child for addressBalances — no repeated "Address List Sync" label.
    const serviceChildren = host.children.filter((c) => c.layer === "services");
    expect(serviceChildren).toHaveLength(1);
    // worst severity survives the collapse (critical beats stale), most specific reason kept.
    expect(serviceChildren[0].severity).toBe("critical");
    expect(serviceChildren[0].why).toBe("not running");
    // label is the humanized display label (12-10), shown once.
    expect(serviceChildren[0].entityLabel).toBe("Address List Sync");
  });

  it("routes EVERY orphan into the SAME single bucket, appended AFTER real owners, engine order preserved within it (D-R3)", () => {
    // One real host owner (h1) + two orphan node alerts (no host).
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A, running: false })];
    const rankedCards = [
      makeCard({ id: "orphan-1", severity: "warn", pubkey: PK_Z }),
      makeCard({ id: "orphan-2", severity: "critical", pubkey: PK("y") }),
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    // Exactly ONE Unattributed bucket, and it is the LAST top-level incident (after real owners).
    const buckets = result.filter((i) => i.key === "unattributed");
    expect(buckets).toHaveLength(1);
    expect(result[result.length - 1].key).toBe("unattributed");
    expect(result.some((i) => i.key === "h1")).toBe(true);
    // Engine order preserved inside the bucket.
    expect(buckets[0].children.map((c) => c.key)).toEqual(["orphan-1", "orphan-2"]);
  });

  it("retains each surviving child's own layer so the tree filter can read it (D-R3)", () => {
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: PK_A }), // ownership for the node alert
      makeService({ hostId: "h1", nodePubkey: null, serviceName: "bitcoind", running: false }), // services layer
    ];
    const rankedCards = [makeCard({ id: "nodeAlert", severity: "critical", pubkey: PK_A })]; // nodes layer
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    const layers = result[0].children.map((c) => c.layer);
    expect(layers).toContain("services");
    expect(layers).toContain("nodes");
  });
});

describe("assembleIncidents — per-node fee grouping (LOCKED backlog #4)", () => {
  it("collapses a node's fee cards into AT MOST two counted summary children (raise + lower) with ZERO per-channel fee rows", () => {
    // Three fee_raise + one fee_lower for a node OWNED by h1 -> two summaries nest under h1.
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [
      makeFeeCard("fee_raise", PK_A),
      makeFeeCard("fee_raise", PK_A),
      makeFeeCard("fee_raise", PK_A),
      makeFeeCard("fee_lower", PK_A),
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    // One owner card; exactly two fee summaries — one raise, one lower — nested under it.
    expect(result).toHaveLength(1);
    const host = result[0];
    const feeChildren = host.children.filter((c) => c.feeKind !== undefined);
    expect(feeChildren).toHaveLength(2);
    const raise = feeChildren.find((c) => c.feeKind === "raise");
    const lower = feeChildren.find((c) => c.feeKind === "lower");
    expect(raise).toBeDefined();
    expect(lower).toBeDefined();
    expect(raise!.count).toBe(3);
    expect(lower!.count).toBe(1);

    // NOT ONE per-channel fee leaf leaked through — no incident carries a raw fee card id.
    const feeCardIds = rankedCards.map((c) => c.id);
    const everyKey = [host.key, ...host.children.map((c) => c.key)];
    for (const id of feeCardIds) {
      expect(everyKey).not.toContain(id);
    }
    // Summaries are leaves themselves (no per-channel children hang off them).
    expect(raise!.children).toEqual([]);
    expect(lower!.children).toEqual([]);
  });

  it("clamps a fee summary below critical: an upstream-critical fee card still summarises as warning (never critical)", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [makeFeeCard("fee_raise", PK_A, "critical")];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    const fee = result[0].children.find((c) => c.feeKind === "raise");
    expect(fee).toBeDefined();
    expect(fee!.severity).toBe("warning");
    expect(fee!.severity).not.toBe("critical");
  });

  it("routes each fee summary to that node's fees tab: href === /{pubkey}/fees", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [makeFeeCard("fee_raise", PK_A), makeFeeCard("fee_lower", PK_A)];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    const feeChildren = result[0].children.filter((c) => c.feeKind !== undefined);
    expect(feeChildren).toHaveLength(2);
    for (const fee of feeChildren) {
      expect(fee.href).toBe(`/${PK_A}/fees`);
    }
  });

  it("nests an unattributed node's fee summaries under the Unattributed bucket rather than floating (D-R3)", () => {
    // PK_Z has no owning host -> its fee summary buckets, never a bare top-level row.
    const rankedCards = [makeFeeCard("fee_raise", PK_Z)];
    const result = assembleIncidents({ ...EMPTY, rankedCards });

    expect(result).toHaveLength(1);
    const bucket = result[0];
    expect(bucket.key).toBe("unattributed");
    const fee = bucket.children.find((c) => c.feeKind === "raise");
    expect(fee).toBeDefined();
    expect(fee!.count).toBe(1);
  });

  it("leaves non-fee cards untouched — they still become normal leaves in engine order (no grouping, no sort)", () => {
    // A close-candidate (fee-signals detector output, but NOT a fee alert) + a fee_raise,
    // both on nodes owned by h1 -> one owner card carrying the leaf + the fee summary.
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: PK_A }),
      makeService({ hostId: "h1", nodePubkey: PK_B }),
    ];
    const rankedCards = [
      makeCard({ id: "closer", severity: "critical", pubkey: PK_B, signal: "channel_close_candidate" }),
      makeFeeCard("fee_raise", PK_A),
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    const host = result[0];
    // The close-candidate is a normal leaf keyed by its card id, unchanged.
    const closer = host.children.find((c) => c.key === "closer");
    expect(closer).toBeDefined();
    expect(closer!.layer).toBe("nodes");
    expect(closer!.severity).toBe("critical");
    expect(closer!.feeKind).toBeUndefined();
    expect(closer!.count).toBeUndefined();
    // Engine order preserved: the non-fee leaf (walked in-loop) precedes the fee summary (emitted after).
    expect(host.children.map((c) => c.key)).toEqual(["closer", `fee:raise:${PK_A}`]);
  });
});

describe("assembleIncidents — stale-source demotion (quick 260721-gqi #1, funds-safety)", () => {
  it("Test A: a stale-source insight critical demotes — child severity VALUE is 'stale' and the parent is NOT critical", () => {
    // PK_A is a STALE scorecard node (7-day residue). Its insight `critical` must
    // demote via the staleness lever: the child's severity VALUE becomes "stale".
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [makeCard({ id: "staleCrit", severity: "critical", pubkey: PK_A })];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "h1" })],
      services,
      rankedCards,
      nodes: [makeNode({ pubkey: PK_A, stale: true })],
    });

    expect(result).toHaveLength(1);
    const incident = result[0];
    const child = incident.children.find((c) => c.key === "staleCrit");
    expect(child).toBeDefined();
    // The severity VALUE (not just the flag) is demoted — this is what worstSeverity filters.
    expect(child!.severity).toBe("stale");
    expect(child!.stale).toBe(true);
    // The parent host does NOT read a live critical from week-old residue.
    expect(incident.severity).not.toBe("critical");
    expect(incident.stale).toBe(true);
  });

  it("Test B: a FRESH-source insight critical KEEPS 'critical' and STILL promotes the parent (no-mask funds-safety guarantee)", () => {
    // PK_A is FRESH. A genuine funds-at-risk critical MUST stay critical — the demotion
    // keys ONLY on staleNodes membership, never on the severity value.
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [makeCard({ id: "freshCrit", severity: "critical", pubkey: PK_A })];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "h1" })],
      services,
      rankedCards,
      nodes: [makeNode({ pubkey: PK_A, stale: false })],
    });

    expect(result).toHaveLength(1);
    const incident = result[0];
    const child = incident.children.find((c) => c.key === "freshCrit");
    expect(child).toBeDefined();
    expect(child!.severity).toBe("critical");
    expect(child!.stale).toBe(false);
    expect(incident.severity).toBe("critical");
  });

  it("Test C: mixed host — a fresh critical keeps 'critical', a stale-source critical demotes to 'stale', parent stays critical (driven by the fresh child)", () => {
    // PK_A fresh, PK_B stale — both critical, both owned by h1. Proves demotion keys
    // ONLY on staleNodes membership, never on the severity value.
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: PK_A }),
      makeService({ hostId: "h1", nodePubkey: PK_B }),
    ];
    const rankedCards = [
      makeCard({ id: "freshCrit", severity: "critical", pubkey: PK_A }),
      makeCard({ id: "staleCrit", severity: "critical", pubkey: PK_B }),
    ];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "h1" })],
      services,
      rankedCards,
      nodes: [makeNode({ pubkey: PK_A, stale: false }), makeNode({ pubkey: PK_B, stale: true })],
    });

    expect(result).toHaveLength(1);
    const incident = result[0];
    const fresh = incident.children.find((c) => c.key === "freshCrit");
    const stale = incident.children.find((c) => c.key === "staleCrit");
    expect(fresh!.severity).toBe("critical");
    expect(fresh!.stale).toBe(false);
    expect(stale!.severity).toBe("stale");
    expect(stale!.stale).toBe(true);
    // Parent is critical — driven by the FRESH child, not masked by the stale one.
    expect(incident.severity).toBe("critical");
  });

  // O-fee (18-03): the fee-summary emission branch previously SKIPPED this
  // demotion — a week-old fee card from a stale node emitted a live `warning`
  // child with stale:false, diverging from the generic + rollup branches.
  it("Test D: a fee-summary child from a STALE node demotes to 'stale' like its sibling branches (O-fee)", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [makeFeeCard("fee_raise", PK_A, "warn")];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "h1" })],
      services,
      rankedCards,
      nodes: [makeNode({ pubkey: PK_A, stale: true })],
    });

    expect(result).toHaveLength(1);
    const incident = result[0];
    const feeChild = incident.children.find((c) => c.feeKind === "raise");
    expect(feeChild).toBeDefined();
    // Same staleness lever as the generic leaves + rollup summaries.
    expect(feeChild!.severity).toBe("stale");
    expect(feeChild!.stale).toBe(true);
    // The parent host must NOT read a live warning from stale fee residue.
    expect(incident.severity).not.toBe("warning");
    expect(incident.stale).toBe(true);
  });

  it("Test E: a fee-summary child from a FRESH node keeps its (clamped) live severity (no-mask)", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [makeFeeCard("fee_raise", PK_A, "warn")];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "h1" })],
      services,
      rankedCards,
      nodes: [makeNode({ pubkey: PK_A, stale: false })],
    });

    expect(result).toHaveLength(1);
    const feeChild = result[0].children.find((c) => c.feeKind === "raise");
    expect(feeChild!.severity).toBe("warning");
    expect(feeChild!.stale).toBe(false);
  });
});

describe("assembleIncidents — per-channel stuck/htlc rollup (quick 260721-gqi #2)", () => {
  function makeStuckCard(signal: string, pubkey: string | null, id: string): InsightCard {
    return makeCard({ id, severity: "critical", pubkey, signal });
  }

  it("Test D: 17 stuck_fc cards on ONE node collapse to a SINGLE 'N channels · STUCK FORCE-CLOSE' summary child (count === 17)", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = Array.from({ length: 17 }, (_, i) =>
      makeStuckCard("stuck_fc_past_maturity", PK_A, `stuck-${i}`),
    );
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    const host = result[0];
    const rollups = host.children.filter((c) => c.key.startsWith("rollup:"));
    expect(rollups).toHaveLength(1);
    const summary = rollups[0];
    expect(summary.count).toBe(17);
    expect(summary.why).toBe("17 channels · STUCK FORCE-CLOSE");
    expect(summary.layer).toBe("nodes");
    expect(summary.severity).toBe("critical");
    // No per-channel stuck leaf leaked through — no raw card id survives as a child key.
    const childKeys = host.children.map((c) => c.key);
    for (let i = 0; i < 17; i += 1) {
      expect(childKeys).not.toContain(`stuck-${i}`);
    }
  });

  it("Test E: different signals on the same node stay SEPARATE summary rows (never collapsed across signals)", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [
      makeStuckCard("stuck_fc_past_maturity", PK_A, "fc-1"),
      makeStuckCard("stuck_sweep", PK_A, "sweep-1"),
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    const rollups = result[0].children.filter((c) => c.key.startsWith("rollup:"));
    expect(rollups).toHaveLength(2);
    expect(rollups.map((c) => c.key)).toContain(`rollup:stuck_fc_past_maturity:${PK_A}`);
    expect(rollups.map((c) => c.key)).toContain(`rollup:stuck_sweep:${PK_A}`);
  });

  it("Test F: a single occurrence renders singular — 1 stuck_sweep → '1 channel · STUCK SWEEP'", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [makeStuckCard("stuck_sweep", PK_A, "sweep-1")];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    const summary = result[0].children.find((c) => c.key.startsWith("rollup:"));
    expect(summary).toBeDefined();
    expect(summary!.count).toBe(1);
    expect(summary!.why).toBe("1 channel · STUCK SWEEP");
  });

  it("Test G: a stale-source rollup summary demotes — severity VALUE is 'stale', stale flag true, and it does NOT promote the parent", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [
      makeStuckCard("stuck_fc_past_maturity", PK_A, "fc-1"),
      makeStuckCard("stuck_fc_past_maturity", PK_A, "fc-2"),
    ];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "h1" })],
      services,
      rankedCards,
      nodes: [makeNode({ pubkey: PK_A, stale: true })],
    });

    expect(result).toHaveLength(1);
    const incident = result[0];
    const summary = incident.children.find((c) => c.key.startsWith("rollup:"));
    expect(summary).toBeDefined();
    expect(summary!.severity).toBe("stale");
    expect(summary!.stale).toBe(true);
    expect(summary!.count).toBe(2);
    // The parent is NOT promoted to critical by week-old stuck residue.
    expect(incident.severity).not.toBe("critical");
  });

  it("leaves non-rolled signals untouched — channel_close_candidate stays a normal per-card leaf", () => {
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })];
    const rankedCards = [
      makeCard({ id: "closer", severity: "critical", pubkey: PK_A, signal: "channel_close_candidate" }),
    ];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    const host = result[0];
    const closer = host.children.find((c) => c.key === "closer");
    expect(closer).toBeDefined();
    expect(closer!.count).toBeUndefined();
    expect(host.children.some((c) => c.key.startsWith("rollup:"))).toBe(false);
  });
});

describe("assembleIncidents — host-label relabel (quick 260721-kej FIX 1)", () => {
  it("titles a service-only host by its owned-node alias (from a healthy scorecard node), never the service label", () => {
    // A single DOWN service is the host's only alert; the host OWNS PK_A (via the
    // service's nodePubkey). PK_A is healthy in the scorecard (emits no node child)
    // but carries the alias the host incident must inherit — never the service label.
    const services: ServiceHealthState[] = [
      makeService({ hostId: "h1", nodePubkey: PK_A, serviceName: "channelAcceptor", running: false }),
    ];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "h1" })],
      services,
      nodes: [makeNode({ pubkey: PK_A, dot: "ok" })],
    });

    expect(result).toHaveLength(1);
    const incident = result[0];
    const alias = `alias-${PK_A.slice(0, 4)}`;
    expect(incident.entityLabel).toBe(alias);
    expect(incident.why).toBe(`1 alert on ${alias}`);
    // The host is NOT titled by the service child's display label.
    const serviceChild = incident.children.find((c) => c.layer === "services");
    expect(serviceChild).toBeDefined();
    expect(incident.entityLabel).not.toBe(serviceChild!.entityLabel);
  });

  it("titles a service-only host that owns NO aliased node by its hostId, never the service label", () => {
    // A host-level DOWN service (nodePubkey null) → the host owns no node → the label
    // falls back to the hostId (e.g. "ip-10-0-5-202"), never the service display label.
    const services: ServiceHealthState[] = [
      makeService({
        hostId: "ip-10-0-5-202",
        nodePubkey: null,
        serviceName: "channelAcceptor",
        running: false,
      }),
    ];
    const result = assembleIncidents({
      ...EMPTY,
      hosts: [makeHost({ hostId: "ip-10-0-5-202" })],
      services,
    });

    expect(result).toHaveLength(1);
    const incident = result[0];
    expect(incident.key).toBe("ip-10-0-5-202");
    expect(incident.entityLabel).toBe("ip-10-0-5-202");
    const serviceChild = incident.children.find((c) => c.layer === "services");
    expect(serviceChild).toBeDefined();
    expect(incident.entityLabel).not.toBe(serviceChild!.entityLabel);
  });

  it("REGRESSION GUARD: a host whose child is a node insight card keeps the node-alias label unchanged", () => {
    // The existing node-child pattern (nodes:[] passing the alias via card.node.alias):
    // the resolved label MUST stay the node alias, byte-identical to today's behavior.
    const services: ServiceHealthState[] = [makeService({ hostId: "h1", nodePubkey: PK_A })]; // healthy → ownership only
    const rankedCards = [makeCard({ id: "nodeCard", severity: "critical", pubkey: PK_A })];
    const result = assembleIncidents({ ...EMPTY, hosts: [makeHost({ hostId: "h1" })], services, rankedCards });

    expect(result).toHaveLength(1);
    expect(result[0].entityLabel).toBe("alias-nodeCard");
    expect(result[0].why).toBe("1 alert on alias-nodeCard");
  });
});

describe("assembleIncidents — healthy Unattributed suppression (quick 260721-kej FIX 2)", () => {
  it("suppresses the Unattributed bucket when its rolled-up severity is healthy (all children stale)", () => {
    // PK_Z is an orphan (no owning host) sourced from a STALE scorecard node → its
    // insight critical demotes to the 'stale' VALUE, so the bucket rolls up to healthy
    // and must NOT appear in the top-level queue.
    const rankedCards = [makeCard({ id: "staleOrphan", severity: "critical", pubkey: PK_Z })];
    const result = assembleIncidents({
      ...EMPTY,
      rankedCards,
      nodes: [makeNode({ pubkey: PK_Z, stale: true })],
    });

    expect(result.map((i) => i.key)).not.toContain("unattributed");
  });

  it("still surfaces the Unattributed bucket when it holds a live critical orphan (no-mask)", () => {
    // A FRESH orphan critical rolls the bucket up to critical — it must still surface.
    const rankedCards = [makeCard({ id: "liveOrphan", severity: "critical", pubkey: PK_Z })];
    const result = assembleIncidents({ ...EMPTY, rankedCards });

    const bucket = result.find((i) => i.key === "unattributed");
    expect(bucket).toBeDefined();
    expect(bucket!.severity).toBe("critical");
  });
});
