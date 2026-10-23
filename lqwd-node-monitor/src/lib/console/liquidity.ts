import { latestChannelsForNode } from "@/lib/read/latest";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { formatSats } from "@/lib/format/units";

// =====================================================
// Liquidity console tab — thin shaper over the AFM-001 sanctioned reader
// =====================================================
// ZERO new SQL: wraps latestChannelsForNode and derives per-channel
// local/remote/capacity + local-ratio from rows already in hand. Liquidity
// covers ROUTABLE balance, so only ACTIVE, non-closed channels count (the
// Phase-2 liquidity dimension precedent: WHERE active AND NOT closed).
// Balances stay RAW sats — formatting routes through units.ts formatSats
// (AFM-002); timestamps through parseDbTimestampUtc (WR-01). Raw bigint
// strings stay verbatim alongside displays (CSV-lossless, Pitfall 9).

/** One channel liquidity row: raw strings (lossless) + formatted displays. */
export interface LiquidityRowView {
  chanId: string;
  remotePubkey: string | null;
  /** Raw bigint-as-string sat values, verbatim from the warehouse (CSV-lossless). */
  capacitySat: string | null;
  localBalanceSat: string | null;
  remoteBalanceSat: string | null;
  /** local_balance / capacity, 0..1 — null when capacity is 0 (no denominator ≠ 0%). */
  localRatio: number | null;
  /** Formatted displays. */
  capacityDisplay: string;
  localBalanceDisplay: string;
  remoteBalanceDisplay: string;
}

/** Summary-strip aggregates derived from the rows already in hand. */
export interface LiquidityStrip {
  totalLocalSat: number;
  totalRemoteSat: number;
  totalCapacitySat: number;
  /** Overall local share as a percentage (0..100); null when capacity sums to 0. */
  overallLocalPct: number | null;
  totalLocalDisplay: string;
  totalRemoteDisplay: string;
  totalCapacityDisplay: string;
}

/** The Liquidity tab view consumed by the page (03-06). */
export interface LiquidityTabView {
  strip: LiquidityStrip;
  rows: LiquidityRowView[];
  asOf: Date | null;
}

function rawStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

/**
 * Pure shaper over latestChannelsForNode rows — ACTIVE, non-closed channels
 * only (routable balance). Exported separately for the no-DB fixture test.
 */
export function shapeLiquidityTab(rows: Record<string, unknown>[]): LiquidityTabView {
  const routable = rows.filter((r) => r.active === true && r.closed !== true);

  let totalLocal = 0;
  let totalRemote = 0;
  let totalCapacity = 0;
  let asOf: Date | null = null;

  const views: LiquidityRowView[] = routable.map((r) => {
    const capacity = Number(r.capacity ?? 0);
    const local = Number(r.local_balance ?? 0);
    const remote = Number(r.remote_balance ?? 0);
    totalLocal += local;
    totalRemote += remote;
    totalCapacity += capacity;

    const ts = parseDbTimestampUtc((r.timestamp ?? null) as Date | string | null);
    if (ts && (asOf === null || ts > asOf)) asOf = ts;

    return {
      chanId: String(r.chan_id ?? ""),
      remotePubkey: rawStr(r.remote_pubkey),
      capacitySat: rawStr(r.capacity),
      localBalanceSat: rawStr(r.local_balance),
      remoteBalanceSat: rawStr(r.remote_balance),
      localRatio: capacity === 0 ? null : local / capacity,
      capacityDisplay: formatSats(capacity),
      localBalanceDisplay: formatSats(local),
      remoteBalanceDisplay: formatSats(remote),
    };
  });

  return {
    strip: {
      totalLocalSat: totalLocal,
      totalRemoteSat: totalRemote,
      totalCapacitySat: totalCapacity,
      overallLocalPct: totalCapacity === 0 ? null : (totalLocal / totalCapacity) * 100,
      totalLocalDisplay: formatSats(totalLocal),
      totalRemoteDisplay: formatSats(totalRemote),
      totalCapacityDisplay: formatSats(totalCapacity),
    },
    rows: views,
    asOf,
  };
}

/** Liquidity tab data for one node — one sanctioned read, zero new SQL. */
export async function liquidityTabData(pubkey: string): Promise<LiquidityTabView> {
  const rows = await latestChannelsForNode(pubkey);
  return shapeLiquidityTab(rows);
}
