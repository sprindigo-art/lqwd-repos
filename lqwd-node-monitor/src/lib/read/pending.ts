import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// PENDING-01 — the ONLY sanctioned currently-pending read
// =====================================================
// `lnd_node_pending_channels` / `lnd_node_pending_sweeps` are EVENT-DRIVEN,
// upsert-per-tick tables that RETAIN RESOLVED RESIDUE: a row stops updating
// when its item resolves but is never deleted (live-verified 2026-06-10:
// 1,790 / 2,019 rows, only ~63 / ~38 currently pending).
//
//   ✅  updated_at > now() - make_interval(hours => $recency)   ← "currently pending"
//   ❌  bare SELECT                                  ← months of residue shown as live
//
// Channels additionally need DISTINCT ON (channel_point) — 142 duplicate
// channel_points exist (channels that re-entered pending) and without it limbo
// double-counts — with the channel_point IS NOT NULL guard (WR-01: DISTINCT ON
// collapses NULL keys to one row). Sweeps are one-row-per-outpoint (verified) —
// no DISTINCT ON. Identity columns differ per table: channels partition on
// local_pubkey, sweeps on lnd_pubkey (live-introspection-corrected, Pitfall 2).
// All scope params are parameter-bound Drizzle `sql` templates (T-03-01) —
// never string-concatenated. The recency filter's correctness is encoded as a
// live golden test (golden-pending.test.ts) against lnd_node_info.

/** The complete verified channel_state enum (live, 2026-06-10). */
export const PENDING_STATES = ["PENDING_OPEN", "WAITING_CLOSE", "FORCE_CLOSE"] as const;
export type PendingState = (typeof PENDING_STATES)[number];

/** A sweep, raw-execute coerced. bigint columns stay strings (lossless). */
export interface PendingSweepRow {
  lndPubkey: string | null;
  lndAlias: string | null;
  outpointTxid: string | null;
  outpointOutputIndex: number | null;
  amountSat: number | null;
  broadcastAttempts: number | null;
  nextBroadcastHeight: number | null;
  satPerVbyte: string | null;
  requestedSatPerVbyte: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  ageMs: number | null;
}

/** A pending channel row with its nested sweeps. limbo stays raw (render formats). */
export interface PendingRow {
  state: string; // verbatim channel_state (Pitfall 10 — source truth in the row)
  channelPoint: string | null;
  remoteNodePub: string | null;
  lndAlias: string | null;
  limboBalance: string | null; // raw string — AFM-002 formatting happens at render
  blocksTilMaturity: number | null;
  closingTxid: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  ageMs: number | null; // now − created_at (age anchor = first observed)
  sweeps: PendingSweepRow[]; // matched via closing_txid === outpoint_txid
}

/** Per-node group: sections always carry the three verified enum keys. */
export interface PendingNodeGroup {
  localPubkey: string;
  lndAlias: string | null;
  sections: Record<string, PendingRow[]>;
  unattachedSweeps: PendingSweepRow[]; // orphans — NEVER dropped (every sat accounted for)
  asOf: Date | null; // max updated_at across the node's rows + sweeps
}

/** The typed view both UI surfaces (/pending page + console tab) render verbatim. */
export interface PendingView {
  nodes: PendingNodeGroup[];
  asOf: Date | null; // max updated_at across all nodes
}

/**
 * Build the sanctioned currently-pending channels query. Fleet-wide when
 * `localPubkey` is omitted; per-node when provided (bound, never interpolated).
 */
export function buildCurrentPendingChannelsSql(recencyHours: number, localPubkey?: string): SQL {
  // channel_point IS NOT NULL: WR-01 NULL-key guard (DISTINCT ON collapses NULL keys)
  return localPubkey === undefined
    ? sql`
        SELECT DISTINCT ON (channel_point) *
        FROM lnd_node_pending_channels
        WHERE channel_point IS NOT NULL
          AND updated_at > now() - make_interval(hours => ${recencyHours})
        ORDER BY channel_point, updated_at DESC
      `
    : sql`
        SELECT DISTINCT ON (channel_point) *
        FROM lnd_node_pending_channels
        WHERE channel_point IS NOT NULL
          AND local_pubkey = ${localPubkey}
          AND updated_at > now() - make_interval(hours => ${recencyHours})
        ORDER BY channel_point, updated_at DESC
      `;
}

/**
 * Build the sanctioned currently-pending sweeps query. No DISTINCT ON —
 * one row per outpoint (verified). Identity column is lnd_pubkey (Pitfall 2).
 */
export function buildCurrentPendingSweepsSql(recencyHours: number, lndPubkey?: string): SQL {
  return lndPubkey === undefined
    ? sql`
        SELECT *
        FROM lnd_node_pending_sweeps
        WHERE updated_at > now() - make_interval(hours => ${recencyHours})
      `
    : sql`
        SELECT *
        FROM lnd_node_pending_sweeps
        WHERE lnd_pubkey = ${lndPubkey}
          AND updated_at > now() - make_interval(hours => ${recencyHours})
      `;
}

/** Currently-pending channels — the only sanctioned read of this table. */
export async function currentPendingChannels(recencyHours: number, localPubkey?: string) {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildCurrentPendingChannelsSql(recencyHours, localPubkey));
  return result as unknown as Record<string, unknown>[];
}

/** Currently-pending sweeps — the only sanctioned read of this table. */
export async function currentPendingSweeps(recencyHours: number, lndPubkey?: string) {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildCurrentPendingSweepsSql(recencyHours, lndPubkey));
  return result as unknown as Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Pure shaper — both UI surfaces render this output verbatim (T-02-07:
// no grouping/sorting/joining in JSX).
// ---------------------------------------------------------------------------

function str(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return v == null ? null : String(v);
}

function int(row: Record<string, unknown>, key: string): number | null {
  const v = row[key];
  return v == null ? null : Number(v);
}

function ts(row: Record<string, unknown>, key: string): Date | null {
  return parseDbTimestampUtc(row[key] as Date | string | null);
}

function toSweepRow(raw: Record<string, unknown>, now: Date): PendingSweepRow {
  const createdAt = ts(raw, "created_at");
  return {
    lndPubkey: str(raw, "lnd_pubkey"),
    lndAlias: str(raw, "lnd_alias"),
    outpointTxid: str(raw, "outpoint_txid"),
    outpointOutputIndex: int(raw, "outpoint_output_index"),
    amountSat: int(raw, "amount_sat"),
    broadcastAttempts: int(raw, "broadcast_attempts"),
    nextBroadcastHeight: int(raw, "next_broadcast_height"),
    satPerVbyte: str(raw, "sat_per_vbyte"),
    requestedSatPerVbyte: str(raw, "requested_sat_per_vbyte"),
    createdAt,
    updatedAt: ts(raw, "updated_at"),
    ageMs: createdAt ? now.getTime() - createdAt.getTime() : null,
  };
}

function toPendingRow(raw: Record<string, unknown>, now: Date): PendingRow {
  const createdAt = ts(raw, "created_at");
  return {
    state: str(raw, "channel_state") ?? "UNKNOWN",
    channelPoint: str(raw, "channel_point"),
    remoteNodePub: str(raw, "remote_node_pub"),
    lndAlias: str(raw, "lnd_alias"),
    limboBalance: str(raw, "limbo_balance"),
    blocksTilMaturity: int(raw, "blocks_til_maturity"),
    closingTxid: str(raw, "closing_txid"),
    createdAt,
    updatedAt: ts(raw, "updated_at"),
    ageMs: createdAt ? now.getTime() - createdAt.getTime() : null,
    sweeps: [],
  };
}

function emptySections(): Record<string, PendingRow[]> {
  return { PENDING_OPEN: [], WAITING_CLOSE: [], FORCE_CLOSE: [] };
}

function groupFor(
  groups: Map<string, PendingNodeGroup>,
  pubkey: string,
  alias: string | null,
): PendingNodeGroup {
  let g = groups.get(pubkey);
  if (!g) {
    g = { localPubkey: pubkey, lndAlias: alias, sections: emptySections(), unattachedSweeps: [], asOf: null };
    groups.set(pubkey, g);
  }
  if (g.lndAlias == null && alias != null) g.lndAlias = alias;
  return g;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (a == null) return b;
  if (b == null) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

const byCreatedAtAsc = (a: { createdAt: Date | null }, b: { createdAt: Date | null }) =>
  (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);

/**
 * Shape raw currently-pending rows + sweeps into the grouped view (D-13):
 * per-node groups, sections by verbatim channel_state, oldest-first within
 * each, sweeps nested under their force-close via closing_txid === outpoint_txid,
 * orphan sweeps retained per node, asOf = max updated_at over the scope.
 * Pure and unit-testable — `now` is injectable for deterministic age math.
 */
export function buildPendingView(
  rows: Record<string, unknown>[],
  sweeps: Record<string, unknown>[],
  now: Date = new Date(),
): PendingView {
  const groups = new Map<string, PendingNodeGroup>();
  const byTxid = new Map<string, PendingRow>();

  for (const raw of rows) {
    const pubkey = str(raw, "local_pubkey") ?? "unknown";
    const g = groupFor(groups, pubkey, str(raw, "lnd_alias"));
    const row = toPendingRow(raw, now);
    (g.sections[row.state] ??= []).push(row);
    if (row.closingTxid) byTxid.set(row.closingTxid, row);
    g.asOf = maxDate(g.asOf, row.updatedAt);
  }

  for (const raw of sweeps) {
    const sweep = toSweepRow(raw, now);
    const pubkey = sweep.lndPubkey ?? "unknown";
    const g = groupFor(groups, pubkey, sweep.lndAlias);
    const parent = sweep.outpointTxid ? byTxid.get(sweep.outpointTxid) : undefined;
    if (parent) parent.sweeps.push(sweep);
    else g.unattachedSweeps.push(sweep); // orphan — render, never drop
    g.asOf = maxDate(g.asOf, sweep.updatedAt);
  }

  let fleetAsOf: Date | null = null;
  const nodes = [...groups.values()].sort((a, b) =>
    (a.lndAlias ?? a.localPubkey).localeCompare(b.lndAlias ?? b.localPubkey),
  );
  for (const g of nodes) {
    for (const key of Object.keys(g.sections)) g.sections[key].sort(byCreatedAtAsc);
    g.unattachedSweeps.sort(byCreatedAtAsc);
    for (const section of Object.values(g.sections)) {
      for (const row of section) row.sweeps.sort(byCreatedAtAsc);
    }
    fleetAsOf = maxDate(fleetAsOf, g.asOf);
  }

  return { nodes, asOf: fleetAsOf };
}
