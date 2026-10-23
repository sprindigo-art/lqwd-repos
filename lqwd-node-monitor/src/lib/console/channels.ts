import { latestChannelsForNode } from "@/lib/read/latest";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { formatSats } from "@/lib/format/units";

// =====================================================
// Channels console tab — thin shaper over the AFM-001 sanctioned reader
// =====================================================
// ZERO new SQL: this module wraps latestChannelsForNode (the ONLY sanctioned
// latest-channel-state read) and derives the per-channel rows + summary strip
// from rows already in hand (RESEARCH Open Question 2 resolution — zero extra
// queries). Raw bigint values arrive as STRINGS from raw .execute and are kept
// verbatim alongside the formatted display strings (the CSV export route
// reuses these rows losslessly — Pitfall 9). All formatting routes through
// units.ts (AFM-002); all timestamps through parseDbTimestampUtc (WR-01).
//
// `remote_pubkey` is the counterparty identifier surfaced here —
// lnd_node_channel_info carries no alias column; alias enrichment lives in the
// Peers tab (peers.ts), keeping this shaper SQL-free.

/** One channel row: raw strings (lossless) + pre-formatted display strings. */
export interface ChannelRowView {
  chanId: string;
  remotePubkey: string | null;
  channelPoint: string | null;
  active: boolean;
  /** Raw bigint-as-string sat values, verbatim from the warehouse (CSV-lossless). */
  capacitySat: string | null;
  localBalanceSat: string | null;
  remoteBalanceSat: string | null;
  /** AFM-002 formatted displays (formatSats). */
  capacityDisplay: string;
  localBalanceDisplay: string;
  remoteBalanceDisplay: string;
}

/** Summary-strip aggregates derived from the rows already in hand. */
export interface ChannelsStrip {
  count: number;
  totalCapacitySat: number;
  totalLocalSat: number;
  totalRemoteSat: number;
  totalCapacityDisplay: string;
  totalLocalDisplay: string;
  totalRemoteDisplay: string;
}

/** The Channels tab view consumed by the page (03-06) and export route (03-07). */
export interface ChannelsTabView {
  strip: ChannelsStrip;
  rows: ChannelRowView[];
  asOf: Date | null;
}

function rawStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

/**
 * Pure shaper over latestChannelsForNode rows (snake_case records, bigints as
 * strings). Excludes closed channels; the active flag stays visible per row.
 * Exported separately so the no-DB unit test can drive it with fixtures.
 */
export function shapeChannelsTab(rows: Record<string, unknown>[]): ChannelsTabView {
  const open = rows.filter((r) => r.closed !== true);

  let totalCapacity = 0;
  let totalLocal = 0;
  let totalRemote = 0;
  let asOf: Date | null = null;

  const views: ChannelRowView[] = open.map((r) => {
    const capacity = Number(r.capacity ?? 0);
    const local = Number(r.local_balance ?? 0);
    const remote = Number(r.remote_balance ?? 0);
    totalCapacity += capacity;
    totalLocal += local;
    totalRemote += remote;

    const ts = parseDbTimestampUtc((r.timestamp ?? null) as Date | string | null);
    if (ts && (asOf === null || ts > asOf)) asOf = ts;

    return {
      chanId: String(r.chan_id ?? ""),
      remotePubkey: rawStr(r.remote_pubkey),
      channelPoint: rawStr(r.channel_point),
      active: r.active === true,
      capacitySat: rawStr(r.capacity),
      localBalanceSat: rawStr(r.local_balance),
      remoteBalanceSat: rawStr(r.remote_balance),
      capacityDisplay: formatSats(capacity),
      localBalanceDisplay: formatSats(local),
      remoteBalanceDisplay: formatSats(remote),
    };
  });

  return {
    strip: {
      count: views.length,
      totalCapacitySat: totalCapacity,
      totalLocalSat: totalLocal,
      totalRemoteSat: totalRemote,
      totalCapacityDisplay: formatSats(totalCapacity),
      totalLocalDisplay: formatSats(totalLocal),
      totalRemoteDisplay: formatSats(totalRemote),
    },
    rows: views,
    asOf,
  };
}

/** Channels tab data for one node — one sanctioned read, zero new SQL. */
export async function channelsTabData(pubkey: string): Promise<ChannelsTabView> {
  const rows = await latestChannelsForNode(pubkey);
  return shapeChannelsTab(rows);
}
