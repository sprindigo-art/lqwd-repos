import "server-only";

import { loadFleetView } from "@/lib/scorecard/fleet";
import type { FleetView } from "@/lib/scorecard/types";
import { PENDING_RECENCY_HOURS } from "@/lib/console/config";
import {
  buildPendingView,
  currentPendingChannels,
  currentPendingSweeps,
  type PendingView,
} from "@/lib/read/pending";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { InsightCardArraySchema } from "@/lib/insight/schema";
import type { InsightCard } from "@/lib/insight/types";
import {
  feeHistoryByChannel,
  lastPolicyChange,
  type FeeSnapshot,
  type PolicyChange,
} from "@/lib/insight/fee-history";
import {
  applyHysteresis,
  applyRateLimitGuidance,
  applySuppression,
} from "@/lib/insight/guardrails";
import { rankCards } from "@/lib/insight/rank";
import { isLlmEnabled } from "@/lib/insight/narrative";
import {
  closeStormFlaggedPubkeys,
  detectCloseStorm,
} from "@/lib/insight/detectors/close-storm";
import {
  detectHtlcTimeout,
  fetchHtlcTimeoutRows,
  type HtlcNodeMeta,
  type HtlcRow,
} from "@/lib/insight/detectors/htlc-timeout";
import {
  channelVolumeForFleet,
  detectFeeSignals,
  feeSignalChannelsForNode,
  type CardNode,
  type ChannelVolumeRow,
  type FeeSignalNodeChannels,
} from "@/lib/insight/detectors/fee-signals";
import {
  detectStepdown,
  stepdownForFleet,
  type StepdownAggregates,
  type StepdownNodeRow,
} from "@/lib/insight/detectors/fee-stepdown";
import {
  buildClusterSql,
  detectCloseCluster,
  type ClusterRow,
} from "@/lib/insight/detectors/close-cluster";
import {
  buildRebalanceSql,
  detectRebalance,
  type RebalanceAggRow,
} from "@/lib/insight/detectors/rebalance";
import { detectStuckPending } from "@/lib/insight/detectors/stuck-pending";
import {
  AP12_NO_DATA_PLACEHOLDER,
  ap12AdvisoryCards,
  type Ap12DetectorResult,
} from "@/lib/insight/detectors/ap12-advisory";

// =====================================================
// INSIGHT-02/INSIGHT-03 — the single server-side insight computation
// =====================================================
// loadInsightView() is THE one card computation both surfaces render:
//  - D-07: STATELESS — every card is computed on demand from warehouse state
//    at load time; no nodemon writes, no cron, no persisted card state. The
//    hysteresis "memory" is reconstructed from warehouse fee-policy snapshot
//    history, never stored.
//  - D-08: ONE ENGINE, TWO VIEWS — the inbox renders every card; the per-node
//    console filters the SAME computation by pubkey
//    (cards.filter(c => c.node?.pubkey === pubkey)). No second computation.
//
// Query budget per load (bounded, T-02-05 posture):
//  - loadFleetView() reuse — 5 windowed aggregates + 1 DISTINCT ON snapshot
//    (already happening for the scorecard; close-storm + suppression flags +
//    node metadata + liquidity imbalance all ride on it — zero new queries).
//  - Pending reuse — the 2 sanctioned currently-pending reads
//    (currentPendingChannels / currentPendingSweeps) → buildPendingView.
//  - ~5 new detector aggregates: htlc-timeout signature, fee-signals 90d
//    volume (+ the per-node AFM-001 latest-channel fan — latest.ts has no
//    fleet-wide variant), step-down windows, close-cluster hour buckets,
//    rebalance partner aggregate, plus the fee-history hysteresis scan.
//
// Failure posture: each independent read is wrapped so ONE failed detector
// degrades to [] with console.error (fail-loud in logs, fail-soft in render —
// the pending/page.tsx .catch precedent); a broken detector never takes both
// surfaces down. The FINAL gate is InsightCardArraySchema.parse — a contract
// violation throws here and never renders (T-04-24).
//
// server-only (T-04-25): this module triggers warehouse reads and (LLM path)
// env-gated AI SDK calls. The pure assembly (assembleCards) is exported for
// unit tests — the fleet.ts assembleScorecard/attachPeerRelative precedent.

/** The view contract both render surfaces consume (D-08). */
export interface InsightView {
  cards: InsightCard[];
  fetchedAt: Date;
  llmEnabled: boolean;
  /** AP12_NO_DATA_PLACEHOLDER when the LLM is off (D-11 honesty copy); null when on. */
  ap12Placeholder: string | null;
}

/**
 * Fail-soft read wrapper: one failed detector read degrades to its empty
 * fallback with a loud console.error — it never rejects the whole view.
 */
async function degrade<T>(label: string, read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    console.error(`loadInsightView: ${label} read failed — degrading to empty:`, error);
    return fallback;
  }
}

/** Cluster-row fetch (lazy DB import — the engine's unit tests stay no-DB). */
async function fetchClusterRows(scanWindowHours: number): Promise<ClusterRow[]> {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildClusterSql(scanWindowHours));
  return result as unknown as ClusterRow[];
}

/** Rebalance-aggregate fetch (lazy DB import — same posture as above). */
async function fetchRebalanceRows(): Promise<RebalanceAggRow[]> {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildRebalanceSql());
  return result as unknown as RebalanceAggRow[];
}

const EMPTY_PENDING: PendingView = { nodes: [], asOf: null };

/**
 * Per-node liquidity imbalance from the ALREADY-LOADED fleet view — no new
 * query. Typed dimension access by key (Pitfall 5 — never label matching);
 * value = localSat − remoteSat (signed sats: the 04-06 rebalance contract
 * sizes from Math.abs and derives direction from the sign). Nodes whose
 * liquidity extras are absent get NO entry (unknown ≠ balanced).
 */
export function liquidityImbalanceFromFleet(fleet: FleetView): Map<string, number> {
  const imbalance = new Map<string, number>();
  for (const node of fleet.nodes) {
    const extras = node.dimensions.find((d) => d.key === "liquidity")?.extras;
    if (!extras) continue;
    const localSat = extras.localSat;
    const remoteSat = extras.remoteSat;
    if (typeof localSat !== "number" || typeof remoteSat !== "number") continue;
    imbalance.set(node.pubkey, localSat - remoteSat);
  }
  return imbalance;
}

/** Per-pubkey node metadata maps derived once from the fleet view. */
function nodeMetaFromFleet(fleet: FleetView): {
  metaByPubkey: Map<string, HtlcNodeMeta>;
  cardNodes: CardNode[];
} {
  const metaByPubkey = new Map<string, HtlcNodeMeta>();
  const cardNodes: CardNode[] = [];
  for (const node of fleet.nodes) {
    metaByPubkey.set(node.pubkey, { alias: node.alias, backend: node.backend });
    cardNodes.push({ pubkey: node.pubkey, alias: node.alias, backend: node.backend });
  }
  return { metaByPubkey, cardNodes };
}

/**
 * EXPORT-01 context echo — stamp `evidence.detail.peerAlias` on close-candidate
 * cards whose remote peer is an INTRA-FLEET node, using the fleet alias map
 * nodeMetaFromFleet already derived: ZERO new queries. Scope is deliberately
 * limited to `channel_close_candidate` (minimal blast radius); every other card
 * passes through by the SAME reference. Non-fleet peers carry nothing —
 * builders render a truncated pubkey + "alias unknown" (RESEARCH A5). Pure +
 * non-mutating (spread-copy, the guardrails.ts withDetail pattern).
 */
export function enrichCloseCardPeerAlias(
  cards: InsightCard[],
  metaByPubkey: Map<string, HtlcNodeMeta>,
): InsightCard[] {
  return cards.map((card) => {
    if (card.signal !== "channel_close_candidate") return card;
    if (card.target.kind !== "channel" || card.target.remotePubkey === null) return card;
    const alias = metaByPubkey.get(card.target.remotePubkey)?.alias ?? null;
    if (alias === null) return card;
    return {
      ...card,
      evidence: {
        ...card.evidence,
        detail: { ...(card.evidence.detail ?? {}), peerAlias: alias },
      },
    };
  });
}

/** Everything the pure assembly consumes — the engine's dependency seam. */
export interface AssembleInputs {
  fleet: FleetView;
  htlcRows: HtlcRow[];
  feeSignalNodes: FeeSignalNodeChannels[];
  /** null = the 90d volume read FAILED — UNKNOWN volume, raise-only (I-fee). */
  volumeRows: ChannelVolumeRow[] | null;
  stepdownAggregates: StepdownAggregates[];
  clusterRows: ClusterRow[];
  rebalanceRows: RebalanceAggRow[];
  feeHistory: Map<string, FeeSnapshot[]>;
  pendingView: PendingView;
  /** Pre-fetched LLM advisory cards ([] when the flag is off). */
  ap12Cards: InsightCard[];
  config?: Record<"lnd" | "ldk", InsightKnobs>;
  now?: Date;
}

/**
 * Pure card assembly — steps 3–5 of the computation (exported for unit tests;
 * the fleet.ts assembleScorecard precedent: orchestration logic testable
 * without DB). Runs the pure detect* functions over already-fetched inputs,
 * then the guardrail post-passes IN ORDER (hysteresis → suppression →
 * rate-limit guidance — guardrails.ts banner contract), then the D-06 rank,
 * then the InsightCardArraySchema.parse contract gate. A contract violation
 * THROWS here — an invalid card never renders (T-04-24).
 *
 * Single-knob call sites (htlc, cluster, rebalance, stuck-pending, guardrail
 * passes) read config.lnd: the lnd/ldk knob sets ship identical (config.ts),
 * and per-backend divergence belongs inside the detectors that take the full
 * record (fee-signals, step-down).
 */
export function assembleCards(inputs: AssembleInputs): InsightCard[] {
  const config = inputs.config ?? INSIGHT_CONFIG;
  const knobs = config.lnd;
  const now = inputs.now ?? new Date();

  const { metaByPubkey } = nodeMetaFromFleet(inputs.fleet);

  // Step-down aggregates join the fleet metadata (alias/backend) here; a node
  // missing from the fleet snapshot falls back to the D-03 default backend.
  const stepdownRows: StepdownNodeRow[] = inputs.stepdownAggregates.map((agg) => {
    const meta = metaByPubkey.get(agg.pubkey) ?? { alias: null, backend: "lnd" as const };
    return {
      node: { pubkey: agg.pubkey, alias: meta.alias, backend: meta.backend },
      fees7dMsat: agg.fees7dMsat,
      amtIn7dMsat: agg.amtIn7dMsat,
      forwards7d: agg.forwards7d,
      fees24hMsat: agg.fees24hMsat,
      amtIn24hMsat: agg.amtIn24hMsat,
      feesBaselineMsat: agg.feesBaselineMsat,
      amtInBaselineMsat: agg.amtInBaselineMsat,
      forwardsBaseline: agg.forwardsBaseline,
    };
  });

  // Liquidity imbalance from the loaded fleet view — detectRebalance's third
  // argument; without it the `rebalance` SuggestedAction variant is
  // unreachable at runtime (every degraded card would fall back to
  // investigate).
  const liquidityImbalanceByPubkey = liquidityImbalanceFromFleet(inputs.fleet);

  const detected: InsightCard[] = [
    ...detectCloseStorm(inputs.fleet),
    ...detectHtlcTimeout(inputs.htlcRows, knobs, metaByPubkey),
    ...detectFeeSignals(inputs.feeSignalNodes, inputs.volumeRows, config, now),
    ...detectStepdown(stepdownRows, config, now),
    ...detectCloseCluster(inputs.clusterRows, knobs),
    ...detectRebalance(inputs.rebalanceRows, knobs, liquidityImbalanceByPubkey),
    ...detectStuckPending(inputs.pendingView, knobs, now.getTime()),
    ...inputs.ap12Cards,
  ];

  // EXPORT-01 detail enrichment runs BEFORE the guardrail passes (and thus
  // before the schema-parse gate): intra-fleet peer aliases on close-candidate
  // cards from the fleet alias map nodeMetaFromFleet already derived — zero new
  // queries. Guardrail ordering contract below is untouched.
  const cards = enrichCloseCardPeerAlias(detected, metaByPubkey);

  // Stateless hysteresis memory: most recent observed policy change per
  // channel, reconstructed from the warehouse snapshot series (D-07).
  const historyByChanId = new Map<string, PolicyChange | null>();
  for (const [chanId, series] of inputs.feeHistory) {
    historyByChanId.set(chanId, lastPolicyChange(series));
  }

  // Guardrail post-passes — EXACTLY this order (guardrails.ts contract):
  // hysteresis stamps its state on every fee card BEFORE suppression can null
  // the action; suppression runs before the rate-limit counter so suppressed
  // writes never inflate the per-node count.
  let processed = applyHysteresis(cards, historyByChanId, knobs, now);
  processed = applySuppression(processed, closeStormFlaggedPubkeys(inputs.fleet));
  processed = applyRateLimitGuidance(processed, knobs);

  // D-06 deterministic rank, then THE contract gate: every card leaving the
  // engine passes InsightCardArraySchema.parse or the whole view throws.
  return InsightCardArraySchema.parse(rankCards(processed));
}

// ── Short-TTL read-through cache (perf; operator-approved 2026-06-16) ─────────
// /inbox and the per-node console re-run the full computation on EVERY request
// (force-dynamic). Facet navigation does NOT change the card set — applyFacets
// is a pure in-memory narrow — so re-running ~35 warehouse queries per filter
// click is wasted work and the source of the per-action latency. A short
// in-process TTL memo makes repeat loads within the window instant while
// keeping data fresh (FreshnessStamp shows the cached `fetchedAt`).
//
// This is an EPHEMERAL performance cache, NOT persisted card state — D-07's "no
// persisted card state / no cron" still holds (nothing is written to nodemon;
// the memo evaporates with the process). A single long-running process
// (VM/local, not serverless) makes a module/globalThis memo the correct scope —
// the same pattern as the warehouse-routing pool singleton. The cached PROMISE
// also collapses concurrent cold-cache callers into one computation; a rejected
// computation is evicted so the next load retries instead of pinning the error.
export const INSIGHT_TTL_MS = 45_000;

/**
 * Whether a (possibly cached) InsightView has aged past the cache window — the
 * honest `stale` flag for FreshnessStamp (WR-04). Lives here (a server module,
 * not a component) so the wall-clock read stays out of the RSC render body.
 */
export function isInsightViewStale(fetchedAt: Date): boolean {
  return Date.now() - fetchedAt.getTime() > INSIGHT_TTL_MS;
}

interface InsightCacheEntry {
  at: number;
  promise: Promise<InsightView>;
}

const globalForInsight = globalThis as unknown as { _insightViewCache?: InsightCacheEntry };

/**
 * The single insight view both surfaces render (D-07/D-08), served through the
 * short-TTL memo above. The first load (or first after the window lapses) runs
 * the full computation; loads within the window reuse it.
 */
export async function loadInsightView(): Promise<InsightView> {
  const now = Date.now();
  const cached = globalForInsight._insightViewCache;
  if (cached !== undefined && now - cached.at < INSIGHT_TTL_MS) {
    return cached.promise;
  }

  const promise = computeInsightView();
  const entry: InsightCacheEntry = { at: now, promise };
  globalForInsight._insightViewCache = entry;
  // Evict on failure so the next navigation retries rather than serving a
  // pinned rejection for the whole TTL.
  promise.catch(() => {
    if (globalForInsight._insightViewCache === entry) {
      globalForInsight._insightViewCache = undefined;
    }
  });
  return promise;
}

/**
 * The single insight computation both surfaces render (D-07/D-08): fleet
 * reuse → parallel fail-soft detector reads → pure assembly (detect* →
 * guardrails → rank → schema gate) → { cards, fetchedAt }.
 */
async function computeInsightView(): Promise<InsightView> {
  const knobs = INSIGHT_CONFIG.lnd;

  // 1. Fleet reuse — close-storm metric + suppression flags + node metadata +
  //    liquidity imbalance all come from this one already-bounded computation.
  //    PERF-03: kick it off WITHOUT awaiting so the seven fleet-INDEPENDENT reads
  //    below run concurrently with it instead of behind it. Only the feeSignal
  //    fan consumes `fleet` (it needs cardNodes), so it stays after the await.
  const fleetPromise = loadFleetView();

  // 2. The seven fleet-independent reads in parallel, each degrade-wrapped
  //    (fail-loud in logs, fail-soft in render — one broken detector never takes
  //    the view down). Started immediately; they no longer sit behind the fleet
  //    read (PERF-03 waterfall A).
  const [
    htlcRows,
    volumeRows,
    stepdownAggregates,
    clusterRows,
    rebalanceRows,
    feeHistory,
    pendingView,
  ] = await Promise.all([
    degrade("htlc-timeout", () => fetchHtlcTimeoutRows(knobs.htlcWindowDays), [] as HtlcRow[]),
    // I-fee (HARDEN-03): a FAILED volume read degrades to null (UNKNOWN), never
    // [] — an empty array would read as "every channel routed 0 forwards" and
    // let detectFeeSignals fabricate confident close-candidates from a missing
    // signal. detectFeeSignals goes raise-only on null.
    degrade("fee-signal volume", () => channelVolumeForFleet(), null as ChannelVolumeRow[] | null),
    degrade("fee step-down", () => stepdownForFleet(), [] as StepdownAggregates[]),
    degrade(
      "close-cluster",
      () => fetchClusterRows(knobs.clusterScanWindowHours),
      [] as ClusterRow[],
    ),
    degrade("rebalance", () => fetchRebalanceRows(), [] as RebalanceAggRow[]),
    degrade(
      "fee-policy history",
      () => feeHistoryByChannel(knobs.feeMinIntervalHours * 2),
      new Map<string, FeeSnapshot[]>(),
    ),
    degrade(
      "pending",
      async () => {
        const [rows, sweeps] = await Promise.all([
          currentPendingChannels(PENDING_RECENCY_HOURS),
          currentPendingSweeps(PENDING_RECENCY_HOURS),
        ]);
        return buildPendingView(rows, sweeps);
      },
      EMPTY_PENDING,
    ),
  ]);

  // 3. Now join the fleet read (already in flight) and run the one read that
  //    depends on it — the per-node feeSignal fan (its own Promise.all + degrade
  //    preserved). fleet resolves concurrently with the block above, so the cold
  //    path is max(fleet, independent reads) + the fan, not their sum.
  const fleet = await fleetPromise;
  const { cardNodes } = nodeMetaFromFleet(fleet);
  const feeSignalNodes = await degrade(
    "fee-signal channels",
    () => Promise.all(cardNodes.map((node) => feeSignalChannelsForNode(node))),
    [] as FeeSignalNodeChannels[],
  );

  // 4. Deterministic AP-12 detector (COL-02 — the LLM stopgap is retired):
  //    reads pg_health via the fleet reader regardless of the LLM flag; no
  //    pg_health data anywhere ⇒ the honest placeholder copy (D-11 pattern).
  const llmEnabled = isLlmEnabled();
  const ap12Result = await degrade<Ap12DetectorResult>(
    "ap12 detector",
    () => ap12AdvisoryCards(cardNodes),
    { cards: [], hasData: false },
  );
  const ap12Cards: InsightCard[] = ap12Result.cards;
  const ap12Placeholder: string | null = ap12Result.hasData ? null : AP12_NO_DATA_PLACEHOLDER;

  // 5–7. Pure assembly: detect* → guardrails (ordered) → rank → contract gate.
  const cards = assembleCards({
    fleet,
    htlcRows,
    feeSignalNodes,
    volumeRows,
    stepdownAggregates,
    clusterRows,
    rebalanceRows,
    feeHistory,
    pendingView,
    ap12Cards,
  });

  return { cards, fetchedAt: new Date(), llmEnabled, ap12Placeholder };
}
