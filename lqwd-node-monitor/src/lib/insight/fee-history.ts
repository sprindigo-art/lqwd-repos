import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// INSIGHT-06 — fee-policy HISTORY scan (stateless hysteresis source)
// =====================================================
// This is a legitimate HISTORY read over the event-driven
// `lnd_node_channel_info` table — a windowed per-channel SERIES scan
// (Pitfall 1). It is NEVER a latest-state read: current policy ALWAYS comes
// from the sanctioned AFM-001 DISTINCT ON reader in src/lib/read/latest.ts.
// Do not add DISTINCT ON here, and never use this module to answer "what is
// the channel's fee right now" — the shape test enforces both directions.
//
// Why history: D-07 keeps cards stateless, so the hysteresis "last policy
// change" must be RECONSTRUCTED from warehouse fee-rate snapshots
// (~3.7/day), not persisted. Window = feeMinIntervalHours × 2 at the call
// site so a change just outside the interval is still observable.
//
// LDK cadence caveat (RESEARCH Open Question 3): LDK rows flow through the
// same table, but the LDK collector's `outgoing_fee_rate_milli_msat`
// snapshot cadence is unverified. If sparse, min-interval degrades to
// "no observed change → pass" for LDK nodes (lastPolicyChange returns null).
// The per-backend knob surface stays in config.ts for when that settles.
//
// `windowHours` is parameter-BOUND (Drizzle sql template), never
// concatenated (T-04-18); the boundary compares against
// now() AT TIME ZONE 'UTC' because `timestamp` is an offset-less UTC
// wall-time column (WR-04). NULL chan_id rows are excluded — keyless
// snapshots cannot join a per-channel series (WR-01).

/** One fee-policy snapshot in a channel's chronological series. PPM stays RAW (AFM-002 at render only). */
export interface FeeSnapshot {
  timestamp: Date;
  ppm: number;
}

/** The most recent observed policy change in a window, or null when none observed. */
export interface PolicyChange {
  changedAt: Date;
  direction: "up" | "down";
}

/** Raw fee-history row as surfaced by raw .execute (offset-less UTC timestamp string). */
interface FeeHistoryRow {
  chan_id: string;
  local_pubkey: string;
  outgoing_fee_rate_milli_msat: string | number | null;
  timestamp: Date | string | null;
}

/**
 * Build the fleet-wide windowed fee-policy history scan. One row per
 * snapshot per channel, chronological within each chan_id — the hysteresis
 * series source, NOT a latest read (see banner).
 */
export function buildFeeHistorySql(windowHours: number): SQL {
  return sql`
    SELECT chan_id, local_pubkey, outgoing_fee_rate_milli_msat, timestamp
    FROM lnd_node_channel_info
    WHERE timestamp > (now() AT TIME ZONE 'UTC') - make_interval(hours => ${windowHours})
      AND chan_id IS NOT NULL
    ORDER BY chan_id, timestamp ASC
  `;
}

/**
 * Pure scan: the most recent value change in a chronological PPM series.
 * Returns null when no change is observed (empty/single-row series, or all
 * snapshots equal) — the LDK-sparse degradation is exactly this null
 * ("no observed change → pass").
 */
export function lastPolicyChange(series: FeeSnapshot[]): PolicyChange | null {
  let change: PolicyChange | null = null;
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].ppm;
    const curr = series[i].ppm;
    if (curr !== prev) {
      change = { changedAt: series[i].timestamp, direction: curr > prev ? "up" : "down" };
    }
  }
  return change;
}

/**
 * Fleet-wide per-channel fee-policy series for the hysteresis window.
 * Call-site convention: windowHours = feeMinIntervalHours × 2.
 */
export async function feeHistoryByChannel(windowHours: number): Promise<Map<string, FeeSnapshot[]>> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const result = await dbRouting.execute(buildFeeHistorySql(windowHours));
  const rows = result as unknown as FeeHistoryRow[];

  const byChannel = new Map<string, FeeSnapshot[]>();
  for (const row of rows) {
    // Skip rows the series cannot use: null fee snapshots carry no policy
    // value to diff; unparseable timestamps cannot order chronologically.
    if (row.outgoing_fee_rate_milli_msat == null) continue;
    const timestamp = parseDbTimestampUtc(row.timestamp);
    if (timestamp === null) continue;

    const series = byChannel.get(row.chan_id) ?? [];
    series.push({ timestamp, ppm: Number(row.outgoing_fee_rate_milli_msat) });
    byChannel.set(row.chan_id, series);
  }
  return byChannel;
}
