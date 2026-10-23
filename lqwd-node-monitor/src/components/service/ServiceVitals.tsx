import { EvidenceChart, EvidencePanel, type ChartThreshold } from "@/components/df/EvidenceChart";

// =====================================================
// C2 — ServiceVitals (SVC-02, Server)
// =====================================================
// The at-a-glance vitals strip for ONE service: heartbeat age, last-successful-run,
// and error count as mono figures, plus a trailing EVIDENCE PANEL whose chart is
// the ONE thing that differs between the two variants:
//   • infra (bitcoind) → blocks-behind-tip (+ its D-14 band severity as the value
//     color), from chain-telemetry;
//   • custom (addressBalances) → run-success / error-count.
//
// Honest-stale (DS-01, load-bearing): when the service is stale/no-data the chart
// renders `StaleChart` "NO FRESH DATA" (via `EvidenceChart stale`), NEVER a faked
// line. When the service is fresh but the read model retains no trend history
// (Phase-11 telemetry is latest-snapshot), the evidence value stands alone with an
// honest "latest reading only" note — again, no fabricated series. A real ≥2-point
// series (when a history reader lands) draws the accent line.
//
// Server Component. `EvidenceChart` is a `"use client"` island but renders its
// StaleChart / empty-plot paths SSR-safely; composing it here needs no client JS.

const CHART_HEIGHT = 104 as const;

/** One mono figure in the vitals strip (label above, value below). */
function VitalFigure({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-df-mono text-[10px] font-bold tracking-[0.08em] text-df-muted uppercase">
        {label}
      </span>
      <span
        className={`font-df-mono text-[18px] font-semibold tabular-nums ${valueClassName ?? "text-df-ink"}`}
      >
        {value}
      </span>
    </div>
  );
}

export interface ServiceVitalsProps {
  /** Humanized last-heartbeat age (e.g. "8s ago"); null → "—". */
  heartbeat?: string;
  /** Humanized last-successful-run summary (e.g. "2m ago · ok"); null → "—". */
  lastRun?: string;
  /** Raw trailing-window error count. */
  errorCount: number;
  /** Honest staleness — drives the StaleChart "NO FRESH DATA" fallback (DS-01). */
  stale: boolean;
  /** Last-good recency label shown on the stale panel. */
  lastGoodLabel?: string;
  /** Evidence-panel left caption (e.g. "Blocks behind chain tip · latest"). */
  evLabel: string;
  /** Evidence-panel bold right value (e.g. "+3 blocks" / "0 errors"). */
  evValue: string;
  /** Explicit value color (a DF hex); defaults to the accent. */
  evValueColor?: string;
  /** Accent for the trend line (a DF severity hex). */
  accent: string;
  /**
   * Optional REAL trend series, oldest → newest. `[]`/<2 points renders NO line
   * (honest — the current read model retains only the latest snapshot).
   */
  series?: number[];
  /** Optional dashed neutral threshold on the trend (e.g. the alert level). */
  threshold?: ChartThreshold;
  /** Stable id suffix so multiple stale panels on one page don't collide. */
  idSuffix?: string;
}

/**
 * The service vitals strip + trailing evidence panel. One tree, two variants: the
 * caller supplies which evidence (blocks-behind for infra, run-success/errors for
 * custom) plus the honest `stale` flag. Never fabricates a trend line.
 */
export function ServiceVitals({
  heartbeat,
  lastRun,
  errorCount,
  stale,
  lastGoodLabel,
  evLabel,
  evValue,
  evValueColor,
  accent,
  series = [],
  threshold,
  idSuffix = "",
}: ServiceVitalsProps) {
  const hasTrend = series.length >= 2;

  return (
    <section className="flex flex-col gap-4 rounded-df-card border border-df-border bg-df-surface p-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <VitalFigure label="last heartbeat" value={heartbeat ?? "—"} />
        <VitalFigure
          label="last successful run"
          value={lastRun ?? "—"}
          valueClassName={lastRun?.includes("failed") ? "text-df-critical" : "text-df-ink"}
        />
        <VitalFigure
          label="errors · window"
          value={errorCount.toLocaleString("en-US")}
          valueClassName={
            errorCount > 5
              ? "text-df-critical"
              : errorCount > 0
                ? "text-df-warning"
                : "text-df-muted"
          }
        />
      </div>

      <EvidencePanel evLabel={evLabel} evValue={evValue} evValueColor={evValueColor} accent={accent}>
        {stale ? (
          // Honest-stale: never a faked fresh line (DS-01).
          <EvidenceChart
            series={[]}
            accent={accent}
            stale
            lastGoodLabel={lastGoodLabel}
            height={CHART_HEIGHT}
            idSuffix={idSuffix}
          />
        ) : hasTrend ? (
          <EvidenceChart
            series={series}
            accent={accent}
            threshold={threshold}
            area="under"
            height={CHART_HEIGHT}
            idSuffix={idSuffix}
          />
        ) : (
          // Fresh, but the read model retains no history to trend — the value above
          // is the evidence; we refuse to draw a fabricated line.
          <div
            className="flex items-center justify-center rounded-[6px] border border-dashed border-df-border-soft bg-df-surface-sub text-[11px] text-df-muted"
            style={{ height: CHART_HEIGHT }}
          >
            Latest reading only — no retained history to trend.
          </div>
        )}
      </EvidencePanel>
    </section>
  );
}
