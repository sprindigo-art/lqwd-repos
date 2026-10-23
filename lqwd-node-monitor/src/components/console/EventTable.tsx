import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// =====================================================
// D-05/D-07 — the generic capped event table
// =====================================================
// Server Component. Fully generic: the page supplies the column descriptors
// and rows of PRE-FORMATTED strings (AFM-002, WR-01 timestamp coercion, and
// the newest-first ORDER BY all happened in the read layer — T-02-07: no
// unit math, no re-ordering here). Grammar from the fleet overview table:
// console-label heads, hairline dividers, hover:bg-card rows, px-3 py-2
// cell rhythm (UI-SPEC §Spacing exception), mono tabular numerics.

interface EventTableColumn {
  /** Row-record key this column reads. */
  key: string;
  /** Usually a string; ReactNode admits tooltip-wrapped heads (e.g. peers flap count). */
  label: ReactNode;
  align?: "left" | "right";
  /** Numeric/identifier cells: mono + tabular-nums. */
  mono?: boolean;
}

interface EventTableProps {
  columns: EventTableColumn[];
  rows: Record<string, string>[];
}

export function EventTable({ columns, rows }: EventTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card/30">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-card/60">
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  "px-3 py-2 text-left font-mono text-xs font-semibold tracking-[0.14em] whitespace-nowrap text-foreground/45 uppercase",
                  col.align === "right" && "text-right"
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            // Pre-formatted rows carry no stable id — index keys are fine for
            // a static server render (no client reconciliation).
            <tr key={i} className="transition-colors hover:bg-card">
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-3 py-2 whitespace-nowrap",
                    col.align === "right" && "text-right",
                    col.mono && "font-mono tabular-nums"
                  )}
                >
                  {row[col.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
