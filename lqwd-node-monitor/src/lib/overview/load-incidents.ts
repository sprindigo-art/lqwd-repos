import "server-only";

import { getChainTelemetry, type ChainTelemetryView } from "@/lib/read/chain-telemetry";
import { getLatestHostMetrics, type HostMetricsView } from "@/lib/read/host-metrics";
import { getServiceHealth, type ServiceHealthState } from "@/lib/read/service-health";
import { loadFleetView } from "@/lib/scorecard/fleet";
import type { FleetView, ScorecardView } from "@/lib/scorecard/types";
import { loadInsightView } from "@/lib/insight/engine";
import { rankCards } from "@/lib/insight/rank";

import { assembleIncidents, type GroupedIncident } from "@/lib/overview/incidents";
import { applyFreshnessCutoff } from "@/lib/overview/freshness-cutoff";

// =====================================================
// load-incidents.ts — the ONE server-only incident-assembly loader (INC-01)
// =====================================================
// The single read+assemble pipeline behind the attention queue. Extracted from
// the copy-pasted block that lived on both the overview page and the host detail
// page so exactly one loader produces the `GroupedIncident[]` every consumer
// renders — the overview queue, the host detail banner, and (critically) the AI
// narrate action, whose payload MUST be byte-identical to the UI it explains
// (faithfulness invariant, AI-SPEC FM-2). A fourth hand-written copy of this
// pipeline is now impossible.
//
// FAIL-SOFT: every read carries its OWN `.catch` to a safe default, so one broken
// layer degrades its slice rather than taking the queue down. ENGINE-ORDER IS LAW
// (incidents.ts:18-22): the loader consumes the ranked cards in order and NEVER
// re-sorts — `assembleIncidents` owns all grouping; this module adds no ordering.
//
// SELECTION CONTRACT: `GroupedIncident` is keyed by `.key` (host_id / card id /
// "fleet") and has NO `.hostId` field. A per-host consumer selects with
//   incidents.find((i) => i.key === hostId)
// — selecting on a non-existent `.hostId` silently returns `undefined` for every
// host (the footgun this extraction fixes for all future consumers).

/**
 * Assemble the cross-layer, root-cause-grouped incident tree from the live
 * warehouse + telemetry reads. Server-only (lazy DB clients). Returns the
 * engine-ordered top-level `GroupedIncident[]`; an all-clear fleet returns `[]`.
 */
export async function loadIncidents(): Promise<GroupedIncident[]> {
  // The hosts dimension seeds the per-host service reads (inventory-driven) and is
  // the `hosts` input to the assembler. A read failure degrades to an empty fleet.
  const hosts0 = await getLatestHostMetrics().catch(() => [] as HostMetricsView[]);

  // Fail-soft supplementary reads — one broken layer degrades its section only.
  const [chain0, fleet, insightView] = await Promise.all([
    getChainTelemetry().catch(() => [] as ChainTelemetryView[]),
    loadFleetView().catch(
      () => ({ nodes: [] as ScorecardView[], fetchedAt: new Date() }) as FleetView,
    ),
    loadInsightView().catch(() => null),
  ]);

  // assembleIncidents needs fleet-wide services (ownership + all-host grouping).
  const serviceArrays = await Promise.all(
    hosts0.map((h) => getServiceHealth(h.hostId).catch(() => [] as ServiceHealthState[])),
  );
  const services0 = serviceArrays.flat();

  // ── O-load (18-03/HARDEN-03): the loader IS the operator-visible pipeline ────
  // The LOCKED 30-day freshness cutoff (backlog #8) + surviving-pubkey card
  // filter previously lived ONLY in the overview page, so narrateIncident() and
  // the mute baseline operated on a DIFFERENT incident set than the operator
  // sees (AI narrating children the UI drops). Applying them HERE — per layer,
  // via each layer's own stamp accessor, mirroring page.tsx — makes this the
  // single source of the incident set for every consumer.
  const nodes = applyFreshnessCutoff(fleet.nodes, (n) => n.asOf);
  const hosts = applyFreshnessCutoff(hosts0, (h) => h.collectedAt);
  const chain = applyFreshnessCutoff(chain0, (c) => c.collectedAt);
  const services = applyFreshnessCutoff(services0, (s) => s.collectedAt);

  // Drop ranked insight cards whose node was eliminated — a card for a dead node
  // must not survive into narration or the mute baseline. Null/fleet-pubkey cards
  // are kept (they are not tied to an eliminated node).
  const survivingPubkeys = new Set(nodes.map((n) => n.pubkey));
  const rankedCards = (insightView ? rankCards(insightView.cards) : []).filter((card) => {
    const pubkey = card.node?.pubkey ?? null;
    return pubkey === null || survivingPubkeys.has(pubkey);
  });

  return assembleIncidents({
    rankedCards,
    hosts,
    chain,
    services,
    nodes,
  });
}
