import {
  type PendingNodeGroup,
  type PendingRow,
  type PendingSweepRow,
  type PendingView,
} from "@/lib/read/pending";
import { PENDING_RECENCY_HOURS } from "@/lib/console/config";
import { buildDeepLink, FLEET_PENDING_LINK } from "@/lib/insight/deeplink";
import type { InsightKnobs } from "@/lib/insight/config";
import { CARD_SCHEMA_VERSION, type InsightCard, type Severity } from "@/lib/insight/types";

// =====================================================
// Stuck-pending detector (PENDING-02 — detectors 9–11)
// =====================================================
// Data source: `buildPendingView()` from `@/lib/read/pending` — the sanctioned
// currently-pending readers (Don't Hand-Roll). This module issues ZERO SQL:
// the pending tables are resolved-residue minefields whose recency filter,
// DISTINCT ON (channel_point), and orphan-sweep handling are already
// golden-tested in the reader. The maturity grace knob (fcMaturityGraceBlocks)
// absorbs snapshot lag at the 6h collector cadence ([ASSUMED A3]).
//
// Three cases (REQUIREMENTS PENDING-02 AC):
//  (a) Force-close past maturity — FORCE_CLOSE, limbo > 0, blocks_til_maturity
//      at/past the grace line → warn; ~1 day past → critical. Action:
//      remediate_pending { case: "restart_procedure" } — Phase 5 renders the
//      coordinated-restart runbook, explicitly NOT an auto-restart (T-04-14).
//  (b) Stuck sweep — broadcast_attempts past the matrix line OR aged OR
//      under-fee'd (sat_per_vbyte < requested) → warn; attempts approaching
//      France's worst case → critical. Action: remediate_pending
//      { case: "bump_fee" } (Phase 5 exports the lncli wallet bumpfee CPFP).
//      Nested AND orphan sweeps are scanned — orphans are never dropped.
//  (c) Stuck open — PENDING_OPEN aged past the warn window → warn, past the
//      critical window → critical. Action: remediate_pending
//      { case: "aged_funding" }.
//
// Every card carries evidence.detail.limboSat — the explicit D-06 rank key
// (limbo_balance for channels, amount_sat for sweeps), numeric-coerced in ONE
// place (Pitfall 3). Source tables are LND-only — node.backend is "lnd".

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SNAPSHOT_WINDOW = `${PENDING_RECENCY_HOURS}h snapshot`;
const PUBKEY_RE = /^[0-9a-f]{66}$/;

/**
 * THE single numeric coercion point for the D-06 rank key (Pitfall 3):
 * limbo_balance (string) for channels, amount_sat for sweeps. Missing /
 * non-numeric → 0 — every emitted card MUST carry a numeric limboSat.
 */
function toLimboSat(raw: string | number | null): number {
  if (raw == null) return 0;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Nullable numeric-string coercion (sat_per_vbyte columns surface as strings). */
function num(raw: string | number | null): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Age in ms against the injected clock; falls back to the reader's ageMs. */
function ageMsOf(createdAt: Date | null, readerAgeMs: number | null, nowMs: number): number | null {
  if (createdAt != null) return nowMs - createdAt.getTime();
  return readerAgeMs;
}

function asOfIso(updatedAt: Date | null, group: PendingNodeGroup, nowMs: number): string {
  return (updatedAt ?? group.asOf ?? new Date(nowMs)).toISOString();
}

/** Pending-tab deep link; unknown-identity groups anchor to the fleet page. */
function pendingLinkFor(pubkey: string): string {
  return PUBKEY_RE.test(pubkey) ? buildDeepLink(pubkey, "pending") : FLEET_PENDING_LINK;
}

interface NodeCtx {
  group: PendingNodeGroup;
  nodeMeta: { pubkey: string; alias: string | null; backend: "lnd" };
  deepLink: string;
}

/**
 * Classify the three PENDING-02 stuck cases from the sanctioned pending view.
 * Pure — `nowMs` is injected for deterministic age tests; zero SQL.
 */
export function detectStuckPending(
  view: PendingView,
  config: InsightKnobs,
  nowMs: number,
): InsightCard[] {
  const cards: InsightCard[] = [];

  for (const group of view.nodes) {
    const ctx: NodeCtx = {
      group,
      nodeMeta: { pubkey: group.localPubkey, alias: group.lndAlias, backend: "lnd" },
      deepLink: pendingLinkFor(group.localPubkey),
    };

    // (a) Force-close past maturity.
    for (const row of group.sections["FORCE_CLOSE"] ?? []) {
      const card = fcPastMaturityCard(row, ctx, config, nowMs);
      if (card) cards.push(card);
    }

    // (b) Stuck sweeps — nested under ANY section's rows + orphans (never dropped).
    for (const section of Object.values(group.sections)) {
      for (const row of section) {
        for (const sweep of row.sweeps) {
          const card = stuckSweepCard(sweep, ctx, config, nowMs);
          if (card) cards.push(card);
        }
      }
    }
    for (const sweep of group.unattachedSweeps) {
      const card = stuckSweepCard(sweep, ctx, config, nowMs);
      if (card) cards.push(card);
    }

    // (c) Stuck open.
    for (const row of group.sections["PENDING_OPEN"] ?? []) {
      const card = stuckOpenCard(row, ctx, config, nowMs);
      if (card) cards.push(card);
    }
  }

  return cards;
}

function fcPastMaturityCard(
  row: PendingRow,
  ctx: NodeCtx,
  config: InsightKnobs,
  nowMs: number,
): InsightCard | null {
  const limboSat = toLimboSat(row.limboBalance);
  const btm = row.blocksTilMaturity;
  if (limboSat <= 0 || btm == null) return null;
  if (btm > -config.fcMaturityGraceBlocks) return null; // inside grace — not stuck

  const blocksPast = -btm;
  const severity: Severity =
    btm <= -config.fcPastMaturityCriticalBlocks ? "critical" : "warn";
  const ageMs = ageMsOf(row.createdAt, row.ageMs, nowMs);

  const detail: Record<string, string | number> = { limboSat };
  if (row.channelPoint != null) detail.channelPoint = row.channelPoint;
  if (ageMs != null) detail.ageHours = ageMs / HOUR_MS;

  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    id: `stuck_fc_past_maturity:${ctx.nodeMeta.pubkey}:${row.channelPoint ?? row.closingTxid ?? "channel"}`,
    severity,
    node: ctx.nodeMeta,
    target: {
      kind: "channel",
      chanId: null,
      channelPoint: row.channelPoint,
      remotePubkey: row.remoteNodePub,
    },
    signal: "stuck_fc_past_maturity",
    evidence: {
      metric: "blocksPastMaturity",
      observed: blocksPast,
      threshold: config.fcMaturityGraceBlocks,
      unit: "blocks",
      window: SNAPSHOT_WINDOW,
      asOf: asOfIso(row.updatedAt, ctx.group, nowMs),
      deepLink: ctx.deepLink,
      detail,
    },
    suggestedAction: {
      type: "remediate_pending",
      params: {
        case: "restart_procedure",
        channelPoint: row.channelPoint,
        outpointTxid: null,
        suggestedSatPerVbyte: null,
      },
    },
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  };
}

function stuckSweepCard(
  sweep: PendingSweepRow,
  ctx: NodeCtx,
  config: InsightKnobs,
  nowMs: number,
): InsightCard | null {
  // A sweep without its outpoint identity cannot be targeted or bumped.
  if (sweep.outpointTxid == null || sweep.outpointOutputIndex == null) return null;

  const attempts = sweep.broadcastAttempts ?? 0;
  const ageMs = ageMsOf(sweep.createdAt, sweep.ageMs, nowMs);
  const satPerVbyte = num(sweep.satPerVbyte);
  const requestedSatPerVbyte = num(sweep.requestedSatPerVbyte);

  const attemptsBreach = attempts > config.sweepStuckAttempts;
  const ageBreach = ageMs != null && ageMs > config.sweepStuckAgeDays * DAY_MS;
  const underFee =
    satPerVbyte != null && requestedSatPerVbyte != null && satPerVbyte < requestedSatPerVbyte;
  if (!attemptsBreach && !ageBreach && !underFee) return null;

  const severity: Severity = attempts >= config.sweepCriticalAttempts ? "critical" : "warn";

  // Evidence reflects the strongest firing reason: attempts > age > under-fee.
  let metric: string;
  let observed: number;
  let threshold: number;
  let unit: string;
  if (attemptsBreach) {
    metric = "sweepBroadcastAttempts";
    observed = attempts;
    threshold = config.sweepStuckAttempts;
    unit = "attempts";
  } else if (ageBreach) {
    metric = "sweepAgeHours";
    observed = (ageMs as number) / HOUR_MS;
    threshold = config.sweepStuckAgeDays * 24;
    unit = "hours";
  } else {
    metric = "sweepSatPerVbyte";
    observed = satPerVbyte as number;
    threshold = requestedSatPerVbyte as number;
    unit = "sat/vB";
  }

  const limboSat = toLimboSat(sweep.amountSat);
  const detail: Record<string, string | number> = {
    limboSat,
    outpoint: `${sweep.outpointTxid}:${sweep.outpointOutputIndex}`,
    attempts,
  };
  if (ageMs != null) detail.ageHours = ageMs / HOUR_MS;

  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    id: `stuck_sweep:${ctx.nodeMeta.pubkey}:${sweep.outpointTxid}:${sweep.outpointOutputIndex}`,
    severity,
    node: ctx.nodeMeta,
    target: {
      kind: "sweep",
      outpointTxid: sweep.outpointTxid,
      outpointOutputIndex: sweep.outpointOutputIndex,
    },
    signal: "stuck_sweep",
    evidence: {
      metric,
      observed,
      threshold,
      unit,
      window: SNAPSHOT_WINDOW,
      asOf: asOfIso(sweep.updatedAt, ctx.group, nowMs),
      deepLink: ctx.deepLink,
      detail,
    },
    suggestedAction: {
      type: "remediate_pending",
      params: {
        case: "bump_fee",
        channelPoint: null,
        outpointTxid: sweep.outpointTxid,
        suggestedSatPerVbyte: requestedSatPerVbyte,
      },
    },
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  };
}

function stuckOpenCard(
  row: PendingRow,
  ctx: NodeCtx,
  config: InsightKnobs,
  nowMs: number,
): InsightCard | null {
  const ageMs = ageMsOf(row.createdAt, row.ageMs, nowMs);
  if (ageMs == null || ageMs <= config.openStuckWarnHours * HOUR_MS) return null;

  const severity: Severity =
    ageMs > config.openStuckCriticalHours * HOUR_MS ? "critical" : "warn";
  const limboSat = toLimboSat(row.limboBalance);

  const detail: Record<string, string | number> = { limboSat, ageHours: ageMs / HOUR_MS };
  if (row.channelPoint != null) detail.channelPoint = row.channelPoint;

  return {
    schemaVersion: CARD_SCHEMA_VERSION,
    id: `stuck_open:${ctx.nodeMeta.pubkey}:${row.channelPoint ?? "channel"}`,
    severity,
    node: ctx.nodeMeta,
    target: {
      kind: "channel",
      chanId: null,
      channelPoint: row.channelPoint,
      remotePubkey: row.remoteNodePub,
    },
    signal: "stuck_open",
    evidence: {
      metric: "pendingOpenAgeHours",
      observed: ageMs / HOUR_MS,
      threshold: config.openStuckWarnHours,
      unit: "hours",
      window: SNAPSHOT_WINDOW,
      asOf: asOfIso(row.updatedAt, ctx.group, nowMs),
      deepLink: ctx.deepLink,
      detail,
    },
    suggestedAction: {
      type: "remediate_pending",
      params: {
        case: "aged_funding",
        channelPoint: row.channelPoint,
        outpointTxid: null,
        suggestedSatPerVbyte: null,
      },
    },
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  };
}
