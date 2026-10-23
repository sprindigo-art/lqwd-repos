import type { TrendPoint } from "@/lib/console/trends";

// =====================================================
// Sparkline — 160x40 navy polyline (sketch 003 synthesis)
// =====================================================
// Pure presentational SVG Server Component — no client JS, no chart lib
// (Recharts deliberately NOT added for a 160x40 polyline; T-03-SC). Stroke is
// navy-bright brand chrome — STRUCTURAL, never a health color. No axes, no
// labels, no tooltip: one sparkline is the ceiling (sketch rule). Numeric-only
// props rendered through React attribute escaping (T-03-26).

interface SparklineProps {
  points: TrendPoint[];
  width?: number;
  height?: number;
}

/** Horizontal inset so the stroke caps don't clip at the viewBox edge. */
const INSET_X = 2;
/** Vertical inset — strokeWidth 1.5 needs ~3px headroom at min/max. */
const INSET_Y = 3;

export function Sparkline({ points, width = 160, height = 40 }: SparklineProps) {
  // A line needs two points; below that the evidence line stands alone.
  if (points.length < 2) return null;

  const values = points.map((p) => p.n);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  const innerWidth = width - INSET_X * 2;
  const innerHeight = height - INSET_Y * 2;
  const step = innerWidth / (points.length - 1);

  const coords = points
    .map((point, i) => {
      const x = INSET_X + i * step;
      // Flat series → midline; otherwise min-max normalize, y-down SVG space.
      const y =
        span === 0 ? height / 2 : INSET_Y + innerHeight - ((point.n - min) / span) * innerHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
      className="shrink-0"
    >
      <polyline
        points={coords}
        fill="none"
        stroke="var(--color-brand-light)"
        strokeWidth={1.5}
      />
    </svg>
  );
}
