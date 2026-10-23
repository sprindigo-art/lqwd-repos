"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  severityAccent,
  severityLabel,
  severityVariants,
  type Severity,
} from "@/components/df/Severity";
import { FreshnessChip } from "@/components/df/FreshnessChip";
import { formatPercent, formatSats } from "@/lib/format/units";
import type { NodeFilterRow } from "@/lib/overview/node-filter";
import type { Backend } from "@/lib/read/nodes";
import { cn, FOCUS_RING } from "@/lib/utils";

// =====================================================
// NodesTable — sortable evidence table with at-risk row pop (NODE-03 · A3)
// =====================================================
// "use client" island: sorting is a PURE VIEW over the rows the RSC page already
// loaded + filtered — a header click re-orders in place, never a re-fetch. The
// loaded order (D-09 criticals-first) is preserved until the operator picks a
// sort column.
//
// DS-01 severity discipline: at-risk rows pop ONLY through the Severity ramp API
// (`severityAccent` left bar + `severityVariants` tint + `severityLabel` chip) —
// there is no `sev ===` class chain and NO navy class on an at-risk marker. Navy
// (`text-df-brand`) is STRUCTURE only: the active-sort-column indicator. Earned
// sats + liquidity ratio render exclusively through the AFM-002 unit formatters.

/** The serializable per-row shape the page builds from each `ScorecardView`. */
export interface NodeRow extends NodeFilterRow {
  pubkey: string;
  alias: string | null;
  backend: Backend;
  severity: Severity;
  stale: boolean;
  /** D-06 one-line "why" for an at-risk row. */
  reason: string | null;
  /** Worst-case freshness stamp (D-13) — drives the freshness chip. */
  asOf: Date | null;
  activeChannels: number | null;
  /** Outbound liquidity ratio 0..1 (local / capacity). */
  liquidityRatio: number | null;
  localSat: number | null;
  remoteSat: number | null;
  /** 7d forward count (the honest window the warehouse exposes). */
  forwards7d: number | null;
  /** 7d fee earnings in RAW sats. */
  earnings7dSat: number | null;
}

/** The severities that make a row "pop" (accent bar + tint) — Set, never a `sev ===` chain. */
const TINTED = new Set<Severity>(["critical", "warning", "stale"]);

/** Sort rank per severity — criticals first, honest stale last. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  warning: 1,
  watch: 2,
  healthy: 3,
  stale: 4,
};

type SortKey =
  | "alias"
  | "type"
  | "status"
  | "channels"
  | "liquidity"
  | "forwarding"
  | "lastSeen";

type SortDir = "asc" | "desc";

const TYPE_LABEL: Record<Backend, string> = {
  lnd: "LND routing",
  ldk: "LDK/LSP",
};

interface Column {
  key: SortKey;
  label: string;
  align: "left" | "right";
}

const COLUMNS: readonly Column[] = [
  { key: "alias", label: "Node", align: "left" },
  { key: "type", label: "Type", align: "left" },
  { key: "status", label: "Status", align: "left" },
  { key: "channels", label: "Active ch.", align: "right" },
  { key: "liquidity", label: "Local/remote", align: "left" },
  { key: "forwarding", label: "7d earnings", align: "right" },
  { key: "lastSeen", label: "Last seen", align: "left" },
];

/** Nulls always sort last regardless of direction. */
function compareNullable(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function valueFor(row: NodeRow, key: SortKey): number | string | null {
  switch (key) {
    case "alias":
      return (row.alias ?? row.pubkey).toLowerCase();
    case "type":
      return row.backend;
    case "status":
      return SEVERITY_RANK[row.severity];
    case "channels":
      return row.activeChannels;
    case "liquidity":
      return row.liquidityRatio;
    case "forwarding":
      return row.earnings7dSat;
    case "lastSeen":
      return row.asOf === null ? null : row.asOf.getTime();
  }
}

function sortRows(rows: NodeRow[], sort: { key: SortKey; dir: SortDir } | null): NodeRow[] {
  if (sort === null) return rows;
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = valueFor(x, sort.key);
    const b = valueFor(y, sort.key);
    if (typeof a === "string" && typeof b === "string") {
      return a.localeCompare(b) * factor;
    }
    return compareNullable(a as number | null, b as number | null) * factor;
  });
}

/** Short mono pubkey (first 8 · last 4) — never the full 66-hex line. */
function truncatePubkey(pubkey: string): string {
  return pubkey.length <= 14 ? pubkey : `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
}

/** A compact local/remote liquidity bar — neutral evidence viz (no severity hue). */
function LiquidityBar({ ratio }: { ratio: number | null }) {
  if (ratio === null) {
    return <span className="font-df-mono text-[11px] text-df-muted">—</span>;
  }
  const localPct = Math.min(100, Math.max(0, ratio * 100));
  return (
    <div className="flex items-center gap-2">
      <div
        className="flex h-2 w-24 overflow-hidden rounded-df-pill bg-df-border"
        aria-hidden="true"
      >
        <span className="h-full bg-df-muted" style={{ width: `${localPct.toFixed(1)}%` }} />
      </div>
      <span className="font-df-mono text-[11px] tabular-nums text-df-muted">
        {formatPercent(ratio)}
      </span>
    </div>
  );
}

export function NodesTable({ rows }: { rows: NodeRow[] }) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) => {
      if (prev === null || prev.key !== key) return { key, dir: "asc" };
      return prev.dir === "asc" ? { key, dir: "desc" } : null;
    });
  }

  return (
    <div className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
      <Table>
        <TableHeader>
          <TableRow className="border-df-border hover:bg-transparent">
            {COLUMNS.map((col) => {
              const active = sort?.key === col.key;
              return (
                <TableHead
                  key={col.key}
                  className={cn(
                    "font-df-mono text-[10.5px] font-bold tracking-[0.06em] text-df-muted uppercase",
                    col.align === "right" && "text-right",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      "inline-flex items-center gap-1 transition-colors hover:text-df-ink",
                      // Navy = STRUCTURE: the active sort column, never a state hue.
                      active && "text-df-brand",
                      col.align === "right" && "flex-row-reverse",
                    )}
                    aria-label={`Sort by ${col.label}`}
                  >
                    {col.label}
                    {active &&
                      (sort?.dir === "asc" ? (
                        <ArrowUp className="size-3" aria-hidden="true" />
                      ) : (
                        <ArrowDown className="size-3" aria-hidden="true" />
                      ))}
                  </button>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => {
            const tinted = TINTED.has(row.severity);
            const href = `/${row.pubkey}`;
            return (
              <TableRow
                key={row.pubkey}
                role="link"
                tabIndex={0}
                aria-label={`Open ${row.alias ?? truncatePubkey(row.pubkey)} detail`}
                onClick={() => router.push(href)}
                onKeyDown={(e) => {
                  // Keyboard parity with the mouse click-nav (audit F): Enter/Space
                  // navigates the whole row, matching the HostCard stretched-link.
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    router.push(href);
                  }
                }}
                className={cn(
                  "relative cursor-pointer border-df-border-soft",
                  FOCUS_RING,
                  tinted ? severityVariants({ sev: row.severity }) : "hover:bg-df-border-soft/40",
                )}
              >
                {/* Node — left severity accent bar (at-risk/stale) + alias + short pubkey + why. */}
                <TableCell className="relative py-3">
                  {tinted && (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-y-0 left-0 w-[3px]",
                        severityAccent[row.severity],
                      )}
                    />
                  )}
                  <Link
                    href={href}
                    onClick={(e) => e.stopPropagation()}
                    className="font-semibold text-df-ink hover:underline"
                  >
                    {row.alias ?? truncatePubkey(row.pubkey)}
                  </Link>
                  <div className="font-df-mono text-[10.5px] text-df-muted">
                    {truncatePubkey(row.pubkey)}
                  </div>
                  {tinted && row.reason !== null && (
                    <div className="mt-0.5 max-w-md text-[11.5px] text-df-muted">{row.reason}</div>
                  )}
                </TableCell>

                {/* Type. */}
                <TableCell className="font-df-mono text-[11.5px] text-df-muted">
                  {TYPE_LABEL[row.backend]}
                </TableCell>

                {/* Status — quiet dot for healthy/watch; severity chip for at-risk/stale. */}
                <TableCell>
                  {tinted ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-df-pill border px-2 py-0.5 font-df-mono text-[10px] font-bold tracking-[0.04em] uppercase",
                        severityVariants({ sev: row.severity }),
                      )}
                    >
                      <span
                        className={cn("size-1.5 flex-none rounded-full", severityAccent[row.severity])}
                        aria-hidden="true"
                      />
                      {severityLabel[row.severity]}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-df-mono text-[11px] text-df-muted">
                      <span
                        className={cn("size-1.5 flex-none rounded-full", severityAccent[row.severity])}
                        aria-hidden="true"
                      />
                      {severityLabel[row.severity].toLowerCase()}
                    </span>
                  )}
                </TableCell>

                {/* Active channels. */}
                <TableCell className="text-right font-df-mono text-[12px] tabular-nums text-df-ink">
                  {row.activeChannels ?? "—"}
                </TableCell>

                {/* Local/remote liquidity ratio (compact bar). */}
                <TableCell>
                  <LiquidityBar ratio={row.liquidityRatio} />
                </TableCell>

                {/* 7d forwarding — earned sats (AFM-002) + count. */}
                <TableCell className="text-right">
                  <div className="font-df-mono text-[12px] tabular-nums text-df-ink">
                    {row.earnings7dSat === null ? "—" : `${formatSats(row.earnings7dSat)} sat`}
                  </div>
                  <div className="font-df-mono text-[10.5px] text-df-muted">
                    {row.forwards7d === null ? "no forwards" : `${row.forwards7d} fwd`}
                  </div>
                </TableCell>

                {/* Last-seen freshness — honest, never faked-fresh. */}
                <TableCell>
                  <FreshnessChip asOf={row.asOf} stale={row.stale} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
