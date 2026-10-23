"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

// =====================================================
// ServiceWhyAccordion — the honest "why is this service not-green" panel (Client)
// =====================================================
// Gap B: a not-functioning/critical service used to render a bare X with no reason.
// This is the EXPANDABLE accordion (locked operator decision — not a tooltip, not an
// always-visible inline line) that reveals WHY a service is down when the operator
// clicks the row. The caller gates it: ONLY not-green (and non-no-data) rows are
// wrapped; green/healthy rows render their trigger bare with no accordion affordance.
//
// HONESTY LAW: the live LND fleet reports functioning=false with `detail=NULL` and
// `last_success_at=NULL`. When detail is null we render the honest fallback
// (NO_REASON_FALLBACK) plus the REAL error_count and last-success age — we NEVER
// fabricate a cause. A null last-success reads "never", never a fake "0s ago".
//
// TwoAxisPip is LOCKED — this wraps a trigger at the grid level, it does not touch it.
// The chevron is an AFFORDANCE (expand/collapse), not a STATE icon — allowed under the
// NOC "no icons/dots for state" rule. `defaultOpen` mirrors NodeFeeEnqueue so the
// dep-free render-test can assert the expanded markup (no jsdom).

/** Honest fallback shown when the probe supplies no reason — NEVER a fabricated cause. */
export const NO_REASON_FALLBACK = "Probe reported no reason";

export interface ServiceWhyAccordionProps {
  /** Probe-supplied reason; NULL for the live LND fleet → the honest fallback renders. */
  detail: string | null;
  /** Inventory-side detection_method (systemd/probe/…) — rendered as a mono chip when present. */
  detectionMethod: string | null;
  /** Raw trailing-window error count (honest figure). */
  errorCount: number;
  /** Last successful run; NULL → "never" (not a fake timestamp). */
  lastSuccessAt: Date | null;
  /** Per-service functioning-staleness flag → the functioning-stale indicator. */
  functioningStale: boolean;
  /** Collector-freshness flag → the collector-stale indicator (separate clock). */
  collectorStale: boolean;
  /** Render clock for the last-success age. */
  nowMs: number;
  /** The trigger row (the not-green service tile/line) — always rendered. */
  children: ReactNode;
  /** Open on first paint — the render-test hook (mirrors NodeFeeEnqueue). */
  defaultOpen?: boolean;
}

/** Humanize a Date into a short "…ago" age string; null → "never" (self-contained, no server import). */
function relativeAge(date: Date | null, nowMs: number): string {
  if (date === null) return "never";
  const deltaMs = Math.max(0, nowMs - date.getTime());
  const sec = Math.round(deltaMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

/** One label/value row in the why-panel — mono value with a conditional color. */
function WhyRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10.5px] whitespace-nowrap text-df-muted uppercase tracking-[0.04em]">
        {label}
      </span>
      <span
        className={cn(
          "font-df-mono text-[11px] font-semibold tabular-nums",
          valueClassName ?? "text-df-muted"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Expandable why-panel for a not-green service row. Clicking the trigger toggles an
 * inline bordered inset that names the reason (probe detail verbatim, else the honest
 * fallback), the detection method, the real error count, the last-success age ("never"
 * when null), and the functioning/collector-stale indicators. Green/no-data gating is
 * the CALLER's responsibility — this component always renders its trigger.
 */
export function ServiceWhyAccordion({
  detail,
  detectionMethod,
  errorCount,
  lastSuccessAt,
  functioningStale,
  collectorStale,
  nowMs,
  children,
  defaultOpen,
}: ServiceWhyAccordionProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  // Honest reason: the probe detail when it carries a real string; otherwise the
  // fallback — NEVER a fabricated cause (the live LND fleet reports detail=NULL).
  const reason = detail !== null && detail.trim() !== "" ? detail : NO_REASON_FALLBACK;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-1.5 text-left"
      >
        <Chevron
          className={
            "mt-1 size-3.5 flex-none text-df-faint" /* df-faint-ok: aria-hidden chevron glyph */
          }
          strokeWidth={2.4}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">{children}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-df-border-soft bg-df-surface-sub px-3 py-2.5">
          {/* Reason — probe detail verbatim, else the honest fallback. */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[9.5px] font-bold uppercase tracking-[0.05em] text-df-muted font-df-mono">
              Why
            </span>
            <span
              className={cn(
                "text-[12px] leading-snug",
                detail !== null && detail.trim() !== ""
                  ? "text-df-critical"
                  : "text-df-muted italic"
              )}
            >
              {reason}
            </span>
          </div>

          {detectionMethod !== null && detectionMethod.trim() !== "" && (
            <div className="flex items-center gap-2">
              <span className="text-[10.5px] whitespace-nowrap text-df-muted uppercase tracking-[0.04em]">
                detection
              </span>
              <span className="rounded-df-pill border border-df-border-soft px-2 py-0.5 font-df-mono text-[9.5px] font-semibold tracking-[0.04em] text-df-muted">
                {detectionMethod}
              </span>
            </div>
          )}

          <WhyRow
            label="errors · 1h"
            value={errorCount.toLocaleString("en-US")}
            valueClassName={
              errorCount > 5
                ? "text-df-critical"
                : errorCount > 0
                  ? "text-df-warning"
                  : "text-df-muted"
            }
          />

          <WhyRow
            label="last success"
            value={relativeAge(lastSuccessAt, nowMs)}
            valueClassName={lastSuccessAt === null ? "text-df-critical" : "text-df-muted"}
          />

          {(functioningStale || collectorStale) && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {functioningStale && (
                <span className="rounded-df-pill border border-df-stale-border bg-df-stale-tint px-2 py-0.5 font-df-mono text-[9px] font-bold uppercase tracking-[0.04em] text-df-stale-text">
                  functioning-stale
                </span>
              )}
              {collectorStale && (
                <span className="rounded-df-pill border border-df-stale-border bg-df-stale-tint px-2 py-0.5 font-df-mono text-[9px] font-bold uppercase tracking-[0.04em] text-df-stale-text">
                  collector-stale
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
