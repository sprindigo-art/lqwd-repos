// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// incidents.ts — cross-layer, root-cause-grouped incident assembler (D-01/D-02/D-08)
// =====================================================
// The data spine of the attention queue (OVW-01). It consumes the engine-ranked
// insight cards plus the per-layer telemetry views and folds them into a
// host-keyed incident tree:
//   • D-01 — a parent host's failure (or any failing thing it OWNS) collapses its
//     services + on-host nodes + node alerts into ONE incident keyed by the host;
//     those children NEST and DROP from the top level.
//   • D-02 — an incident's `severity` is the WORST child on the active ramp,
//     computed only via `worstSeverity` (no inline `=== "warn"` ramp chains).
//   • D-08 — `stale` is kept on a SEPARATE flag (OR of stale children); a stale /
//     no-data child can never promote an otherwise-healthy parent to critical.
//   • OVW-04 — when nothing is alerting the top-level queue is EMPTY, so the page
//     renders the all-clear hero.
//
// Engine-order-is-LAW (Pitfall 3, mirroring triage.ts:12-19): the ranked insight
// input is consumed in order and only PARTITIONED / GROUPED — there is NO `.sort`
// anywhere in this file. Insight-sourced incidents therefore appear first in their
// ranked order; purely-telemetry incidents are appended after. Inputs are never
// mutated; severity crosses the boundary only through the Plan-01 mappers.

import type { Severity } from "@/components/df/Severity";
import type { DetectorId, InsightCard } from "@/lib/insight/types";
import { SIGNAL_LABELS } from "@/lib/insight/labels";
import type { HostMetricsView } from "@/lib/read/host-metrics";
import type { ChainTelemetryView } from "@/lib/read/chain-telemetry";
import type { ServiceHealthState } from "@/lib/read/service-health";
import type { ScorecardView } from "@/lib/scorecard/types";
import { buildOwnershipMap } from "@/lib/overview/ownership";
import { serviceDisplay } from "@/lib/overview/service-display";
import { buildDeepLink } from "@/lib/insight/deeplink";
import {
  clampBelowCritical,
  severityFromBand,
  severityFromInsight,
  severityFromService,
  worstSeverity,
} from "@/lib/overview/severity-map";

/**
 * The ONLY two fee alerts (fee-signals detector, schema.ts:34). `channel_close_candidate`
 * is ALSO a fee-signals output but is NOT a fee alert — it is deliberately absent so it
 * stays a normal per-channel leaf (LOCKED #4 groups fee tuning noise only).
 */
const FEE_SIGNALS = new Set<string>(["fee_raise", "fee_lower"]);

/**
 * The noisy per-channel node kinds (quick 260721-gqi #2). One stuck/htlc signal is
 * emitted PER CHANNEL, so a single node can carry 17 `stuck_fc_past_maturity` cards.
 * These are intercepted BEFORE the generic leaf path (mirroring FEE_SIGNALS) and
 * collapsed to ONE count-summary child per (node, signal) — never 17 duplicate rows.
 */
const ROLLUP_SIGNALS = new Set<string>([
  "stuck_fc_past_maturity",
  "stuck_sweep",
  "stuck_open",
  "htlc_timeout_fc",
]);

/** The five overview layers an incident (or its children) can originate from. */
export type IncidentLayer = "hosts" | "services" | "bitcoind" | "nodes" | "storage";

/**
 * One node in the root-cause-grouped incident tree. A host-keyed incident wraps
 * its cross-layer children; a leaf (unattached node / fleet card) carries its own
 * severity and an empty `children`.
 */
export interface GroupedIncident {
  /** host_id (grouped), node pubkey / card id (unattached), or "fleet". */
  key: string;
  /** which layer this entity belongs to (the host group itself reports "hosts"). */
  layer: IncidentLayer;
  /** worst-child rung on critical>warning>watch>healthy (D-02) — via worstSeverity. */
  severity: Severity;
  /** SEPARATE from severity (D-08): OR of stale children; never promotes the parent. */
  stale: boolean;
  /** one-line operator reason. */
  why: string;
  /** human label for the entity (alias / hostname / pubkey). */
  entityLabel: string;
  /** worst-case freshness stamp, when known. */
  asOf: Date | null;
  /** nested child incidents (empty for a leaf). */
  children: GroupedIncident[];
  // ── Optional fee-summary fields (LOCKED backlog #4) — omitted on every non-fee
  //    leaf/host so existing consumers (filter.ts, ai-band.ts, page.tsx) stay
  //    back-compatible. Present ONLY on a per-node grouped fee summary child.
  /** number of underlying fee cards this summary collapses (per node, per kind). */
  count?: number;
  /** relative route to the node's fees tab (`/{pubkey}/fees`); omitted if non-routable. */
  href?: string;
  /** which fee direction this summary counts. */
  feeKind?: "raise" | "lower";
}

/** The already-loaded per-layer view arrays the assembler partitions (no DB here). */
export interface AssembleIncidentsInput {
  /** engine-ranked insight cards — consumed IN ORDER, never re-sorted. */
  rankedCards: InsightCard[];
  hosts: HostMetricsView[];
  chain: ChainTelemetryView[];
  services: ServiceHealthState[];
  nodes: ScorecardView[];
}

/**
 * One-line HEALTH reason for a surfaced (non-green) service — NEVER the raw
 * machine key (LOCKED backlog #9 render half). Mirrors `severityFromService`'s
 * precedence (noData → stale → !running → !functioning). A row that reaches here
 * is non-green by construction, so this always yields a distinct reason; the ""
 * fallback keeps the type total and, being empty, can never echo the label.
 */
function serviceReason(s: ServiceHealthState): string {
  if (s.noData) return "no data — declared but never reported";
  if (s.stale) return "stale — no recent successful run";
  if (!s.running) return "not running";
  if (!s.functioning) return "running but not functioning";
  return "";
}

/** Host metrics carry no band yet — they grade to stale (no-data/old) or healthy only. */
function gradeHost(h: HostMetricsView): Severity {
  if (!h.hasData || h.stale) return "stale";
  return "healthy";
}

/** bitcoind: stale dominates; otherwise the worst of the present chain bands. */
function gradeChain(c: ChainTelemetryView): Severity {
  if (c.stale || !c.hasData) return "stale";
  const bands = [c.bands.blocksBehind, c.bands.verificationProgress, c.bands.peers]
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .map((b) => severityFromBand(b.band));
  return worstSeverity(bands);
}

/** scorecard node: stale dominates; otherwise dot → ramp (D-07 critical iff Tier-1). */
function gradeNode(n: ScorecardView): Severity {
  if (n.stale) return "stale";
  switch (n.dot) {
    case "critical":
      return "critical";
    case "warn":
      return "warning";
    case "ok":
      return "healthy";
  }
}

/**
 * Assemble the cross-layer incident tree. Steps:
 *   1. Derive host→node ownership from the services (each carries hostId+nodePubkey),
 *      then build the containment map (D-01/D-03 via buildOwnershipMap).
 *   2. Walk the RANKED cards first (preserving engine order), then the telemetry
 *      layers; skip anything that normalizes to `healthy` and is not stale.
 *   3. Each surfaced entity becomes a leaf child; if it has an owning host it nests
 *      under that host's ONE incident (created at first encounter, in order), else
 *      it floats as its own top-level incident (unattached node / fleet — Pitfall 6).
 *   4. Roll each host incident up: severity = worstSeverity(children) (D-02),
 *      stale = any stale child (D-08).
 */
export function assembleIncidents(input: AssembleIncidentsInput): GroupedIncident[] {
  const { rankedCards, hosts, chain, services, nodes } = input;

  // (1) Host→node ownership. The only host→node edge available from these inputs
  // is the services' (hostId, nodePubkey) pairs — derive it without mutating input.
  const nodePubkeysByHost = new Map<string, Set<string>>();
  for (const s of services) {
    if (s.nodePubkey !== null) {
      const set = nodePubkeysByHost.get(s.hostId) ?? new Set<string>();
      set.add(s.nodePubkey);
      nodePubkeysByHost.set(s.hostId, set);
    }
  }
  const ownership = buildOwnershipMap({
    hosts: hosts.map((h) => ({
      hostId: h.hostId,
      nodePubkeys: [...(nodePubkeysByHost.get(h.hostId) ?? [])],
    })),
    services,
  });

  // Stale-source demotion set (quick 260721-gqi #1, funds-safety lever). Pubkeys of
  // scorecard nodes whose data is stale. An insight signal SOURCED FROM a stale node
  // is demoted via the STALENESS lever — its severity VALUE becomes "stale" (mirroring
  // the flag⟺value coupling in gradeNode/severityFromService), so worstSeverity
  // (severity-map.ts:101) filters it and the parent host reads stale, not a week-old
  // live critical. Keys ONLY on staleNodes membership, NEVER on the severity value — a
  // FRESH stuck-force-close keeps its `critical` VALUE and still promotes the parent
  // (no-mask guarantee).
  const staleNodes = new Set<string>();
  for (const n of nodes) {
    if (n.stale) staleNodes.add(n.pubkey);
  }

  // (FIX 1 — quick 260721-kej) Host-label source: pubkey → node alias, from BOTH the
  // scorecard nodes AND the ranked insight cards. The dual source is REQUIRED so a
  // host whose only alert is a SERVICE still titles by its owned-node alias, while the
  // existing node-child hosts (which pass their alias via card.node.alias, often with
  // nodes:[]) resolve to the SAME alias — no regression. First-seen non-null wins;
  // both sources yield the same alias in practice. No input mutation.
  const aliasByPubkey = new Map<string, string>();
  for (const n of nodes) {
    if (n.alias !== null && !aliasByPubkey.has(n.pubkey)) {
      aliasByPubkey.set(n.pubkey, n.alias);
    }
  }
  for (const card of rankedCards) {
    const pubkey = card.node?.pubkey ?? null;
    const alias = card.node?.alias ?? null;
    if (pubkey !== null && alias !== null && !aliasByPubkey.has(pubkey)) {
      aliasByPubkey.set(pubkey, alias);
    }
  }

  // Top-level incidents in INSERTION order (engine order for insight-sourced ones).
  const topLevel: GroupedIncident[] = [];
  const hostIncidentByKey = new Map<string, GroupedIncident>();

  function ensureHostIncident(hostId: string, label: string): GroupedIncident {
    const existing = hostIncidentByKey.get(hostId);
    if (existing) return existing;
    const incident: GroupedIncident = {
      key: hostId,
      layer: "hosts",
      severity: "healthy",
      stale: false,
      why: "",
      entityLabel: label,
      asOf: null,
      children: [],
    };
    hostIncidentByKey.set(hostId, incident);
    topLevel.push(incident);
    return incident;
  }

  // D-R3: a truly-unattributed entity (no owning host) must NEVER float as a bare,
  // context-free top-level incident (operator: orphan rows are "useless"). Every such
  // orphan nests under ONE clearly-labeled "Unattributed" bucket — created lazily on
  // the first orphan and APPENDED to the top level LAST (after all real owners), so it
  // reads as a labeled group at the end of the queue, not a floating alert.
  // Single-element holder (not a `let = null`) so the bucket reference is not
  // control-flow-narrowed to `null` by its initializer after closure assignment.
  const unattributedHolder: GroupedIncident[] = [];
  function ensureUnattributedBucket(): GroupedIncident {
    const existing = unattributedHolder[0];
    if (existing !== undefined) return existing;
    const bucket: GroupedIncident = {
      key: "unattributed",
      // A benign owner layer; the bucket's tree match is driven by its children.
      layer: "nodes",
      severity: "healthy",
      stale: false,
      why: "",
      entityLabel: "Unattributed",
      asOf: null,
      children: [],
    };
    // NOTE: not pushed to topLevel here — appended last, after real owners roll up.
    unattributedHolder.push(bucket);
    return bucket;
  }

  // Attach a leaf to its owning host group, or nest it under the single Unattributed
  // bucket when unattached (hostId undefined — Pitfall 6: degrade, never throw; D-R3:
  // never a bare top-level orphan).
  function place(hostId: string | undefined, child: GroupedIncident): void {
    if (hostId === undefined) {
      ensureUnattributedBucket().children.push(child);
      return;
    }
    const incident = ensureHostIncident(hostId, child.entityLabel);
    incident.children.push(child);
  }

  // Per-node fee accumulator (LOCKED #4): fee_raise/fee_lower cards NEVER become
  // per-channel leaves — they collect here (Map = first-seen order, engine order
  // preserved) and collapse to <=2 counted summary children after the card walk.
  interface FeeGroup {
    pubkey: string | null;
    alias: string | null;
    raise: InsightCard[];
    lower: InsightCard[];
  }
  const feeByNode = new Map<string, FeeGroup>();

  // Per-(node,signal) rollup accumulator (quick 260721-gqi #2): noisy per-channel
  // stuck_*/htlc_* cards collect here (Map = first-seen / engine order) and collapse
  // to ONE counted summary child per (node, signal) after the card walk.
  interface RollupGroup {
    pubkey: string | null;
    alias: string | null;
    signal: DetectorId;
    severities: Severity[];
  }
  const rollupByNodeSignal = new Map<string, RollupGroup>();

  // (2/3) Insight cards FIRST — preserve the engine-ranked order.
  for (const card of rankedCards) {
    // LOCKED #4: intercept fee alerts BEFORE the leaf path — group, do NOT emit a row.
    if (FEE_SIGNALS.has(card.signal)) {
      const pubkey = card.node?.pubkey ?? null;
      const groupKey = pubkey ?? "fleet";
      const group = feeByNode.get(groupKey) ?? {
        pubkey,
        alias: card.node?.alias ?? null,
        raise: [],
        lower: [],
      };
      if (card.signal === "fee_raise") group.raise.push(card);
      else group.lower.push(card);
      feeByNode.set(groupKey, group);
      continue; // no per-channel fee leaf — ever
    }

    // quick 260721-gqi #2: intercept noisy per-channel stuck_*/htlc_* signals BEFORE
    // the leaf path — accumulate per (node, signal), do NOT emit a per-channel row.
    if (ROLLUP_SIGNALS.has(card.signal)) {
      const severity = severityFromInsight(card.severity);
      if (severity === "healthy") continue; // nothing wrong
      const pubkey = card.node?.pubkey ?? null;
      const groupKey = `${pubkey ?? "fleet"}:${card.signal}`;
      const group = rollupByNodeSignal.get(groupKey) ?? {
        pubkey,
        alias: card.node?.alias ?? null,
        signal: card.signal,
        severities: [],
      };
      group.severities.push(severity);
      rollupByNodeSignal.set(groupKey, group);
      continue; // no per-channel stuck/htlc leaf — collapses to one summary
    }

    const severity = severityFromInsight(card.severity);
    if (severity === "healthy") continue; // nothing wrong
    const pubkey = card.node?.pubkey ?? null;
    // quick 260721-gqi #1: demote a stale-sourced signal via the staleness lever —
    // set the severity VALUE to "stale" (not just the flag) so worstSeverity filters
    // it. Mirrors the flag⟺value coupling used at bitcoind :327 / services :354 /
    // hosts :388 / gradeNode. A FRESH node keeps its critical VALUE (no-mask).
    const nodeStale = pubkey !== null && staleNodes.has(pubkey);
    const child: GroupedIncident = {
      key: card.id,
      layer: "nodes",
      severity: nodeStale ? "stale" : severity,
      stale: nodeStale,
      why: card.signal,
      entityLabel: card.node?.alias ?? pubkey ?? "fleet",
      asOf: card.evidence?.asOf ? new Date(card.evidence.asOf) : null,
      children: [],
    };
    const hostId = pubkey !== null ? ownership.hostByNode.get(pubkey) : undefined;
    place(hostId, child);
  }

  // Emit <=2 fee summary children per node, in first-seen (engine) order — right
  // after the insight walk so fee groups precede the telemetry layers.
  for (const group of feeByNode.values()) {
    const pubkey = group.pubkey;
    const label = group.alias ?? pubkey ?? "fleet";
    const hostId = pubkey !== null ? ownership.hostByNode.get(pubkey) : undefined;
    // Route ONLY via buildDeepLink (T-12-09-02: relative /{pubkey}/fees, 66-hex gate).
    // A non-routable pubkey (fleet sentinel / garbage) omits href rather than throwing.
    let href: string | undefined;
    if (pubkey !== null) {
      try {
        href = buildDeepLink(pubkey, "fees");
      } catch {
        href = undefined;
      }
    }
    const kinds: Array<{ feeKind: "raise" | "lower"; cards: InsightCard[] }> = [
      { feeKind: "raise", cards: group.raise },
      { feeKind: "lower", cards: group.lower },
    ];
    // O-fee (18-03): the SAME staleNodes demotion as the generic leaf + rollup
    // branches — a week-old fee card from a stale node must not emit a live
    // warning child. Keys ONLY on staleNodes membership (no-mask guarantee).
    const nodeStale = pubkey !== null && staleNodes.has(pubkey);
    for (const { feeKind, cards } of kinds) {
      if (cards.length === 0) continue;
      // Never critical (T-12-09-01): clamp the worst upstream fee severity below critical.
      const severity = clampBelowCritical(
        worstSeverity(cards.map((c) => severityFromInsight(c.severity))),
      );
      place(hostId, {
        key: `fee:${feeKind}:${pubkey ?? "fleet"}`,
        layer: "nodes",
        severity: nodeStale ? "stale" : severity,
        stale: nodeStale,
        why: `${cards.length} channel${cards.length === 1 ? "" : "s"} need a fee ${feeKind}`,
        entityLabel: label,
        asOf: null,
        children: [],
        count: cards.length,
        href,
        feeKind,
      });
    }
  }

  // Emit ONE count-summary child per (node, signal) for the noisy stuck_*/htlc_*
  // kinds, in first-seen (engine) order (quick 260721-gqi #2). 17 stuck-force-close
  // cards on one node collapse to a single "17 channels · STUCK FORCE-CLOSE" row.
  for (const group of rollupByNodeSignal.values()) {
    const pubkey = group.pubkey;
    const label = group.alias ?? pubkey ?? "fleet";
    const hostId = pubkey !== null ? ownership.hostByNode.get(pubkey) : undefined;
    // Same staleness demotion as the leaves (#1): a stale source sets the severity
    // VALUE to "stale" so the parent host does not promote on week-old residue.
    const nodeStale = pubkey !== null && staleNodes.has(pubkey);
    const count = group.severities.length;
    const worst = worstSeverity(group.severities);
    place(hostId, {
      key: `rollup:${group.signal}:${pubkey ?? "fleet"}`,
      layer: "nodes",
      severity: nodeStale ? "stale" : worst,
      stale: nodeStale,
      why: `${count} channel${count === 1 ? "" : "s"} · ${SIGNAL_LABELS[group.signal]}`,
      entityLabel: label,
      asOf: null,
      children: [],
      count,
    });
  }

  // bitcoind layer (per-host chain bands).
  for (const c of chain) {
    const severity = gradeChain(c);
    if (severity === "healthy") continue;
    place(c.hostId, {
      key: `bitcoind:${c.hostId}`,
      layer: "bitcoind",
      severity,
      stale: severity === "stale",
      why: "bitcoind",
      entityLabel: c.hostname ?? c.hostId,
      asOf: c.collectedAt,
      children: [],
    });
  }

  // services layer (host-level AND node-scoped — both roll up to the host). D-R3:
  // `service_inventory` carries the SAME service multiple times (a host-level row +
  // per-node rows) → "Address List Sync" repeats. Dedup by (ownerHostId, serviceName)
  // into ONE child, keeping the WORST severity + the most specific reason of the
  // colliding rows. ownerHostId = hostId, else the node's host (hostByNode), else the
  // row is unattributed and buckets under "Unattributed" (never a bare top-level row).
  const serviceChildByKey = new Map<
    string,
    { hostId: string | undefined; child: GroupedIncident }
  >();
  for (const s of services) {
    const severity = severityFromService(s);
    if (severity === "healthy") continue;
    const ownerHostId = s.hostId ?? ownership.hostByNode.get(s.nodePubkey ?? "");
    const dedupKey = `${ownerHostId ?? "unattributed"}:${s.serviceName}`;
    const candidate: GroupedIncident = {
      key: `service:${ownerHostId ?? "unattributed"}:${s.serviceName}`,
      layer: "services",
      severity,
      stale: severity === "stale",
      // LOCKED #9: the row shows the operator-facing label ONCE (never the raw
      // key), and `why` is the HEALTH reason — never a second copy of the name.
      why: serviceReason(s),
      entityLabel: serviceDisplay(s.serviceName).label,
      asOf: s.collectedAt,
      children: [],
    };
    const existing = serviceChildByKey.get(dedupKey);
    if (existing === undefined) {
      serviceChildByKey.set(dedupKey, { hostId: ownerHostId, child: candidate });
      continue;
    }
    // Collision: keep the WORST severity via the sanctioned reducer (never re-grade).
    // The candidate replaces the existing entry ONLY when it is strictly worse — it
    // then carries its own (most specific) reason/label/asOf. `stale` never promotes
    // (D-08): two stale rows reduce to `healthy` here, so neither replaces the other.
    const worst = worstSeverity([existing.child.severity, severity]);
    if (worst === severity && worst !== existing.child.severity) {
      serviceChildByKey.set(dedupKey, { hostId: ownerHostId, child: candidate });
    }
  }
  for (const { hostId, child } of serviceChildByKey.values()) {
    place(hostId, child);
  }

  // hosts layer (cpu/mem/disk — stale-or-healthy only until a band ships).
  for (const h of hosts) {
    const severity = gradeHost(h);
    if (severity === "healthy") continue;
    place(h.hostId, {
      key: `host:${h.hostId}`,
      layer: "hosts",
      severity,
      stale: severity === "stale",
      why: "host-metrics",
      entityLabel: h.hostname ?? h.hostId,
      asOf: h.collectedAt,
      children: [],
    });
  }

  // nodes layer (scorecard dots — attach to owning host, else unattached top-level).
  for (const n of nodes) {
    const severity = gradeNode(n);
    if (severity === "healthy") continue;
    const hostId = ownership.hostByNode.get(n.pubkey);
    place(hostId, {
      key: `node:${n.pubkey}`,
      layer: "nodes",
      severity,
      stale: severity === "stale",
      why: n.reason ?? "node",
      entityLabel: n.alias ?? n.pubkey,
      asOf: n.asOf,
      children: [],
    });
  }

  // (4) Roll each host incident up from its children (D-02 severity, D-08 stale).
  for (const incident of hostIncidentByKey.values()) {
    // (FIX 1 — quick 260721-kej) Relabel by owned-node alias, else the hostId — never
    // the (arbitrarily first-placed) service child's label. Resolve BEFORE `incident.why`
    // so the phrase reflects host/node identity. Iterate the host's owned pubkeys in Set
    // (insertion) order for a deterministic tie-break when a host owns multiple aliased
    // nodes; first aliased pubkey wins. Falls back to the hostId when none resolve.
    const ownedPubkeys = nodePubkeysByHost.get(incident.key);
    let resolvedHostLabel = incident.key;
    if (ownedPubkeys !== undefined) {
      for (const pubkey of ownedPubkeys) {
        const alias = aliasByPubkey.get(pubkey);
        if (alias !== undefined) {
          resolvedHostLabel = alias;
          break;
        }
      }
    }
    incident.entityLabel = resolvedHostLabel;
    incident.severity = worstSeverity(incident.children.map((c) => c.severity));
    incident.stale = incident.children.some((c) => c.stale);
    incident.asOf = incident.children.reduce<Date | null>((worst, c) => {
      if (c.asOf === null) return worst;
      if (worst === null || c.asOf < worst) return c.asOf;
      return worst;
    }, null);
    const n = incident.children.length;
    incident.why = `${n} alert${n === 1 ? "" : "s"} on ${incident.entityLabel}`;
  }

  // Roll the Unattributed bucket up from its OWN children (same D-02 severity / D-08
  // stale rules as a host), give it an honest why, and APPEND it last — after every
  // real owner — so orphans read as one labeled group at the tail of the queue.
  const bucket = unattributedHolder[0];
  if (bucket !== undefined) {
    bucket.severity = worstSeverity(bucket.children.map((c) => c.severity));
    bucket.stale = bucket.children.some((c) => c.stale);
    bucket.asOf = bucket.children.reduce<Date | null>((worst, c) => {
      if (c.asOf === null) return worst;
      if (worst === null || c.asOf < worst) return c.asOf;
      return worst;
    }, null);
    const n = bucket.children.length;
    bucket.why = `${n} unattributed alert${n === 1 ? "" : "s"} — no owning host`;
    // (FIX 2 — quick 260721-kej) Suppress a context-free Unattributed group that carries
    // no active severity: when every orphan rolled up to healthy (all stale/healthy),
    // the bucket adds noise, not signal. `worstSeverity` already filters `stale`, so an
    // all-stale bucket reads "healthy" here and is dropped; a live critical/warning/watch
    // orphan yields a non-healthy severity and still surfaces (no-mask).
    if (bucket.severity !== "healthy") {
      topLevel.push(bucket);
    }
  }

  return topLevel;
}
