import type { ReactNode } from "react";

// Shared "nothing here" state so all five boards stop diverging on heading size,
// body treatment, and padding (audit F / empty-state finding). Renders INSIDE the
// page's existing NavRailShell — this is the inner content block only.

interface BoardEmptyProps {
  /** Primary line, e.g. "You're all caught up." */
  heading: string;
  /** One-line explanation of the calm state. */
  body: string;
  /** Optional faint third line (e.g. a "watching…" reassurance). */
  footnote?: ReactNode;
}

/** Locked type scale + padding for the empty state across every board. */
export function BoardEmpty({ heading, body, footnote }: BoardEmptyProps) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <p className="text-[18px] font-semibold text-df-ink">{heading}</p>
      <p className="max-w-[440px] text-[13.5px] text-df-muted">{body}</p>
      {footnote !== undefined && (
        <p className="mt-1 font-df-mono text-[11.5px] text-df-muted">{footnote}</p>
      )}
    </div>
  );
}
