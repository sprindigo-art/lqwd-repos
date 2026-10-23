// =====================================================
// StaleChart — honest "NO FRESH DATA" placeholder (DS-01)
// =====================================================
// The shape-distinct stale fallback that `EvidenceChart` renders in place of a
// Recharts line whenever `stale` is true. NodeMonitor NEVER fakes a fresh value:
// a stale series gets a diagonally-hatched gold panel with the verbatim
// "NO FRESH DATA" label and a last-good timestamp — not a green/healthy line.
//
// Ported from the locked prototype `staleChart()` (Ops Center v2 snapshot,
// lines 519-531): #F7F2E4 fill, 5px diagonal #D9D2BC stripes at .5 opacity,
// #E4D9B6 hairline border, #8A7426 bold "NO FRESH DATA", #A1924F sub-line.
// Pure SVG with explicit width/height so it renders SSR-safe (no Recharts,
// no ResponsiveContainer, no getComputedStyle). All text routes through React
// escaping — no HTML sink.

/** Diagonal stripe spacing (px) — matches the prototype 9px step. */
const STRIPE_STEP = 9;
/** Stripe stroke width (px). */
const STRIPE_WIDTH = 5;
/** Corner radius (px) for the panel + clip. */
const PANEL_RADIUS = 6;

export interface StaleChartProps {
  /** Render width in px (matches the chart slot it replaces). */
  width: number;
  /** Render height in px (matches the chart slot it replaces). */
  height: number;
  /** Last-good recency label, e.g. "last good 4h ago". Defaults to the prototype copy. */
  lastGoodLabel?: string;
  /** Stable clip id so multiple stale charts on one page don't collide. */
  idSuffix?: string;
}

/**
 * Honest-stale placeholder: a hatched gold panel reading "NO FRESH DATA".
 * Rendered by EvidenceChart when its `stale` prop is true (DS-01). Never draws
 * a healthy line — the whole point is to refuse to imply fresh telemetry.
 */
export function StaleChart({
  width,
  height,
  lastGoodLabel = "last good 4h ago",
  idSuffix = "",
}: StaleChartProps) {
  const clipId = `stale-clip${idSuffix}`;

  // Diagonal hatch lines spanning the panel (start off-canvas at -height so the
  // top-left corner is also covered), drawn bottom-left → top-right like the proto.
  const stripes: React.ReactElement[] = [];
  for (let x = -height; x < width; x += STRIPE_STEP) {
    stripes.push(
      <line
        key={`s${x}`}
        x1={x}
        y1={height}
        x2={x + height}
        y2={0}
        stroke="#D9D2BC"
        strokeWidth={STRIPE_WIDTH}
      />,
    );
  }

  return (
    // B6 — width="100%" + viewBox so the panel SCALES to its slot (was a fixed-px
    // SVG that never grew/shrank). `none` lets it fill the slot like the live
    // EvidenceChart's ResponsiveContainer; the diagonal hatch hides the mild stretch.
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="No fresh data"
      style={{ display: "block" }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={width} height={height} rx={PANEL_RADIUS} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={width} height={height} rx={PANEL_RADIUS} fill="#F7F2E4" />
      <g clipPath={`url(#${clipId})`} opacity={0.5}>
        {stripes}
      </g>
      <rect
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={PANEL_RADIUS}
        fill="none"
        stroke="#E4D9B6"
      />
      <text
        x={width / 2}
        y={height / 2 - 2}
        fontSize={10}
        fontWeight={700}
        fill="#8A7426"
        textAnchor="middle"
        letterSpacing="0.05em"
        fontFamily="var(--font-df-mono)"
      >
        NO FRESH DATA
      </text>
      <text
        x={width / 2}
        y={height / 2 + 13}
        fontSize={9}
        fill="#A1924F"
        textAnchor="middle"
        fontFamily="var(--font-df-mono)"
      >
        {lastGoodLabel}
      </text>
    </svg>
  );
}
