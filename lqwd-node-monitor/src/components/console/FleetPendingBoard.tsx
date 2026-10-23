"use client";

import { useState } from "react";

import type {
  FleetPendingSummary,
  PendingItemSummary,
  PendingTone,
} from "@/lib/console/pending-summary";
import { cn } from "@/lib/utils";

// =====================================================
// Fleet pending board — sketch 004 winner B (counts + drill-in)
// =====================================================
// Client Component: presentational only. All sat/duration formatting and the
// counts/totals already happened server-side in buildFleetPendingSummary — this
// owns nothing but expand/collapse UI state. Severity color appears ONLY on
// state (type chips, count chips, totals numbers); navy stays structural; no
// dots, no emoji, no icons (sketch 001 grammar). Zero counts render faint
// (zero-quiet, D-07/D-12).

const TONE_TEXT: Record<PendingTone, string> = {
  open: "text-df-ok-text",
  coop: "text-df-warning",
  force: "text-df-critical",
  muted: "text-df-muted",
};

const PANEL_HEAD =
  "flex items-center justify-between border-b border-df-border px-4 py-2 font-df-mono text-xs font-semibold tracking-[0.14em] text-df-muted uppercase";

function TypeChip({ chip, tone }: { chip: string; tone: PendingTone }) {
  return (
    <span className={cn("font-df-mono text-xs font-semibold tracking-[0.1em]", TONE_TEXT[tone])}>
      {chip}
    </span>
  );
}

/** One count chip in a node summary row; faint + dimmed when the count is 0. */
function CountChip({ n, label, tone }: { n: number; label: string; tone: PendingTone }) {
  const zero = n === 0;
  return (
    <span
      className={cn(
        "justify-self-end font-df-mono text-xs tracking-[0.08em] tabular-nums",
        zero ? "font-normal text-df-muted" : cn("font-semibold", TONE_TEXT[tone]),
      )}
    >
      {n} {label}
    </span>
  );
}

// Shared column track for the node summary row and every drill-in detail row,
// so type/channel/age/limbo/sweeps line up in clean verticals on both. The
// leading column holds the type chip (detail) or stays empty (handled inline).
const DRILL_COLS =
  "grid grid-cols-[4.5rem_minmax(0,1fr)_7rem_8.5rem_6rem] items-baseline gap-x-4";

function DrillItem({ item }: { item: PendingItemSummary }) {
  const [sweepOpen, setSweepOpen] = useState(false);
  const hasSweeps = item.sweeps !== null;

  return (
    <div className="border-b border-dashed border-df-border py-1.5 last:border-b-0">
      <div className={DRILL_COLS}>
        <TypeChip chip={item.chip} tone={item.tone} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-df-mono text-sm tabular-nums">{item.channelLabel}</span>
          {item.peerLabel !== null && (
            <span className="font-df-mono text-xs text-df-muted">→ {item.peerLabel}</span>
          )}
          {item.maturityLabel !== null && (
            <span className="font-df-mono text-xs text-df-muted">{item.maturityLabel}</span>
          )}
        </span>
        <span className="justify-self-end font-df-mono text-sm font-semibold tabular-nums">
          {item.ageLabel}
        </span>
        <span className="justify-self-end font-df-mono text-sm tabular-nums">{item.limboLabel}</span>
        {hasSweeps ? (
          <button
            type="button"
            onClick={() => setSweepOpen((v) => !v)}
            aria-expanded={sweepOpen}
            className="justify-self-end font-df-mono text-xs whitespace-nowrap text-df-brand underline-offset-4 hover:underline"
          >
            {item.sweeps!.count} sweep{item.sweeps!.count === 1 ? "" : "s"} {sweepOpen ? "▾" : "▸"}
          </button>
        ) : (
          <span className="justify-self-end font-df-mono text-xs text-df-muted">—</span>
        )}
      </div>

      {/* Expanded sweeps render full-width below the row, indented under the
          channel column — never inline, so the row grid stays aligned. */}
      {hasSweeps && sweepOpen && (
        <div className="mt-1 ps-[4.5rem] pe-2">
          {item.sweeps!.lines.map((l, i) => (
            <p key={i} className="font-df-mono text-xs leading-relaxed text-df-muted">
              {"↳ sweep "}
              {l.outpoint} · {l.broadcastAttempts} broadcast attempts · {l.amountLabel} · {l.feeLabel}
            </p>
          ))}
          <p className="font-df-mono text-xs text-df-muted">
            {item.sweeps!.count} sweeps · {item.sweeps!.totalLabel} total
          </p>
        </div>
      )}
    </div>
  );
}

function NodeRow({ node }: { node: FleetPendingSummary["nodes"][number] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-df-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="grid w-full grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_5.5rem_9rem_5rem] items-baseline gap-x-6 px-4 py-2.5 text-left transition-colors hover:bg-df-surface"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{node.alias ?? node.shortPubkey}</span>
          {node.alias !== null && (
            <span className="font-df-mono text-xs text-df-muted">{node.shortPubkey}</span>
          )}
        </span>
        <CountChip n={node.counts.open} label="OPEN" tone="open" />
        <CountChip n={node.counts.coop} label="COOP" tone="coop" />
        <CountChip n={node.counts.force} label="FORCE" tone="force" />
        <span className="justify-self-end font-df-mono text-sm tabular-nums">{node.limboLabel}</span>
        <span className="justify-self-end font-df-mono text-sm font-semibold tabular-nums">
          {node.oldestAgeLabel}
        </span>
      </button>
      {open && (
        <div className="border-t border-df-border bg-df-surface/40 px-4 py-2">
          {node.items.map((item) => (
            <DrillItem key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Single totals cell; the NUMBER wears the state color, zero-quiet (faint @ 0). */
function TotalStat({ label, value, tone }: { label: string; value: number; tone: PendingTone }) {
  return (
    <div className="flex flex-col gap-1.5 bg-df-surface px-4 py-3">
      <span className="font-df-mono text-xs font-semibold tracking-[0.16em] text-df-muted uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-df-mono text-xl font-semibold tabular-nums",
          value === 0 ? "text-df-muted" : TONE_TEXT[tone],
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function FleetPendingBoard({ summary }: { summary: FleetPendingSummary }) {
  return (
    <div className="flex flex-col gap-6">
      {/* Totals strip — answers "is fleet money stuck, how much" before scrolling. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-df-card border border-df-border bg-df-border sm:grid-cols-4">
        <TotalStat label="Opens" value={summary.totals.opens} tone="open" />
        <TotalStat label="Coop closes" value={summary.totals.coops} tone="coop" />
        <TotalStat label="Force closes" value={summary.totals.forces} tone="force" />
        <div className="flex flex-col gap-1.5 bg-df-surface px-4 py-3">
          <span className="font-df-mono text-xs font-semibold tracking-[0.16em] text-df-muted uppercase">
            Sat in limbo
          </span>
          <span className="font-df-mono text-xl font-semibold tabular-nums">
            {summary.totals.limboLabel}
          </span>
        </div>
      </div>

      {/* Node list — only nodes carrying pending render; click to drill in. */}
      <section className="overflow-hidden rounded-df-card border border-df-border bg-df-surface">
        <div className={PANEL_HEAD}>
          <span>Nodes with pending</span>
          <span className="tabular-nums">
            {summary.nodeCount} node{summary.nodeCount === 1 ? "" : "s"}
          </span>
        </div>
        {summary.nodes.map((node) => (
          <NodeRow key={node.pubkey} node={node} />
        ))}
      </section>
    </div>
  );
}
