import { buildProvenance, csvCell, csvDocument, csvRow } from "@/lib/csv/serialize";
import { feeMsatToSat, formatSats } from "@/lib/format/units";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import type { ForwardRow } from "@/lib/console/forwards";
import type { ClosedChannelRow } from "@/lib/console/closes";
import type { ChannelRowView } from "@/lib/console/channels";
import type { FeeRowView } from "@/lib/console/fees";

// =====================================================
// NODE-02 CSV export assembly — per-table column specs (D-08/D-10)
// =====================================================
// Pure module: declares the ordered column spec for every EXPORTABLE_TABS
// table and assembles the full document through the 03-02 serialize.ts
// primitives. The route handler stays thin — everything testable lives here.
//
// D-08 column policy:
//   - Every table pairs FORMATTED values (sats via AFM-002 feeMsatToSat,
//     dates via parseDbTimestampUtc → ISO-8601 UTC) with the RAW source
//     columns verbatim (msat strings, epoch-ns strings, channel points,
//     pubkeys) — raw bigint-as-string values are NEVER coerced (lossless
//     audit; Number() would corrupt >2^53).
//   - escapeFormula: true on EVERY free-text column (peer aliases, lnd_alias,
//     warehouse text enums) — A5 escape-by-default; under-escaping is the
//     risk (T-03-15). Pattern-constrained raw numeric/hex columns stay
//     verbatim.
//   - The raw `fee` column is FORBIDDEN (AFM-002) and never exported.

/** One ordered export column: header + row accessor + escape policy. */
export interface ExportColumn<R> {
  header: string;
  source: (row: R) => string | null;
  escapeFormula: boolean;
}

/** Nanosecond-epoch string → ISO-8601 UTC (forwards time_utc formatted column). */
function nsToIsoUtc(ns: string | null): string | null {
  if (ns == null || ns === "") return null;
  const ms = Number(ns) / 1e6; // ns → ms (revenue.ts / forwards.ts precedent)
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Offset-less warehouse timestamp string → ISO-8601 UTC (WR-01). */
function dbTsToIsoUtc(ts: string | null): string | null {
  const d = parseDbTimestampUtc(ts);
  return d ? d.toISOString() : null;
}

/** msat string → sat string via the AFM-002 sanctioned conversion. */
function msatToSatStr(msat: string | null): string | null {
  if (msat == null || msat === "") return null;
  return String(feeMsatToSat(Number(msat)));
}

const FORWARDS_SPEC: ExportColumn<ForwardRow>[] = [
  { header: "time_utc", source: (r) => nsToIsoUtc(r.timestamp_ns), escapeFormula: false },
  { header: "timestamp_ns_raw", source: (r) => r.timestamp_ns, escapeFormula: false },
  { header: "chan_id_in_raw", source: (r) => r.chan_id_in, escapeFormula: false },
  { header: "chan_id_out_raw", source: (r) => r.chan_id_out, escapeFormula: false },
  { header: "peer_alias_in", source: (r) => r.peer_alias_in, escapeFormula: true },
  { header: "peer_alias_out", source: (r) => r.peer_alias_out, escapeFormula: true },
  { header: "amt_in_sat_raw", source: (r) => r.amt_in, escapeFormula: false },
  { header: "amt_out_sat_raw", source: (r) => r.amt_out, escapeFormula: false },
  { header: "amt_in_msat_raw", source: (r) => r.amt_in_msat, escapeFormula: false },
  { header: "amt_out_msat_raw", source: (r) => r.amt_out_msat, escapeFormula: false },
  { header: "fee_sat", source: (r) => msatToSatStr(r.fee_msat), escapeFormula: false },
  { header: "fee_msat_raw", source: (r) => r.fee_msat, escapeFormula: false },
  { header: "lnd_pubkey_raw", source: (r) => r.lnd_pubkey, escapeFormula: false },
];

const CLOSES_SPEC: ExportColumn<ClosedChannelRow>[] = [
  { header: "time_utc", source: (r) => dbTsToIsoUtc(r.timestamp), escapeFormula: false },
  { header: "timestamp_raw", source: (r) => r.timestamp, escapeFormula: false },
  { header: "chan_id_raw", source: (r) => r.chan_id, escapeFormula: false },
  { header: "channel_point_raw", source: (r) => r.channel_point, escapeFormula: false },
  { header: "closing_tx_hash_raw", source: (r) => r.closing_tx_hash, escapeFormula: false },
  { header: "remote_pubkey_raw", source: (r) => r.remote_pubkey, escapeFormula: false },
  { header: "lnd_alias", source: (r) => r.lnd_alias, escapeFormula: true },
  // Warehouse-controlled enums, but text → escape-by-default (A5).
  { header: "close_type", source: (r) => r.close_type, escapeFormula: true },
  { header: "open_initiator", source: (r) => r.open_initiator, escapeFormula: true },
  { header: "close_initiator", source: (r) => r.close_initiator, escapeFormula: true },
  { header: "close_height_raw", source: (r) => r.close_height, escapeFormula: false },
  { header: "capacity_display", source: (r) => fmtSats(r.capacity), escapeFormula: false },
  { header: "capacity_sat_raw", source: (r) => r.capacity, escapeFormula: false },
  { header: "settled_balance_display", source: (r) => fmtSats(r.settled_balance), escapeFormula: false },
  { header: "settled_balance_sat_raw", source: (r) => r.settled_balance, escapeFormula: false },
  { header: "time_locked_balance_sat_raw", source: (r) => r.time_locked_balance, escapeFormula: false },
];

/** Sat string → en-US display via AFM-002 formatSats; null stays null (no fabricated 0). */
function fmtSats(sat: string | null): string | null {
  if (sat == null || sat === "") return null;
  const n = Number(sat);
  if (!Number.isFinite(n)) return null;
  return formatSats(n);
}

const CHANNELS_SPEC: ExportColumn<ChannelRowView>[] = [
  { header: "chan_id_raw", source: (r) => r.chanId, escapeFormula: false },
  { header: "remote_pubkey_raw", source: (r) => r.remotePubkey, escapeFormula: false },
  { header: "channel_point_raw", source: (r) => r.channelPoint, escapeFormula: false },
  { header: "active", source: (r) => String(r.active), escapeFormula: false },
  { header: "capacity_display", source: (r) => r.capacityDisplay, escapeFormula: false },
  { header: "capacity_sat_raw", source: (r) => r.capacitySat, escapeFormula: false },
  { header: "local_balance_display", source: (r) => r.localBalanceDisplay, escapeFormula: false },
  { header: "local_balance_sat_raw", source: (r) => r.localBalanceSat, escapeFormula: false },
  { header: "remote_balance_display", source: (r) => r.remoteBalanceDisplay, escapeFormula: false },
  { header: "remote_balance_sat_raw", source: (r) => r.remoteBalanceSat, escapeFormula: false },
];

const FEES_SPEC: ExportColumn<FeeRowView>[] = [
  { header: "chan_id_raw", source: (r) => r.chanId, escapeFormula: false },
  { header: "remote_pubkey_raw", source: (r) => r.remotePubkey, escapeFormula: false },
  { header: "capacity_display", source: (r) => r.capacityDisplay, escapeFormula: false },
  { header: "capacity_sat_raw", source: (r) => r.capacitySat, escapeFormula: false },
  { header: "base_fee_sat", source: (r) => msatToSatStr(r.outgoingFeeBaseMsat), escapeFormula: false },
  { header: "fee_base_msat_raw", source: (r) => r.outgoingFeeBaseMsat, escapeFormula: false },
  // PPM is already in display units — no formatted twin (a duplicate column
  // would fake the D-08 formatted/raw pairing, IN-04). Raw stays verbatim.
  { header: "fee_rate_ppm_raw", source: (r) => r.outgoingFeeRatePpm, escapeFormula: false },
];

/** Per-table ordered column specs — one entry per EXPORTABLE_TABS key. */
export const EXPORT_SPECS = {
  channels: CHANNELS_SPEC,
  forwards: FORWARDS_SPEC,
  closes: CLOSES_SPEC,
  fees: FEES_SPEC,
} as const;

export type ExportTableKey = keyof typeof EXPORT_SPECS;

export interface AssembleCsvOptions {
  /** Table key from the URL — anything outside EXPORT_SPECS returns null (route → 404). */
  table: string;
  window: string;
  alias: string;
  pubkey: string;
  exportedAt: Date;
  dataAsOf: Date | null;
  /** Rows matching the table's spec row type (ForwardRow[], ClosedChannelRow[], ...). */
  rows: readonly unknown[];
}

/**
 * Assemble the full export document: D-10 provenance block → header row →
 * data rows, all through the sanctioned serialize.ts primitives. Pure and
 * unit-testable; returns null for an unknown table key.
 */
export function assembleCsv(opts: AssembleCsvOptions): string | null {
  if (!Object.prototype.hasOwnProperty.call(EXPORT_SPECS, opts.table)) return null;
  const spec = EXPORT_SPECS[opts.table as ExportTableKey] as readonly ExportColumn<unknown>[];

  const lines = [
    ...buildProvenance({
      alias: opts.alias,
      pubkey: opts.pubkey,
      table: opts.table,
      window: opts.window,
      exportedAt: opts.exportedAt,
      dataAsOf: opts.dataAsOf,
    }),
    csvRow(spec.map((c) => csvCell(c.header, { escapeFormula: false }))),
    ...opts.rows.map((row) =>
      csvRow(spec.map((c) => csvCell(c.source(row), { escapeFormula: c.escapeFormula }))),
    ),
  ];
  return csvDocument(lines);
}
