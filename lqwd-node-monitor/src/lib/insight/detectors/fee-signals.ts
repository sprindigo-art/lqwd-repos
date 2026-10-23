import { sql, type SQL } from "drizzle-orm";
import { latestChannelsForNode } from "@/lib/read/latest";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { buildDeepLink } from "@/lib/insight/deeplink";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { CARD_SCHEMA_VERSION, type InsightCard } from "@/lib/insight/types";

// =====================================================
// Detector 5 — fee signals: raise / lower / close-candidate (INSIGHT-02)
// =====================================================
// The ONLY producers of `update_fee` and `close_channel` params this phase —
// the cards Phase 6 eventually signs. Algorithm: the France tiered-fee table
// (fee-optimization-and-recommendations.md §5) per channel:
//   raise  — 90d forwards ≥ feeHighVolumeForwards AND policy PPM < feeFloorPpm
//   lower  — policy PPM > feeCeilingPpm AND 90d forwards < feeLowVolumeForwards
//            ([ASSUMED A1] LOW confidence — see the knob comment in config.ts;
//            no incident data validates "lower", only the tier-table ranges)
//   close-candidate — 0 forwards in 90d AND channel age > closeCandidateAgeDays
//            ("dead channel — close instead of tuning", verbatim; close
//            precedence over lower for dead over-priced channels)
// All three are severity "info" — economic optimization, not operational risk
// (the fee-crash domain pages via fee-stepdown.ts; no double-paging).
//
// Data sources:
//  - CURRENT POLICY: the sanctioned AFM-001 reader latestChannelsForNode
//    (src/lib/read/latest.ts — DISTINCT ON (chan_id)). latest.ts has no
//    fleet-wide variant, so the executor fans per node. ZERO new SQL touches
//    lnd_node_channel_info here; `outgoing_fee_rate_milli_msat` IS the PPM
//    value directly (no conversion — src/lib/console/fees.ts precedent).
//  - 90d REALIZED VOLUME: ONE new fleet-wide aggregate over `lnd_node_forwards`
//    (EVENT log; identity column lnd_pubkey — Pitfall 6). A forward credits
//    BOTH sides, so chan_id_in and chan_id_out are UNION ALL'd before the
//    per-(lnd_pubkey, chan_id) count. Time column `timestamp_ns` is NANOSECONDS
//    — window math multiplies by 1e9, both bound factors carry ::int casts
//    (42725 "operator is not unique", found live 03-07).
//
// timeLockDelta: the warehouse channel snapshot does NOT carry the channel's
// time_lock_delta, so update_fee params ship the LND default (80) as a
// DISPLAY-ONLY placeholder. The node-side executor (scripts/node/apply-fee)
// reads the channel's LIVE time_lock_delta via lncli and applies THAT, so a fee
// change never rewrites the real CLTV delta — this placeholder is never the
// applied value.

const SECONDS_PER_DAY = 86400;

/** 90d realized-volume window (the France tier table is defined over 90d). */
export const FEE_VOLUME_WINDOW_DAYS = 90;

/**
 * LND default time_lock_delta — DISPLAY-ONLY placeholder because
 * lnd_node_channel_info carries no TLD column. The node reads the channel's LIVE
 * delta on apply (scripts/node/apply-fee); this value is never applied.
 */
const DEFAULT_TIME_LOCK_DELTA = 80;

/** Node identity attached to each card (engine resolves alias/backend). */
export type CardNode = NonNullable<InsightCard["node"]>;

/** One node's latest channel rows (verbatim latestChannelsForNode output). */
export interface FeeSignalNodeChannels {
  node: CardNode;
  channels: Record<string, unknown>[];
}

/** Raw per-channel forward count row as surfaced by raw .execute. */
export interface ChannelVolumeRow {
  lnd_pubkey: string;
  chan_id: string;
  forwards: number | string;
}

/**
 * Fleet-wide 90d forward counts per (lnd_pubkey, chan_id). A forward row names
 * the channel on each side (chan_id_in / chan_id_out) — UNION ALL credits both.
 * ns-window idiom from trends.ts: bound day factor × 86400, both ::int, × 1e9.
 */
export function buildChannelVolumeSql(days: number): SQL {
  return sql`
    SELECT lnd_pubkey, chan_id, COUNT(*)::int AS forwards
    FROM (
      SELECT lnd_pubkey, chan_id_in AS chan_id, timestamp_ns FROM lnd_node_forwards
      UNION ALL
      SELECT lnd_pubkey, chan_id_out AS chan_id, timestamp_ns FROM lnd_node_forwards
    ) sides
    WHERE lnd_pubkey IS NOT NULL
      AND chan_id IS NOT NULL
      AND timestamp_ns > (EXTRACT(EPOCH FROM now()) - ${days}::int * ${SECONDS_PER_DAY}::int) * 1e9
    GROUP BY lnd_pubkey, chan_id
  `;
}

/** Fleet-wide 90d channel-volume rows (lazy DB import — shape tests stay no-DB). */
export async function channelVolumeForFleet(
  days: number = FEE_VOLUME_WINDOW_DAYS,
): Promise<ChannelVolumeRow[]> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildChannelVolumeSql(days));
  return result as unknown as ChannelVolumeRow[];
}

/** One node's detector input: sanctioned AFM-001 latest-channel read + identity. */
export async function feeSignalChannelsForNode(node: CardNode): Promise<FeeSignalNodeChannels> {
  const channels = await latestChannelsForNode(node.pubkey);
  return { node, channels };
}

type FeeSignal = "fee_raise" | "fee_lower" | "channel_close_candidate";

interface ChannelFacts {
  chanId: string | null;
  channelPoint: string | null;
  remotePubkey: string | null;
  currentPpm: number | null;
  baseFeeMsat: number;
  ageDays: number | null;
  // 90d realized forwards. `null` = UNKNOWN (the fleet-wide volume read FAILED —
  // I-fee/HARDEN-03): unknown volume must never read as 0 forwards, or a live
  // routing channel would emit a confident close-candidate from a missing read.
  forwards90d: number | null;
  // EXPORT-01 context echo: channel capacity in raw sats, straight from the
  // lnd_node_channel_info.capacity column already on the latest-channel rows —
  // ZERO new SQL. null when the snapshot has no capacity (unknown ≠ 0).
  capacitySat: number | null;
}

function factsFor(row: Record<string, unknown>, forwards90d: number | null): ChannelFacts {
  const rate = row.outgoing_fee_rate_milli_msat;
  const lifetime = row.lifetime;
  return {
    chanId: row.chan_id == null ? null : String(row.chan_id),
    channelPoint: row.channel_point == null ? null : String(row.channel_point),
    remotePubkey: row.remote_pubkey == null ? null : String(row.remote_pubkey),
    // `outgoing_fee_rate_milli_msat` IS the PPM — null stays null, never 0.
    currentPpm: rate == null ? null : Number(rate),
    baseFeeMsat: Number(row.outgoing_fee_base_msat ?? 0),
    ageDays: lifetime == null ? null : Number(lifetime) / SECONDS_PER_DAY,
    forwards90d,
    // Raw sats — the AFM-002 formatter applies at render only (types.ts invariant).
    capacitySat: row.capacity == null ? null : Number(row.capacity),
  };
}

/** Pick the signal for one channel — close-candidate wins over tuning signals. */
function signalFor(facts: ChannelFacts, knobs: InsightKnobs): FeeSignal | null {
  // Volume UNKNOWN (failed 90d read — I-fee): raise-only degrade. Close and
  // lower both rest on a "this channel routed little/nothing" premise that a
  // missing read cannot support; raise (price below floor) is the safe
  // direction and rests on the POLICY read alone, so it may still emit.
  if (facts.forwards90d === null) {
    if (facts.currentPpm === null) return null; // unknown policy ≠ 0 PPM
    return facts.currentPpm < knobs.feeFloorPpm ? "fee_raise" : null;
  }
  // Dead channel first: "close instead of tuning" (tier table, verbatim).
  if (
    facts.forwards90d === 0 &&
    facts.ageDays !== null &&
    facts.ageDays > knobs.closeCandidateAgeDays
  ) {
    return "channel_close_candidate";
  }
  if (facts.currentPpm === null) return null; // unknown policy ≠ 0 PPM
  if (facts.forwards90d >= knobs.feeHighVolumeForwards && facts.currentPpm < knobs.feeFloorPpm) {
    return "fee_raise";
  }
  if (facts.currentPpm > knobs.feeCeilingPpm && facts.forwards90d < knobs.feeLowVolumeForwards) {
    return "fee_lower";
  }
  return null;
}

function buildCard(
  node: CardNode,
  facts: ChannelFacts,
  signal: FeeSignal,
  knobs: InsightKnobs,
  asOfIso: string,
): InsightCard | null {
  // The signing surface needs concrete identifiers — without both there is no
  // executable param set; skip rather than emit an unactionable write card.
  if (facts.chanId === null || facts.channelPoint === null) return null;

  // Honest evidence: an UNKNOWN volume (failed read) carries NO forwards90d
  // claim — a fabricated 0 here is exactly the I-fee erosion this guards.
  const detail: Record<string, string | number> = {};
  if (facts.forwards90d !== null) detail.forwards90d = facts.forwards90d;
  if (facts.currentPpm !== null) detail.currentPpm = facts.currentPpm;
  if (facts.ageDays !== null && signal === "channel_close_candidate") {
    detail.ageDays = facts.ageDays;
  }
  // EXPORT-01: close-candidate cards echo capacity so plan 05-03's export block
  // can size the close without a new read; conditional add — unknown ≠ 0.
  if (facts.capacitySat !== null && signal === "channel_close_candidate") {
    detail.capacitySat = facts.capacitySat;
  }

  let evidence: InsightCard["evidence"];
  let suggestedAction: InsightCard["suggestedAction"];

  if (signal === "channel_close_candidate") {
    evidence = {
      metric: "forwards_90d",
      // close-candidate only fires on a KNOWN 0 (signalFor blocks null volume).
      observed: facts.forwards90d as number,
      threshold: 0,
      unit: "forwards",
      window: "90d",
      asOf: asOfIso,
      deepLink: buildDeepLink(node.pubkey, "fees"),
      detail,
    };
    suggestedAction = {
      type: "close_channel",
      params: { chanId: facts.chanId, channelPoint: facts.channelPoint, force: false },
    };
  } else {
    const isRaise = signal === "fee_raise";
    evidence = {
      metric: isRaise ? "policy_ppm_vs_floor" : "policy_ppm_vs_ceiling",
      observed: facts.currentPpm as number,
      threshold: isRaise ? knobs.feeFloorPpm : knobs.feeCeilingPpm,
      unit: "ppm",
      window: "90d",
      asOf: asOfIso,
      deepLink: buildDeepLink(node.pubkey, "fees"),
      detail,
    };
    suggestedAction = {
      type: "update_fee",
      params: {
        chanId: facts.chanId,
        channelPoint: facts.channelPoint,
        currentPpm: facts.currentPpm as number,
        suggestedPpm: isRaise ? knobs.feeFloorPpm : knobs.feeLowerTargetPpm,
        baseFeeMsat: facts.baseFeeMsat,
        timeLockDelta: DEFAULT_TIME_LOCK_DELTA,
      },
    };
  }

  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    // D-08 dedupe id: stable across recomputes while the condition persists.
    id: `${signal}:${node.pubkey}:${facts.chanId ?? facts.channelPoint}`,
    severity: "info",
    node,
    target: {
      kind: "channel",
      chanId: facts.chanId,
      channelPoint: facts.channelPoint,
      remotePubkey: facts.remotePubkey,
    },
    signal,
    evidence,
    suggestedAction,
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    // D-16 — guidance text on write cards (all three fee signals carry writes).
    rateLimitGuidance: `Suggested cap: ${knobs.maxWritesPerDay} write recommendations per node per day (guidance only, not enforced).`,
  };
}

/**
 * Pure detector: France tiered-fee table over latest channel rows + 90d
 * volume. One card max per channel (close-candidate precedence). Fixture-
 * drivable — no DB, no env; `now` injectable for deterministic asOf.
 */
export function detectFeeSignals(
  nodes: FeeSignalNodeChannels[],
  // `null` = the fleet-wide 90d volume read FAILED (engine degrade) — volume is
  // UNKNOWN for every channel, NOT zero (I-fee/HARDEN-03). A real (possibly
  // empty) array keeps the aggregate semantics: absent entry = genuinely 0.
  volumeRows: ChannelVolumeRow[] | null,
  config: Record<"lnd" | "ldk", InsightKnobs> = INSIGHT_CONFIG,
  now: Date = new Date(),
): InsightCard[] {
  const volumeByKey = volumeRows === null ? null : new Map<string, number>();
  if (volumeRows !== null && volumeByKey !== null) {
    for (const row of volumeRows) {
      volumeByKey.set(`${row.lnd_pubkey}:${row.chan_id}`, Number(row.forwards));
    }
  }

  const cards: InsightCard[] = [];
  for (const { node, channels } of nodes) {
    const knobs = config[node.backend];

    // asOf = newest channel snapshot for this node (honest evidence timestamp).
    let asOf: Date | null = null;
    for (const row of channels) {
      const ts = parseDbTimestampUtc((row.timestamp ?? null) as Date | string | null);
      if (ts && (asOf === null || ts > asOf)) asOf = ts;
    }
    const asOfIso = (asOf ?? now).toISOString();

    for (const row of channels) {
      if (row.closed === true) continue;
      const chanId = row.chan_id == null ? null : String(row.chan_id);
      // volumeByKey === null → the read failed → UNKNOWN, never 0 (I-fee).
      const forwards90d: number | null =
        volumeByKey === null
          ? null
          : chanId === null
            ? 0
            : (volumeByKey.get(`${node.pubkey}:${chanId}`) ?? 0);
      const facts = factsFor(row, forwards90d);
      const signal = signalFor(facts, knobs);
      if (signal === null) continue;
      const card = buildCard(node, facts, signal, knobs, asOfIso);
      if (card !== null) cards.push(card);
    }
  }
  return cards;
}
