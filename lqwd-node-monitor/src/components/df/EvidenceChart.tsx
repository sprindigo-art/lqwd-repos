"use client";

import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";

import { DF } from "@/lib/df/tokens";
import { formatBtc, formatSats } from "@/lib/format/units";
import { StaleChart } from "@/components/df/StaleChart";

// =====================================================
// EvidenceChart — inline evidence chart (DS-02, Recharts 3.9.0)
// =====================================================
// A `"use client"` Recharts island rebuilt to FULL locked-prototype `chart()`
// fidelity (Ops Center v2 snapshot lines 472-517; Node Detail 429-448). The
// prototype hand-rolls an SVG with NINE layers; this component reproduces every
// one through the declarative Recharts grammar:
//
//   1. peer-median band            → <ReferenceArea> + an in-plot <ReferenceLine label> caption
//   2. threshold (dashed slate)    → <ReferenceLine> + right-anchored label
//   3. area fill (3-way)           → <Area> with a conditional baseLine
//                                    ('above' fills only the exceedance above the
//                                     threshold, 'under' fills to baseline, none)
//   4. projection (dashed accent)  → a second <Line> over a padded series, .65 opacity
//   5. main line (2px accent)      → <Line> round caps/joins
//   6. marker (vertical dashed)    → <ReferenceLine x> + "lost"/"now" label
//   7. last dot                    → <Line activeDot> at the final real point
//   8. axis labels (time OR qty)   → a flex strip below the plot (start/mid/end)
//   9. shade window (Node Detail)  → <ReferenceArea x1..x2> + centered orange label
//
// SSR-safety: chart colors are LITERAL hex from `@/lib/df/tokens` (the DF mirror)
// — never `getComputedStyle` (RESEARCH anti-pattern: CSS vars don't resolve in
// SVG attrs SSR-safely). The chart sits inside a FIXED-height wrapper so
// `ResponsiveContainer` never measures 0×0 (Pitfall 1).
//
// Honest-stale (DS-01): when `stale` is true the component renders `<StaleChart>`
// ("NO FRESH DATA") instead of a Recharts line — NodeMonitor never fakes fresh
// telemetry.
//
// The declarative chart grammar is derived by the PURE, exported
// `deriveChartModel` so it is unit-testable without a DOM (Recharts 3.x renders
// its SVG surface client-side only — empty under `renderToStaticMarkup`). The
// evidence-panel chrome, axis strip, and StaleChart paths DO render server-side
// and are asserted via `renderToStaticMarkup`. Any sat/fee axis label routes
// through `@/lib/format/units` — no inline unit math.

const SLATE_BAND_ALPHA = "1c"; // ~11% — peer-median band fill (proto #64748B1c)
const ACCENT_AREA_ALPHA = "1f"; // ~12% — accent area fill (proto accent+'1f')
const PROJECTION_OPACITY = 0.65; // dashed projection continuation opacity
// B8 — the shade rect/label route through the `df-warning` token (the #C8770A
// literal IS df-warning); the ~7% fill is that token at 12/255 alpha.
const SHADE_FILL = `${DF.warning}12`; // ~7% warning wash — Node-Detail fee-drift shade rect
const SHADE_TEXT = DF.warning; // warning shade-window label (df-warning token)
const AXIS_COLOR = DF.faint; // #9AA3B4 — prototype AXIS tick color
const MARKER_OPACITY = 0.55; // proto marker line opacity
// B8 — evLabel routes through the `df-caption` token (the #8A92A0 chart-caption
// gray was tokenized as df-caption; DF.caption is its SSR-safe mirror).
const EV_LABEL_COLOR = DF.caption;
const EV_NOTE_COLOR = DF.faint; // #9AA3B4 — hero evNote caption gray (proto)

/** How the area is filled relative to the threshold (prototype `area` is 3-way). */
export type AreaMode = "above" | "under";

/** A neutral dashed line drawn across the plot at a fixed y, with a label. */
export interface ChartThreshold {
  v: number;
  label: string;
}

/** A translucent horizontal band (e.g. the peer-median range) with an in-plot caption. */
export interface ChartBand {
  lo: number;
  hi: number;
  label?: string;
}

/** A vertical dashed marker at a series index with a label ("lost"/"now"). */
export interface ChartMarker {
  /** The series index the marker line sits at. */
  atIndex: number;
  /** The label drawn above the plot at the marker x (e.g. "lost", "now"). */
  label: string;
}

/** A shaded x-range window (Node-Detail fee-drift) with a centered orange label. */
export interface ChartShade {
  /** Start series index of the shaded window. */
  from: number;
  /** End series index of the shaded window. */
  to: number;
  /** Centered orange caption inside the shade. */
  label: string;
}

/**
 * A bottom-axis tick label. Either a literal TIME string (`-30m`, `now`, `+6d`)
 * or a sat/BTC quantity routed through units.ts (no inline unit math).
 */
export type AxisLabel =
  | { kind: "time"; value: string }
  | { kind: "sats"; value: number }
  | { kind: "btc"; value: number };

export interface EvidenceChartProps {
  /** The y-values, oldest → newest. <2 points renders no line (Sparkline guard). */
  series: number[];
  /** The line/area/dot accent (a DF severity hex — e.g. `DF.watch`). */
  accent: string;
  /** Optional dashed neutral threshold (e.g. an alert level). */
  threshold?: ChartThreshold;
  /** Optional peer-median band (drawn with an in-plot caption). */
  band?: ChartBand;
  /**
   * Area fill mode. The prototype is 3-way:
   * - `"under"` (or boolean `true`) → fill to baseline,
   * - `"above"` → fill only the exceedance above the threshold,
   * - omitted/`false` → no fill.
   */
  area?: AreaMode | boolean;
  /** Optional dashed projection continuation beyond the last real point. */
  projection?: number[];
  /** Optional vertical dashed marker ("lost"/"now") at a series index. */
  marker?: ChartMarker;
  /** Optional shaded x-range window with a centered orange label (Node Detail). */
  shade?: ChartShade;
  /** Fixed plot height: hero (104) or inline (58) — avoids SSR zero-size. */
  height?: 104 | 58;
  /** Honest-stale: render the StaleChart "NO FRESH DATA" panel instead (DS-01). */
  stale?: boolean;
  /** Last-good recency label shown on the stale panel. */
  lastGoodLabel?: string;
  /** Optional axis labels — time strings or sat/BTC quantities (start/mid/end). */
  axisLabels?: AxisLabel[];
  /** Stable id suffix so multiple charts/stale panels don't collide. */
  idSuffix?: string;
}

/** The declarative descriptors derived from props — what the Recharts tree draws. */
export interface ChartModel {
  /** Plain `{ i, v }` rows for the Recharts `data` prop. */
  data: { i: number; v: number }[];
  /** Total x-domain extent including projection points (for X positioning). */
  xMax: number;
  yMin: number;
  yMax: number;
  line: { stroke: string; strokeWidth: number };
  lastDot: { fill: string };
  threshold?: { v: number; label: string; stroke: string; strokeDasharray: string };
  band?: { lo: number; hi: number; label: string; fill: string; stroke: string };
  /** Resolved area descriptor; `baseLineValue` undefined means "fill to baseline". */
  area?: { fill: string; mode: AreaMode; baseLineValue?: number };
  projection?: {
    data: { i: number; v: number }[];
    stroke: string;
    strokeDasharray: string;
    opacity: number;
  };
  marker?: { atIndex: number; label: string; stroke: string; strokeDasharray: string; opacity: number };
  shade?: { from: number; to: number; label: string; fill: string; textFill: string };
}

/** Normalize the 3-way / boolean `area` prop to an AreaMode or null. */
function resolveAreaMode(area: AreaMode | boolean | undefined): AreaMode | null {
  if (area === true) return "under";
  if (area === false || area === undefined) return null;
  return area;
}

/**
 * Pure derivation of the evidence-chart grammar from props — the single source
 * of truth the Recharts tree is built from, and the unit-testable surface
 * (Recharts itself renders client-side only). Returns `null` for <2 points (the
 * Sparkline `<2 points → null` guard: a line needs two points).
 */
export function deriveChartModel(props: {
  series: number[];
  accent: string;
  threshold?: ChartThreshold;
  band?: ChartBand;
  area?: AreaMode | boolean;
  projection?: number[];
  marker?: ChartMarker;
  shade?: ChartShade;
}): ChartModel | null {
  const { series, accent, threshold, band, area, projection, marker, shade } = props;
  if (series.length < 2) return null;

  const proj = projection ?? [];
  const allValues = [
    ...series,
    ...proj,
    ...(threshold ? [threshold.v] : []),
    ...(band ? [band.lo, band.hi] : []),
  ];
  const yMin = Math.min(...allValues, 0);
  const yMax = Math.max(...allValues);
  // The x-domain spans the real series PLUS any projection points so X(i) for a
  // projection index lands at the right place (proto `N = series + proj`).
  const xMax = series.length + proj.length - 1;

  const data = series.map((v, i) => ({ i, v }));

  const model: ChartModel = {
    data,
    xMax,
    yMin,
    yMax,
    line: { stroke: accent, strokeWidth: 2 },
    lastDot: { fill: accent },
  };

  if (threshold) {
    model.threshold = {
      v: threshold.v,
      label: threshold.label,
      stroke: DF.slate,
      strokeDasharray: "3 3",
    };
  }
  if (band) {
    model.band = {
      lo: band.lo,
      hi: band.hi,
      label: band.label ?? "peer median",
      fill: `${DF.slate}${SLATE_BAND_ALPHA}`,
      stroke: DF.slate,
    };
  }
  const areaMode = resolveAreaMode(area);
  if (areaMode) {
    // 'above' fills only the exceedance above the threshold (baseLine = threshold);
    // 'under' fills to the chart baseline (baseLine undefined → Recharts uses yMin).
    const baseLineValue = areaMode === "above" && threshold ? threshold.v : undefined;
    model.area = { fill: `${accent}${ACCENT_AREA_ALPHA}`, mode: areaMode, baseLineValue };
  }
  if (proj.length) {
    // The dashed continuation starts at the last real point so the two meet.
    const lastReal = data[data.length - 1];
    model.projection = {
      data: [lastReal, ...proj.map((v, i) => ({ i: series.length + i, v }))],
      stroke: accent,
      strokeDasharray: "3 3",
      opacity: PROJECTION_OPACITY,
    };
  }
  if (marker) {
    model.marker = {
      atIndex: marker.atIndex,
      label: marker.label,
      stroke: DF.slate,
      strokeDasharray: "2 2",
      opacity: MARKER_OPACITY,
    };
  }
  if (shade) {
    model.shade = {
      from: shade.from,
      to: shade.to,
      label: shade.label,
      fill: SHADE_FILL,
      textFill: SHADE_TEXT,
    };
  }
  return model;
}

/** Format one axis label — a literal time string, or a sat/BTC quantity via units.ts. */
export function formatAxisLabel(label: AxisLabel): string {
  switch (label.kind) {
    case "time":
      return label.value;
    case "btc":
      return formatBtc(label.value);
    case "sats":
      return formatSats(label.value);
  }
}

/**
 * The bottom axis strip: 1–3 ticks anchored start / middle / end, matching the
 * prototype's `(s.axis||[]).forEach` start/mid/end anchoring (lines 513-515).
 * Time strings render verbatim; sat/BTC quantities route through units.ts.
 */
function AxisStrip({ labels }: { labels: AxisLabel[] }) {
  if (labels.length === 0) return null;
  return (
    <div className="flex justify-between font-mono text-[8px]" style={{ color: AXIS_COLOR }}>
      {labels.map((label, i) => {
        const align =
          i === 0 ? "text-left" : i === labels.length - 1 ? "text-right" : "text-center";
        return (
          <span key={i} className={`flex-1 ${align}`}>
            {formatAxisLabel(label)}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Inline evidence chart. Renders the full prototype `chart()` grammar on Recharts
 * with SSR-safe DF colors; falls back to the honest `StaleChart` placeholder
 * when `stale` (DS-01).
 */
export function EvidenceChart({
  series,
  accent,
  threshold,
  band,
  area,
  projection,
  marker,
  shade,
  height = 58,
  stale = false,
  lastGoodLabel,
  axisLabels,
  idSuffix = "",
}: EvidenceChartProps) {
  // Honest-stale fallback — never a faked fresh line (DS-01). Render at the same
  // fixed slot size; StaleChart is pure SVG (SSR-renderable, no Recharts).
  if (stale) {
    return (
      <div className="w-full" style={{ height }}>
        <StaleChart width={188} height={height} lastGoodLabel={lastGoodLabel} idSuffix={idSuffix} />
        {axisLabels && <AxisStrip labels={axisLabels} />}
      </div>
    );
  }

  const model = deriveChartModel({ series, accent, threshold, band, area, projection, marker, shade });

  return (
    // Fixed wrapper height — avoids the ResponsiveContainer 0×0 SSR flash (Pitfall 1).
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={model?.data ?? []} margin={{ top: 11, right: 10, bottom: 15, left: 10 }}>
          <XAxis dataKey="i" type="number" domain={[0, model?.xMax ?? 1]} hide />
          <YAxis hide domain={[model?.yMin ?? 0, model?.yMax ?? 1]} />

          {/* shade window (Node Detail fee-drift) — drawn first, behind everything */}
          {model?.shade && (
            <ReferenceArea
              x1={model.shade.from}
              x2={model.shade.to}
              fill={model.shade.fill}
              stroke="none"
              label={{ value: model.shade.label, position: "insideTop", fontSize: 8.5, fill: model.shade.textFill }}
            />
          )}

          {/* peer-median band + in-plot caption */}
          {model?.band && (
            <ReferenceArea
              y1={model.band.lo}
              y2={model.band.hi}
              fill={model.band.fill}
              stroke="none"
              label={{ value: model.band.label, position: "insideBottomLeft", fontSize: 8, fill: model.band.stroke }}
            />
          )}

          {/* threshold (neutral, dashed) + right-anchored label */}
          {model?.threshold && (
            <ReferenceLine
              y={model.threshold.v}
              stroke={model.threshold.stroke}
              strokeWidth={1}
              strokeDasharray={model.threshold.strokeDasharray}
              label={{ value: model.threshold.label, position: "right", fontSize: 8, fill: DF.slate }}
            />
          )}

          {/* area fill — 3-way: baseLine=threshold for 'above', baseline for 'under' */}
          {model?.area && (
            <Area
              type="monotone"
              dataKey="v"
              stroke="none"
              fill={model.area.fill}
              {...(model.area.baseLineValue !== undefined
                ? { baseLine: model.area.baseLineValue }
                : {})}
              isAnimationActive={false}
            />
          )}

          {/* projection dashed continuation (a separate series over padded data) */}
          {model?.projection && (
            <Line
              type="monotone"
              data={model.projection.data}
              dataKey="v"
              stroke={model.projection.stroke}
              strokeWidth={1.5}
              strokeDasharray={model.projection.strokeDasharray}
              strokeOpacity={model.projection.opacity}
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          )}

          {/* main 2px accent line + last-point dot */}
          {model?.line && (
            <Line
              type="monotone"
              dataKey="v"
              stroke={model.line.stroke}
              strokeWidth={model.line.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 3, fill: model.lastDot.fill }}
              isAnimationActive={false}
            />
          )}

          {/* marker — vertical dashed line + "lost"/"now" label above the plot */}
          {model?.marker && (
            <ReferenceLine
              x={model.marker.atIndex}
              stroke={model.marker.stroke}
              strokeWidth={1}
              strokeDasharray={model.marker.strokeDasharray}
              strokeOpacity={model.marker.opacity}
              label={{ value: model.marker.label, position: "top", fontSize: 8, fill: DF.slate }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
      {axisLabels && <AxisStrip labels={axisLabels} />}
    </div>
  );
}

// =====================================================
// EvidencePanel — the evidence-panel chrome around the chart (proto 152-160 / 305-310)
// =====================================================
// Every prototype chart lives inside a panel that pairs it with a label row:
// an `evLabel` on the left, a bold COLORED `evValue` on the right (e.g. "+22m",
// "DOWN", "3.1×"), and — on the hero — an `evNote` caption below. The built
// EvidenceChart only drew the plot; this panel restores the missing chrome so a
// consumer gets the full "gRPC reachability · DOWN" presentation, not a bare line.

export interface EvidencePanelProps {
  /** Left caption, e.g. "Minutes behind chain tip · last 30 min". */
  evLabel: string;
  /** Right bold value, e.g. "+22m" / "DOWN" / "3.1×". */
  evValue: string;
  /** The bold value color (defaults to the accent). */
  evValueColor?: string;
  /** The accent used for the value when no explicit color is given. */
  accent?: string;
  /** Optional caption line below the chart (hero panels only). */
  evNote?: string;
  /** The chart (or any node) the panel wraps. */
  children: React.ReactNode;
}

/**
 * The evidence-panel chrome: a subtle inset card with a label/value header row,
 * the chart body, and an optional note caption. Mirrors the prototype hero panel
 * (#FAFBFD bg, #ECEFF4 border, 13px radius) and inline-evidence header.
 */
export function EvidencePanel({
  evLabel,
  evValue,
  evValueColor,
  accent,
  evNote,
  children,
}: EvidencePanelProps) {
  const valueColor = evValueColor ?? accent ?? DF.ink;
  return (
    <div
      className="w-full"
      style={{
        background: DF.surfaceSub,
        border: `1px solid ${DF.borderSoft}`,
        borderRadius: 13,
        padding: "13px 15px 9px",
      }}
    >
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-medium" style={{ color: EV_LABEL_COLOR }}>
          {evLabel}
        </span>
        <span className="font-mono text-[14px] font-bold" style={{ color: valueColor }}>
          {evValue}
        </span>
      </div>
      {children}
      {evNote && (
        <div className="mt-[7px] text-[10.5px] leading-[1.4]" style={{ color: EV_NOTE_COLOR }}>
          {evNote}
        </div>
      )}
    </div>
  );
}
