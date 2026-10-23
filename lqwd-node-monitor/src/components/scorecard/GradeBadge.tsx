import type { Letter, StatusColor } from "@/lib/scorecard/types";
import { cn } from "@/lib/utils";

interface GradeBadgeProps {
  /** Decided upstream in grade.ts — this component NEVER derives color. */
  color: "ok" | "warn" | "critical" | "nodata";
  letter: Letter | null; // null or color==="nodata" renders the en-dash chip
  /** Native title tooltip — percentage/band text built by the caller (percentages live in tooltips, sketch rule). */
  title?: string;
  /** sm = rail/tiles/healthy cards (text-sm), md = queue rows (text-lg), lg = composite headers (text-2xl). */
  size?: "sm" | "md" | "lg";
}

/** 1:1 StatusColor→token mapping — purely presentational, no health logic (T-02-07).
    nodata wears the stale tokens: deliberately inert, not broken. */
const CLASS_BY_COLOR: Record<StatusColor, string> = {
  ok: "text-status-ok bg-status-ok-dim border-status-ok/30",
  warn: "text-status-warn bg-status-warn-dim border-status-warn/30",
  critical: "text-status-critical bg-status-critical-dim border-status-critical/30",
  nodata: "text-status-stale bg-status-stale-dim border-status-stale/30",
};

const SIZE_CLASS: Record<NonNullable<GradeBadgeProps["size"]>, string> = {
  sm: "text-sm",
  md: "text-lg",
  lg: "text-2xl",
};

/**
 * Severity-tinted chip (sketch 002 winner B) — the letter takes its StatusColor;
 * replaces the rejected dot+letter unit. No dot, no emoji, ever.
 */
export function GradeBadge({ color, letter, title, size = "sm" }: GradeBadgeProps) {
  return (
    <span className="inline-flex items-center">
      <span
        title={title}
        className={cn(
          "inline-flex items-center justify-center rounded-[3px] border px-[0.45em] py-[0.1em] font-mono font-semibold leading-none",
          CLASS_BY_COLOR[color],
          SIZE_CLASS[size]
        )}
      >
        {color === "nodata" ? "–" : (letter ?? "–")}
      </span>
      <span className="sr-only">{color}</span>
    </span>
  );
}
