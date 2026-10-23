import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SummaryStrip } from "@/components/console/SummaryStrip";
import { feeMsatToSat, formatSats } from "@/lib/format/units";
import { cn } from "@/lib/utils";
import type { ForwardRow, ForwardsSummary } from "@/lib/console/forwards";

// =====================================================
// NodeForwardsTable — the windowed forwards event log (Server)
// =====================================================
// The G1 forwarding-history table lifted off the heavy single-scroll node page
// onto the routed /{pubkey}/forwards sub-route. Renders the console SummaryStrip
// (Forwards / Routed out / Fees earned / Avg fee) over a df table of the page's
// forward rows. Each non-null chan-in / chan-out is a `next/link` to the related
// channel on /{pubkey}/channels?chan={chanId} (G2 interconnection).
//
// Server Component: rows arrive PRE-QUERIED as props (forwardsPageData in the
// page) — this leaf never re-queries. AFM-002 HARD RULE: every sat value renders
// through `formatSats`, and the per-forward Fees-earned sats are derived from
// `fee_msat` via `feeMsatToSat` (the sanctioned helper) — the raw `fee` column is
// NEVER read here and no inline `/1000` msat/sat math happens at any call site.
// The Timestamp column converts `timestamp_ns` (ns) → ms via `/1e6` (a date render,
// not a sat unit — AFM-002 does not apply; this mirrors the forwards.ts asOf
// precedent). The navy-structural (df-brand) link treatment marks the chan cells as
// navigation (structure/action), never a severity hue.

/** Short mono chan_id (first 6 · last 4) — mirrors NodeChannelsTable. */
function truncateChanId(chanId: string): string {
  return chanId.length <= 12 ? chanId : `${chanId.slice(0, 6)}…${chanId.slice(-4)}`;
}

/** A chan cell: navy-structural link to the related channel, or a faint "—" when null. */
function ChanCell({ pubkey, chanId }: { pubkey: string; chanId: string | null }) {
  if (chanId === null) {
    return <span className="font-df-mono text-[11.5px] text-df-muted">—</span>;
  }
  return (
    <Link
      href={`/${pubkey}/channels?chan=${chanId}`}
      className="font-df-mono text-[12px] tabular-nums text-df-brand hover:underline"
    >
      {truncateChanId(chanId)}
    </Link>
  );
}

const COLUMNS: readonly { label: string; align: "left" | "right" }[] = [
  { label: "Chan in", align: "left" },
  { label: "Chan out", align: "left" },
  { label: "Amt out", align: "right" },
  { label: "Fees earned", align: "right" },
  { label: "Timestamp", align: "right" },
];

interface NodeForwardsTableProps {
  /** The owning node — 66-hex; the base of each row's chan → channels link. */
  pubkey: string;
  /** Pre-computed summary-strip aggregates (AFM-002 fee math already applied). */
  summary: ForwardsSummary;
  /** The page's forward rows (bigint columns are STRINGS — lossless). */
  rows: ForwardRow[];
}

export function NodeForwardsTable({ pubkey, summary, rows }: NodeForwardsTableProps) {
  // Honest empty state — the window holds no forwards.
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <SummaryStrip
          cells={[
            { label: "Forwards", value: String(summary.n) },
            { label: "Routed out", value: `${formatSats(summary.totalAmtOutSat)} sat` },
            { label: "Fees earned", value: `${formatSats(summary.totalFeesSat)} sat` },
            {
              label: "Avg fee",
              value: summary.avgFeeSat === null ? "—" : `${formatSats(summary.avgFeeSat)} sat`,
            },
          ]}
        />
        <div className="rounded-df-card border border-df-border bg-df-surface px-4 py-8 text-center">
          <p className="font-df-sans text-[15.5px] font-semibold text-df-ink">
            No forwards in this window.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SummaryStrip
        cells={[
          { label: "Forwards", value: String(summary.n) },
          { label: "Routed out", value: `${formatSats(summary.totalAmtOutSat)} sat` },
          { label: "Fees earned", value: `${formatSats(summary.totalFeesSat)} sat` },
          {
            label: "Avg fee",
            value: summary.avgFeeSat === null ? "—" : `${formatSats(summary.avgFeeSat)} sat`,
          },
        ]}
      />
      <div className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
        <Table>
          <TableHeader>
            <TableRow className="border-df-border hover:bg-transparent">
              {COLUMNS.map((col) => (
                <TableHead
                  key={col.label}
                  className={cn(
                    "font-df-mono text-[10.5px] font-bold tracking-[0.06em] text-df-muted uppercase",
                    col.align === "right" && "text-right",
                  )}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className="border-df-border-soft">
                {/* Chan in — navy-structural link to the related channel (G2). */}
                <TableCell className="py-3">
                  <ChanCell pubkey={pubkey} chanId={row.chan_id_in} />
                </TableCell>

                {/* Chan out — navy-structural link to the related channel (G2). */}
                <TableCell className="py-3">
                  <ChanCell pubkey={pubkey} chanId={row.chan_id_out} />
                </TableCell>

                {/* Amt out (AFM-002 — formatSats only, never inline math). */}
                <TableCell className="text-right font-df-mono text-[12px] tabular-nums text-df-ink">
                  {row.amt_out === null ? "—" : `${formatSats(Number(row.amt_out))} sat`}
                </TableCell>

                {/* Fees earned (AFM-002 — fee sats via feeMsatToSat, never raw fee / inline /1000). */}
                <TableCell className="text-right font-df-mono text-[12px] tabular-nums text-df-ink">
                  {row.fee_msat === null ? (
                    <span className="text-df-muted">—</span>
                  ) : (
                    `${formatSats(feeMsatToSat(Number(row.fee_msat)))} sat`
                  )}
                </TableCell>

                {/* Timestamp — ns → ms via /1e6 (forwards.ts asOf precedent); date render, not a sat unit. */}
                <TableCell className="text-right font-df-mono text-[12px] tabular-nums text-df-muted">
                  {new Date(Number(row.timestamp_ns) / 1e6).toLocaleString("en-US")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
