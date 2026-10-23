// =====================================================
// D-06/D-07 — the summary strip above every event table
// =====================================================
// Server Component, TriageStat grammar (fleet overview): mono micro-label
// over a 24px tabular value, gap-px cells on a border ground. Cells arrive
// PRE-FORMATTED (AFM-002 happened upstream) — this component does zero math
// and zero unit conversion (T-02-07). Wraps 5→3→2 down the breakpoints.

interface SummaryStripProps {
  cells: { label: string; value: string }[];
}

// Literal-class lookups keyed by cell count. Tailwind cannot safelist
// dynamically-built class strings (T-13-16-01), so every column-count class
// is a static literal the compiler can see. The large breakpoint tracks the
// exact cell count; the sm breakpoint caps at min(count, 3) so a 2-cell edge
// never strands a trailing cell.
const LG_COLS: Record<number, string> = {
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
};
const SM_COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};

export function SummaryStrip({ cells }: SummaryStripProps) {
  if (cells.length === 0) return null;
  const lgClass = LG_COLS[cells.length] ?? "lg:grid-cols-5";
  const smClass = SM_COLS[Math.min(cells.length, 3)] ?? "sm:grid-cols-3";
  return (
    <div
      className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border ${smClass} ${lgClass}`}
    >
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col gap-1.5 bg-card px-4 py-3">
          <span className="font-mono text-xs font-semibold tracking-[0.16em] text-foreground/45 uppercase">
            {cell.label}
          </span>
          <span className="truncate font-mono text-2xl leading-none font-semibold tabular-nums">
            {cell.value}
          </span>
        </div>
      ))}
    </div>
  );
}
