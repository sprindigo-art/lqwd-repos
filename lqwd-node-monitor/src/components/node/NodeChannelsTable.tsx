import Link from "next/link";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FreshnessChip } from "@/components/df/FreshnessChip";
import { feeMsatToSat, formatPercent, formatSats } from "@/lib/format/units";
import { resolveChannelEnqueueProps } from "@/lib/queue/channel-enqueue-props";
import type { ChannelBaseline } from "@/lib/read/latest";
import { cn } from "@/lib/utils";

import { NodeFeeEnqueue } from "./NodeFeeEnqueue";
import { WithdrawAffordance } from "./WithdrawAffordance";

// =====================================================
// NodeChannelsTable — the B8 all-channels + per-channel fee-queue table (Server)
// =====================================================
// The direct fix for the 08-04 LQWD-Ireland canary (rec-card-only enqueue → 3×
// channel mis-targeting off a stale snapshot with no clean revert). It lists ALL
// of a node's channels with honest per-row freshness (from the row `timestamp`
// column, Drift 4) and gives each LND-backed row a per-channel, no-AI fee-queue
// control pre-targeted to THAT chan_id.
//
// Server Component: the per-row backend gate (resolveChannelEnqueueProps is
// server-only, T-02-02) is resolved here, and only serializable props cross to the
// client leaves — NodeFeeEnqueue (the forked fee-queue leaf) and WithdrawAffordance
// (the D-01 undo). LDK rows render policy READ-ONLY (no queue control). All sat/ppm
// values render via AFM-002 (units.ts) — no inline unit math.

/** Short mono chan_id (first 6 · last 4). */
function truncateChanId(chanId: string): string {
  return chanId.length <= 12 ? chanId : `${chanId.slice(0, 6)}…${chanId.slice(-4)}`;
}

/** Short mono pubkey (first 8 · last 4). */
function truncatePubkey(pubkey: string): string {
  return pubkey.length <= 14 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/** Relative-age label ("7h", "3d") for the stale-baseline warning copy. */
function relativeAgeLabel(asOf: Date | null, now: Date): string | undefined {
  if (asOf === null) return undefined;
  const seconds = Math.max(0, Math.floor((now.getTime() - asOf.getTime()) / 1000));
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Outbound liquidity ratio 0..1 (local / capacity), or null when unknowable. */
function liquidityRatio(row: ChannelBaseline): number | null {
  if (row.capacity == null || row.capacity <= 0 || row.localBalance == null) return null;
  return row.localBalance / row.capacity;
}

/** A compact local/remote liquidity bar — neutral evidence viz (no severity hue). */
function LiquidityBar({ ratio }: { ratio: number | null }) {
  if (ratio === null) {
    return <span className="font-df-mono text-[11px] text-df-muted">—</span>;
  }
  const localPct = Math.min(100, Math.max(0, ratio * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 w-16 overflow-hidden rounded-df-pill bg-df-border" aria-hidden="true">
        <span className="h-full bg-df-muted" style={{ width: `${localPct.toFixed(1)}%` }} />
      </div>
      <span className="font-df-mono text-[11px] tabular-nums text-df-muted">
        {formatPercent(ratio)}
      </span>
    </div>
  );
}

const COLUMNS: readonly { label: string; align: "left" | "right" }[] = [
  { label: "Channel", align: "left" },
  { label: "Peer", align: "left" },
  { label: "Capacity", align: "right" },
  { label: "Local/remote", align: "left" },
  { label: "Fee policy", align: "left" },
  { label: "State", align: "left" },
  { label: "Baseline", align: "left" },
  { label: "Fee queue", align: "left" },
];

interface NodeChannelsTableProps {
  /** The owning node — 66-hex; used for the server-side backend gate. */
  pubkey: string;
  /** Display alias / fallback pubkey for the enqueue preview node row. */
  nodeLabel: string;
  /** The Task-1 typed projection for every channel on the node. */
  rows: ChannelBaseline[];
  /**
   * chanId → approved-but-unclaimed command id. A row with an entry here reflects
   * a pending-approved intent and mounts the WithdrawAffordance (the D-01 undo).
   */
  approvedByChanId?: Record<string, string>;
  /**
   * Optional base href (e.g. `/${pubkey}/peers`) that turns each row's Peer cell
   * into a G2 interconnection link → `${peerHrefBase}?focus=${peerPubkey}`. When
   * omitted the Peer cell renders plain text (no regression for other callers).
   */
  peerHrefBase?: string;
  /** Reference "now" for freshness/age; defaults to `new Date()` (deterministic in tests). */
  now?: Date;
}

/** Default ordering: active channels first, then by capacity desc (deterministic). */
function orderRows(rows: ChannelBaseline[]): ChannelBaseline[] {
  return [...rows].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return (b.capacity ?? 0) - (a.capacity ?? 0);
  });
}

export function NodeChannelsTable({
  pubkey,
  nodeLabel,
  rows,
  approvedByChanId,
  peerHrefBase,
  now,
}: NodeChannelsTableProps) {
  const nowDate = now ?? new Date();

  // Honest empty state (verbatim UI-SPEC copy).
  if (rows.length === 0) {
    return (
      <div className="rounded-df-card border border-df-border bg-df-surface px-4 py-8 text-center">
        <p className="font-df-sans text-[15.5px] font-semibold text-df-ink">No channels on this node.</p>
        <p className="mt-1 font-df-sans text-[13px] text-df-muted">
          Nothing to queue a fee against yet.
        </p>
      </div>
    );
  }

  const ordered = orderRows(rows);

  return (
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
          {ordered.map((row) => {
            const affordance = resolveChannelEnqueueProps(row, pubkey, nodeLabel);
            const approvedId = approvedByChanId?.[row.chanId];
            // null-is-not-zero (T-18-14): an unknown base fee renders "—", never 0 sat.
            const baseFeeSat = row.baseFeeMsat == null ? null : feeMsatToSat(row.baseFeeMsat);
            return (
              <TableRow key={row.chanId} className="border-df-border-soft align-top">
                {/* Channel — mono truncated chan_id. */}
                <TableCell className="py-3 font-df-mono text-[12px] text-df-ink">
                  {truncateChanId(row.chanId)}
                </TableCell>

                {/* Peer — counterparty pubkey (no alias column on channel rows).
                    With peerHrefBase, the pubkey becomes a navy-structural G2 link
                    to that peer (channels → peer); otherwise plain text. */}
                <TableCell className="font-df-mono text-[11.5px] whitespace-normal break-words text-df-muted">
                  {row.peerPubkey === null ? (
                    "—"
                  ) : peerHrefBase !== undefined ? (
                    <Link
                      href={`${peerHrefBase}?focus=${row.peerPubkey}`}
                      className="text-df-brand hover:underline"
                    >
                      {truncatePubkey(row.peerPubkey)}
                    </Link>
                  ) : (
                    truncatePubkey(row.peerPubkey)
                  )}
                </TableCell>

                {/* Capacity (AFM-002). */}
                <TableCell className="text-right font-df-mono text-[12px] tabular-nums text-df-ink">
                  {row.capacity === null ? "—" : `${formatSats(row.capacity)} sat`}
                </TableCell>

                {/* Local/remote liquidity ratio (compact bar). */}
                <TableCell className="whitespace-normal break-words">
                  <LiquidityBar ratio={liquidityRatio(row)} />
                </TableCell>

                {/* Current fee policy — ppm / base (sat, AFM-002) / cltv. */}
                <TableCell className="font-df-mono text-[11.5px] whitespace-normal break-words tabular-nums text-df-muted">
                  <div>
                    {row.currentPpm === null ? "— ppm" : `${row.currentPpm.toLocaleString("en-US")} ppm`}
                  </div>
                  <div className="text-[10.5px] text-df-muted">
                    base {baseFeeSat == null ? "—" : `${formatSats(baseFeeSat)} sat`} · cltv{" "}
                    {row.timeLockDelta}
                  </div>
                </TableCell>

                {/* Active / inactive. */}
                <TableCell className="font-df-mono text-[11px] text-df-muted">
                  {row.active ? "active" : "inactive"}
                </TableCell>

                {/* Honest per-channel freshness (from the row timestamp, Drift 4). */}
                <TableCell className="whitespace-normal break-words">
                  <FreshnessChip asOf={row.timestamp} stale={row.baselineStale} now={nowDate} />
                </TableCell>

                {/* Fee-queue action: LND → pre-targeted NodeFeeEnqueue; LDK → read-only. */}
                <TableCell>
                  {affordance.kind === "lnd" ? (
                    <>
                      <NodeFeeEnqueue
                        {...affordance.props}
                        baselineStale={affordance.baselineStale}
                        baselineAgeLabel={relativeAgeLabel(row.timestamp, nowDate)}
                      />
                      {approvedId !== undefined && <WithdrawAffordance commandId={approvedId} />}
                    </>
                  ) : (
                    <span className="font-df-mono text-[10.5px] text-df-muted">
                      read-only (LDK)
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
