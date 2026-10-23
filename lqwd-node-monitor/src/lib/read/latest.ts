import { sql, type SQL } from "drizzle-orm";

import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// AFM-001 — the ONLY sanctioned latest-channel-state read
// =====================================================
// `lnd_node_channel_info` is EVENT-DRIVEN: every channel emits many rows over
// time. The latest state of each channel is its newest row PER chan_id.
//
//   ✅  SELECT DISTINCT ON (chan_id) ... ORDER BY chan_id, timestamp DESC
//   ❌  WHERE timestamp = (SELECT greatest-timestamp ...)   ← returns ~1 row, NOT 480
//
// The greatest-timestamp form is the documented Canada failure (480 channels
// read as 1). NEVER take the single newest timestamp across an event-driven
// warehouse table — always DISTINCT ON the per-channel key.
// This module is the single centralized path so that mistake cannot reappear in
// a consumer. `localPubkey` is ALWAYS parameter-bound (Drizzle `sql` template),
// never string-concatenated (SQL-injection mitigation, T-03-02).

// PERF-01 recency bound (T-18-15). `lnd_node_channel_info` is event-driven: every
// channel emits many rows over time, so an unbounded DISTINCT ON (chan_id) scans
// the node's ENTIRE channel history + sorts it. Bounding to the last 30 days keeps
// only channels with a row in the window — tied by VALUE to STALENESS_CUTOFF_DAYS
// (freshness-cutoff.ts): any channel with NO row in 30 days belongs to a node that
// is itself eliminated from the overview/vitals, so dropping it here changes
// nothing THERE. The one exception — a >30d-stale channel on a live node's detail
// page — is preserved by the single-channel `buildLatestChannelSql` fallback. Kept
// free of the pure freshness-cutoff import so the no-DB shape test's graph stays tiny.
const CHANNEL_INFO_WINDOW_DAYS = 30;

/**
 * Build the AFM-001 DISTINCT ON (chan_id) latest-per-channel fragment for one
 * node, bounded to the last CHANNEL_INFO_WINDOW_DAYS (PERF-01). Exposed
 * separately so the no-DB shape test can assert the emitted SQL without a live
 * warehouse connection. `localPubkey` is bound, not interpolated.
 */
export function buildLatestChannelsSql(localPubkey: string): SQL {
  // `chan_id IS NOT NULL` is REQUIRED: DISTINCT ON (chan_id) collapses every
  // NULL-key row into ONE output row — the AFM-001 "N-read-as-1" failure moved
  // from the timestamp dimension to the key dimension. Excluding NULL keys keeps
  // each real channel distinct even if the warehouse emits keyless rows (WR-01).
  // The `AT TIME ZONE 'UTC'` + make_interval idiom matches buildLatestNodeInfoAllSql
  // (node-info.ts) — the DISTINCT ON shape is UNCHANGED, this only ADDS a recency
  // predicate (never the AFM-001 MAX-timestamp form).
  return sql`
    SELECT DISTINCT ON (chan_id) *
    FROM lnd_node_channel_info
    WHERE local_pubkey = ${localPubkey}
      AND chan_id IS NOT NULL
      AND timestamp > (now() AT TIME ZONE 'UTC') - make_interval(days => ${CHANNEL_INFO_WINDOW_DAYS})
    ORDER BY chan_id, timestamp DESC
  `;
}

/**
 * Single-channel fallback: the latest row for ONE channel with NO recency window
 * (mirrors the single-node `latestNodeInfo` fallback). The windowed fleet read
 * above drops a >30-day-stale channel; the per-channel detail path uses this to
 * still resolve that channel's latest state (no detail regression, PERF-01).
 * Both `localPubkey` and `chanId` are bound, never interpolated.
 */
export function buildLatestChannelSql(localPubkey: string, chanId: string): SQL {
  return sql`
    SELECT *
    FROM lnd_node_channel_info
    WHERE local_pubkey = ${localPubkey}
      AND chan_id = ${chanId}
    ORDER BY timestamp DESC
    LIMIT 1
  `;
}

/**
 * Latest state of every channel for a node — the only sanctioned latest-state
 * read (AFM-001). Returns one row per chan_id (its newest row by timestamp).
 */
export async function latestChannelsForNode(localPubkey: string) {
  // Lazy import keeps the server-only `dbRouting` client (which constructs a
  // postgres() pool + requires env at module load) out of the no-DB shape test's
  // import graph. Importing this module for `buildLatestChannelsSql` alone must
  // NOT spin up a warehouse connection.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildLatestChannelsSql(localPubkey));
  // postgres-js returns the rows array directly; drizzle .execute surfaces it as-is.
  return result as unknown as Record<string, unknown>[];
}

/**
 * Latest state of ONE channel for a node, or null if unknown — the single-entity
 * fallback (PERF-01) the per-channel detail path uses when the windowed
 * {@link latestChannelsForNode} read has dropped a >30-day-stale channel.
 */
export async function latestChannelForNode(
  localPubkey: string,
  chanId: string,
): Promise<Record<string, unknown> | null> {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildLatestChannelSql(localPubkey, chanId));
  const rows = result as unknown as Record<string, unknown>[];
  return rows[0] ?? null;
}

// =====================================================
// D-05 — per-channel fee-baseline staleness (the 08-04 canary mitigation)
// =====================================================
// The 08-04 LQWD-Ireland canary set a fee off a MULTI-DAY-STALE channel snapshot
// (a Jan-14 row treated as "latest" for a live channel) — the B8 write path must
// visibly warn and force an explicit acknowledgement before an operator queues a
// fee against an old baseline. This threshold is the DETERMINISTIC trigger for
// that warning; it is pinned here (NOT left to consumer discretion) so the gate
// cannot silently drift.
//
// Why a NEW window and not one of the two existing ones:
//   • NOT `COLLECTOR_WINDOW_MS` (15 min, service-health.ts) — that answers "is
//     this fact fresh enough to SHOW?" for the ~15-min collector tick. Channel-
//     policy rows are NOT re-emitted every 15 min, so a 15-min gate would
//     false-warn on every normal collection interval and train the operator to
//     reflex-ack — defeating the D-05 guard entirely.
//   • NOT `STALENESS_CUTOFF_MS` (30 d, freshness-cutoff.ts) — that is the
//     monitoring-liveness ELIMINATOR ("is this entity alive enough to monitor at
//     all?"). It is far too loose for a fee DECISION: the Jan-14 canary snapshot
//     was multiple days stale and would sail through a 30-day window as "current".
//   • `FEE_BASELINE_STALE_MS = 6h` sits between them: long enough to survive
//     normal channel-policy collection gaps without nagging, short enough that a
//     multi-hour / multi-day-old baseline (the canary failure mode) trips the
//     warning. 6h matches the existing operator-facing warn cadence
//     (scorecard/config.ts → STALENESS.warnAfterHours = 6), keeping the "stale
//     enough to warn a human" semantics consistent across the app.
export const FEE_BASELINE_STALE_MS = 6 * 60 * 60 * 1000;

/**
 * LND default `time_lock_delta`. `lnd_node_channel_info` carries NO time-lock
 * column, so the fee-edit baseline exposes the LND default as the "current"
 * value (mirrors fee-signals' DEFAULT_TIME_LOCK_DELTA). The operator can still
 * edit it within the bounds gate before queueing.
 */
const DEFAULT_TIME_LOCK_DELTA = 80;

/**
 * Narrow, typed projection of one `latestChannelsForNode` row — the read-boundary
 * shape the B8 channels table + fee-queue consume. Freshness is derived from the
 * row's **`timestamp`** column (Drift 4 — NOT `collected_at`, which is a
 * service-health/telemetry column and does not exist on channel rows).
 */
export interface ChannelBaseline {
  chanId: string;
  channelPoint: string | null;
  /** Counterparty pubkey — `lnd_node_channel_info` carries no alias column. */
  peerPubkey: string | null;
  capacity: number | null;
  localBalance: number | null;
  remoteBalance: number | null;
  /** `outgoing_fee_rate_milli_msat` IS the PPM value; null stays null (≠ 0 PPM). */
  currentPpm: number | null;
  /** `outgoing_fee_base_msat`; null stays null (UNKNOWN ≠ a definite 0, T-18-14). */
  baseFeeMsat: number | null;
  timeLockDelta: number;
  active: boolean;
  /** The row's latest `timestamp` (Drift 4) — the honest per-channel freshness stamp. */
  timestamp: Date | null;
  /** D-05 gate: `(nowMs - timestamp) > FEE_BASELINE_STALE_MS`; null timestamp ⇒ true. */
  baselineStale: boolean;
}

/**
 * Map one untyped channel row to the typed {@link ChannelBaseline}. The staleness
 * derivation is deterministic and clock-injectable (`nowMs` defaults to
 * `Date.now()`) so the projection is testable without a wall clock. A null/absent
 * `timestamp` is treated as STALE (there is no honest current baseline to queue
 * against). PURE — no DB, no env — so it runs in the no-DB shape tests.
 */
export function projectChannelBaseline(
  row: Record<string, unknown>,
  nowMs: number = Date.now(),
): ChannelBaseline {
  const timestamp = parseDbTimestampUtc((row.timestamp ?? null) as Date | string | null);
  const baselineStale =
    timestamp === null ? true : nowMs - timestamp.getTime() > FEE_BASELINE_STALE_MS;
  const rate = row.outgoing_fee_rate_milli_msat;
  return {
    chanId: String(row.chan_id ?? ""),
    channelPoint: row.channel_point == null ? null : String(row.channel_point),
    peerPubkey: row.remote_pubkey == null ? null : String(row.remote_pubkey),
    capacity: row.capacity == null ? null : Number(row.capacity),
    localBalance: row.local_balance == null ? null : Number(row.local_balance),
    remoteBalance: row.remote_balance == null ? null : Number(row.remote_balance),
    currentPpm: rate == null ? null : Number(rate),
    // null-is-not-zero (T-18-14): an unknown base fee stays null — showing it as a
    // definite 0 msat would misrepresent the channel's live policy to the operator.
    baseFeeMsat: row.outgoing_fee_base_msat == null ? null : Number(row.outgoing_fee_base_msat),
    timeLockDelta: DEFAULT_TIME_LOCK_DELTA,
    active: row.active === true,
    timestamp,
    baselineStale,
  };
}
