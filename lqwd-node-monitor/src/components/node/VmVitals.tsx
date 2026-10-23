import { chartAccentFor } from "@/components/df/SeverityCard";
import type { Severity } from "@/components/df/Severity";
import {
  EvidenceChart,
  EvidencePanel,
  type AxisLabel,
  type ChartMarker,
  type ChartThreshold,
} from "@/components/df/EvidenceChart";
import { StaleChart } from "@/components/df/StaleChart";

// =====================================================
// VmVitals (B2 / NODE-04) — VM evidence charts (Server)
// =====================================================
// This node's VM vitals as compact evidence charts (CPU / memory / disk), composed
// over the locked `EvidenceChart` / `EvidencePanel` / `StaleChart` primitives.
// Same chart style + `df-slate` threshold lines as the overview (the threshold's
// neutral slate hue is baked into `EvidenceChart`).
//
// HONEST-STALE (DS-01, load-bearing acceptance): the disk time-to-full projection
// marker renders ONLY when its growth data is fresh/sufficient. When growth is
// stale this component renders `StaleChart` ("NO FRESH DATA") INSTEAD of a
// projection — never an interpolated line off a stale read. That branch is made
// EXPLICIT here (not merely delegated) so the "StaleChart, not a projection"
// invariant is legible in this file.
//
// Presentational + serializable-prop-driven: Plan 08 resolves pubkey→hostId and
// wires the host-metrics series in; this leaf does no read and no unit math (the
// value strings arrive pre-formatted through AFM-002 upstream).

// Stale-panel viewBox geometry. B6 — unified with the live EvidenceChart slot
// (both use 188×58) so the honest-stale placeholder and the real chart share ONE
// coordinate source; the SVG itself renders at width="100%" and scales to its slot.
const STALE_WIDTH = 188;
const STALE_HEIGHT = 58;

/** One VM vital evidence chart (CPU / memory / disk / deep metrics). */
export interface VmVitalChart {
  /**
   * Stable key — also the id suffix so multiple stale panels never collide.
   * Base vitals use "cpu" / "mem" / "disk"; COL-03 deep metrics add keys like
   * "cpu-cores" / "disk-io" / "net-errs" (Plan 15-08).
   */
  key: string;
  /** Left caption, e.g. "CPU · last 30 min". */
  label: string;
  /** Right bold value, pre-formatted upstream (AFM-002) — e.g. "42%" / "18.2 GiB". */
  value: string;
  /** State rung for the line accent — sev→accent via the ramp API (no `sev ===`). */
  sev: Severity;
  /** The y-series, oldest → newest. */
  series: number[];
  /** Optional dashed neutral (df-slate) threshold line. */
  threshold?: ChartThreshold;
  /**
   * Honest-stale flag. When true the panel renders `StaleChart` in place of a
   * chart — and, for disk, in place of the time-to-full projection (DS-01).
   */
  stale: boolean;
  /** Last-good recency label shown on the stale panel. */
  lastGoodLabel?: string;
  /**
   * Disk-only: the time-to-full projection continuation. Rendered ONLY when
   * `stale` is false (fresh/sufficient growth data); ignored when stale.
   */
  projection?: number[];
  /** Optional "now"/"full" marker on the disk projection. */
  marker?: ChartMarker;
  /** Optional bottom-axis ticks (time strings or sat/BTC quantities). */
  axisLabels?: AxisLabel[];
}

export interface VmVitalsProps {
  /** The VM vital charts to render (CPU / memory / disk). */
  charts: VmVitalChart[];
}

/**
 * The VM vitals evidence row. Each chart sits in an `EvidencePanel`; a stale chart
 * degrades to the honest `StaleChart` placeholder (no projection on stale).
 */
export function VmVitals({ charts }: VmVitalsProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="font-df-mono text-[10.5px] font-bold tracking-[0.09em] text-df-muted uppercase">
        VM vitals
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {charts.map((chart) => {
          const accent = chartAccentFor(chart.sev);
          return (
            <EvidencePanel
              key={chart.key}
              evLabel={chart.label}
              evValue={chart.value}
              accent={accent}
            >
              {chart.stale ? (
                // Honest-stale: the hatched "NO FRESH DATA" panel — never a
                // projection or interpolated line off a stale read (DS-01).
                <StaleChart
                  width={STALE_WIDTH}
                  height={STALE_HEIGHT}
                  lastGoodLabel={chart.lastGoodLabel}
                  idSuffix={`-vm-${chart.key}`}
                />
              ) : (
                <EvidenceChart
                  series={chart.series}
                  accent={accent}
                  threshold={chart.threshold}
                  projection={chart.projection}
                  marker={chart.marker}
                  axisLabels={chart.axisLabels}
                  height={STALE_HEIGHT}
                  idSuffix={`-vm-${chart.key}`}
                />
              )}
            </EvidencePanel>
          );
        })}
      </div>
    </section>
  );
}
