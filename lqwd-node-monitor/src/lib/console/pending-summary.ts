import type { PendingNodeGroup, PendingRow, PendingSweepRow, PendingView } from "@/lib/read/pending";
import { formatSats } from "@/lib/format/units";

// =====================================================
// Fleet pending summary — pure server-side shaper for the /pending board
// (sketch 004 winner B: counts + drill-in)
// =====================================================
// buildPendingView() hands the canonical, already-sorted view (T-02-07 — node
// order alphabetical-by-alias, rows oldest-first within section). This shaper
// does NOT re-order any of that. It derives DISPLAY aggregates (per-type counts,
// per-node limbo totals + oldest age, fleet totals) and pre-formats every sat
// and duration through the sanctioned helpers, so the client board ships only
// plain serializable strings/numbers — no Date objects, no formatting logic,
// and no sat/BTC math cross the RSC→client boundary.
//
// Every sat is accounted for: unattached (orphan) sweeps and unexpected
// channel_state keys both surface as their own items and feed the totals.

const LOCKED = {
  PENDING_OPEN: { chip: "OPEN", tone: "open" },
  WAITING_CLOSE: { chip: "COOP", tone: "coop" },
  FORCE_CLOSE: { chip: "FORCE", tone: "force" },
} as const;

const LOCKED_KEYS: ReadonlySet<string> = new Set(Object.keys(LOCKED));

export type PendingTone = "open" | "coop" | "force" | "muted";

export interface PendingSweepLine {
  /** "txid…:vout" or "—" */
  outpoint: string;
  broadcastAttempts: string;
  amountLabel: string;
  feeLabel: string;
}

export interface PendingItemSummary {
  /** Stable key for React lists. */
  key: string;
  /** Uppercase type chip text (OPEN / COOP / FORCE / SWEEPS / raw state). */
  chip: string;
  tone: PendingTone;
  /** Verbatim channel_state, or "" for the unattached-sweeps pseudo-item. */
  state: string;
  /** Truncated channel point, or the orphan-sweep descriptor. */
  channelLabel: string;
  /** Short remote pubkey, or null. */
  peerLabel: string | null;
  ageLabel: string;
  limboLabel: string;
  /** "144 blocks til maturity" or null. */
  maturityLabel: string | null;
  /** Folded sweeps for this item, or null when none. */
  sweeps: {
    count: number;
    totalLabel: string;
    lines: PendingSweepLine[];
  } | null;
}

export interface PendingNodeSummary {
  pubkey: string;
  alias: string | null;
  shortPubkey: string;
  counts: { open: number; coop: number; force: number; sweeps: number };
  limboLabel: string;
  /** Oldest pending CHANNEL age in the node, or "—" when only sweeps exist. */
  oldestAgeLabel: string;
  items: PendingItemSummary[];
}

export interface FleetPendingSummary {
  totals: {
    opens: number;
    coops: number;
    forces: number;
    limboLabel: string;
  };
  /** Number of nodes carrying any pending (already alphabetical, verbatim). */
  nodeCount: number;
  nodes: PendingNodeSummary[];
}

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/** Durations only — no sat/BTC math (AFM-002 lives in units.ts). */
function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "—";
  if (ageMs < MS_PER_MINUTE) return "<1m";
  const days = Math.floor(ageMs / MS_PER_DAY);
  const hours = Math.floor((ageMs % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ageMs % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Raw warehouse numeric-string → "1,234 sat" via the sanctioned formatter. */
function satsLabel(value: string | number | null): string {
  if (value === null) return "—";
  return `${formatSats(Number(value))} sat`;
}

function shortHex(hex: string): string {
  return hex.length > 16 ? `${hex.slice(0, 8)}…${hex.slice(-6)}` : hex;
}

/** "txid:vout" → truncated txid, vout kept (the operator-recognizable part). */
function shortChannelPoint(channelPoint: string): string {
  const sep = channelPoint.lastIndexOf(":");
  if (sep === -1) return shortHex(channelPoint);
  return `${shortHex(channelPoint.slice(0, sep))}${channelPoint.slice(sep)}`;
}

function sweepOutpoint(sweep: PendingSweepRow): string {
  if (!sweep.outpointTxid) return "—";
  const txid = shortHex(sweep.outpointTxid);
  return sweep.outpointOutputIndex !== null ? `${txid}:${sweep.outpointOutputIndex}` : txid;
}

function sweepFee(sweep: PendingSweepRow): string {
  const base = sweep.satPerVbyte !== null ? `${sweep.satPerVbyte} sat/vB` : "— sat/vB";
  return sweep.requestedSatPerVbyte !== null ? `${base} (req ${sweep.requestedSatPerVbyte})` : base;
}

function foldSweeps(sweeps: PendingSweepRow[]): PendingItemSummary["sweeps"] {
  if (sweeps.length === 0) return null;
  const total = sweeps.reduce((sum, s) => sum + (s.amountSat ?? 0), 0);
  return {
    count: sweeps.length,
    totalLabel: satsLabel(total),
    lines: sweeps.map((s) => ({
      outpoint: sweepOutpoint(s),
      broadcastAttempts: s.broadcastAttempts !== null ? String(s.broadcastAttempts) : "—",
      amountLabel: satsLabel(s.amountSat),
      feeLabel: sweepFee(s),
    })),
  };
}

function rowItem(row: PendingRow, key: string): PendingItemSummary {
  const locked = LOCKED_KEYS.has(row.state)
    ? LOCKED[row.state as keyof typeof LOCKED]
    : { chip: row.state, tone: "muted" as const };
  return {
    key,
    chip: locked.chip,
    tone: locked.tone,
    state: row.state,
    channelLabel: row.channelPoint ? shortChannelPoint(row.channelPoint) : "—",
    peerLabel: row.remoteNodePub ? shortHex(row.remoteNodePub) : null,
    ageLabel: formatAge(row.ageMs),
    limboLabel: satsLabel(row.limboBalance),
    maturityLabel:
      row.blocksTilMaturity !== null && row.blocksTilMaturity > 0
        ? `${row.blocksTilMaturity} blocks til maturity`
        : null,
    sweeps: foldSweeps(row.sweeps),
  };
}

/** Orphan sweeps collapse into one pseudo-item so no sat is ever dropped. */
function unattachedItem(sweeps: PendingSweepRow[]): PendingItemSummary {
  const total = sweeps.reduce((sum, s) => sum + (s.amountSat ?? 0), 0);
  return {
    key: "unattached",
    chip: "SWEEPS",
    tone: "muted",
    state: "",
    channelLabel: "unattached · no parent force-close row",
    peerLabel: null,
    ageLabel: "—",
    limboLabel: satsLabel(total),
    maturityLabel: null,
    sweeps: foldSweeps(sweeps),
  };
}

function nodeSummary(node: PendingNodeGroup): PendingNodeSummary {
  const open = node.sections.PENDING_OPEN ?? [];
  const coop = node.sections.WAITING_CLOSE ?? [];
  const force = node.sections.FORCE_CLOSE ?? [];
  const extraKeys = Object.keys(node.sections).filter((k) => !LOCKED_KEYS.has(k));

  // Detail items in the locked presentation order; extras and orphan sweeps
  // follow so unexpected states and parentless sweeps stay visible (03-01).
  const items: PendingItemSummary[] = [];
  open.forEach((r, i) => items.push(rowItem(r, `open-${r.channelPoint ?? i}`)));
  coop.forEach((r, i) => items.push(rowItem(r, `coop-${r.channelPoint ?? i}`)));
  force.forEach((r, i) => items.push(rowItem(r, `force-${r.channelPoint ?? i}`)));
  for (const k of extraKeys) {
    (node.sections[k] ?? []).forEach((r, i) => items.push(rowItem(r, `${k}-${r.channelPoint ?? i}`)));
  }
  if (node.unattachedSweeps.length > 0) items.push(unattachedItem(node.unattachedSweeps));

  // Per-node limbo: channel limbo balances + orphan-sweep amounts (orphans are
  // not represented by any channel row, so they are additive, not double-count).
  let limbo = 0;
  for (const section of Object.values(node.sections)) {
    for (const r of section) limbo += Number(r.limboBalance ?? 0);
  }
  for (const s of node.unattachedSweeps) limbo += s.amountSat ?? 0;

  // Oldest age across CHANNELS only (sweeps carry no channel age anchor).
  let oldestMs: number | null = null;
  for (const section of Object.values(node.sections)) {
    for (const r of section) {
      if (r.ageMs !== null && (oldestMs === null || r.ageMs > oldestMs)) oldestMs = r.ageMs;
    }
  }

  return {
    pubkey: node.localPubkey,
    alias: node.lndAlias,
    shortPubkey: shortHex(node.localPubkey),
    counts: { open: open.length, coop: coop.length, force: force.length, sweeps: node.unattachedSweeps.length },
    limboLabel: satsLabel(limbo),
    oldestAgeLabel: formatAge(oldestMs),
    items,
  };
}

/**
 * Derive the fleet pending summary the /pending board renders. Pure: same view
 * in → same summary out, no DB, no Dates leak, all sats pre-formatted.
 */
export function buildFleetPendingSummary(view: PendingView): FleetPendingSummary {
  const nodes = view.nodes.map(nodeSummary);

  let opens = 0;
  let coops = 0;
  let forces = 0;
  let limbo = 0;
  for (const node of view.nodes) {
    opens += node.sections.PENDING_OPEN?.length ?? 0;
    coops += node.sections.WAITING_CLOSE?.length ?? 0;
    forces += node.sections.FORCE_CLOSE?.length ?? 0;
    for (const section of Object.values(node.sections)) {
      for (const r of section) limbo += Number(r.limboBalance ?? 0);
    }
    for (const s of node.unattachedSweeps) limbo += s.amountSat ?? 0;
  }

  return {
    totals: { opens, coops, forces, limboLabel: satsLabel(limbo) },
    nodeCount: nodes.length,
    nodes,
  };
}
