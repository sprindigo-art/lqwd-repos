import { latestChannelsForNode } from "@/lib/read/latest";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { feeMsatToSat, formatSats } from "@/lib/format/units";

// =====================================================
// Fees console tab — thin shaper over the AFM-001 sanctioned reader
// =====================================================
// ZERO new SQL: wraps latestChannelsForNode and derives the per-channel fee
// report (outgoing_fee_base_msat + outgoing_fee_rate_milli_msat) from rows
// already in hand. `outgoing_fee_rate_milli_msat` is msat-per-msat ×1e6 — i.e.
// it IS the PPM value; no conversion applies. Base-fee msat→sat conversion
// routes through units.ts feeMsatToSat (AFM-002); timestamps through
// parseDbTimestampUtc (WR-01). Raw bigint strings stay verbatim alongside the
// formatted displays (CSV-lossless, Pitfall 9).

/** One channel fee-policy row: raw strings (lossless) + formatted displays. */
export interface FeeRowView {
  chanId: string;
  remotePubkey: string | null;
  /** Raw bigint-as-string values, verbatim from the warehouse (CSV-lossless). */
  capacitySat: string | null;
  outgoingFeeBaseMsat: string | null;
  outgoingFeeRatePpm: string | null;
  /** Formatted displays. */
  capacityDisplay: string;
  baseFeeSatDisplay: string;
  feeRatePpmDisplay: string;
}

/** Summary-strip aggregates derived from the rows already in hand. */
export interface FeesStrip {
  count: number;
  /** Mean outgoing fee rate (ppm) over channels reporting a rate; null when none. */
  avgRatePpm: number | null;
  /** Mean outgoing base fee in sats (via feeMsatToSat); null when none reported. */
  avgBaseFeeSat: number | null;
}

/** The Fees tab view consumed by the page (03-06) and export route (03-07). */
export interface FeesTabView {
  strip: FeesStrip;
  rows: FeeRowView[];
  asOf: Date | null;
}

function rawStr(v: unknown): string | null {
  return v == null ? null : String(v);
}

/**
 * Pure shaper over latestChannelsForNode rows. Excludes closed channels.
 * Exported separately so the no-DB unit test can drive it with fixtures.
 */
export function shapeFeesTab(rows: Record<string, unknown>[]): FeesTabView {
  const open = rows.filter((r) => r.closed !== true);

  let rateSum = 0;
  let rateN = 0;
  let baseMsatSum = 0;
  let baseN = 0;
  let asOf: Date | null = null;

  const views: FeeRowView[] = open.map((r) => {
    const rate = r.outgoing_fee_rate_milli_msat;
    const base = r.outgoing_fee_base_msat;
    if (rate != null) {
      rateSum += Number(rate);
      rateN += 1;
    }
    if (base != null) {
      baseMsatSum += Number(base);
      baseN += 1;
    }

    const ts = parseDbTimestampUtc((r.timestamp ?? null) as Date | string | null);
    if (ts && (asOf === null || ts > asOf)) asOf = ts;

    return {
      chanId: String(r.chan_id ?? ""),
      remotePubkey: rawStr(r.remote_pubkey),
      capacitySat: rawStr(r.capacity),
      outgoingFeeBaseMsat: rawStr(base),
      outgoingFeeRatePpm: rawStr(rate),
      capacityDisplay: formatSats(Number(r.capacity ?? 0)),
      baseFeeSatDisplay: base == null ? "—" : String(feeMsatToSat(Number(base))),
      feeRatePpmDisplay: rate == null ? "—" : String(Number(rate)),
    };
  });

  return {
    strip: {
      count: views.length,
      avgRatePpm: rateN === 0 ? null : rateSum / rateN,
      avgBaseFeeSat: baseN === 0 ? null : feeMsatToSat(baseMsatSum / baseN),
    },
    rows: views,
    asOf,
  };
}

/** Fees tab data for one node — one sanctioned read, zero new SQL. */
export async function feesTabData(pubkey: string): Promise<FeesTabView> {
  const rows = await latestChannelsForNode(pubkey);
  return shapeFeesTab(rows);
}
