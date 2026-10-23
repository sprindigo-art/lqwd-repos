// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// HOST-02 — D-15 days-to-full humanizer + D-14 honest projection-status copy
// =====================================================
// Renders `StorageGrowth` results (storage-growth.ts) into the UI-SPEC
// Copywriting Contract strings — VERBATIM. The humanizer NEVER emits a
// calendar date and NEVER long-horizon decimals (D-15); every no-projection
// status maps to DISTINCT copy so the operator always knows WHY a projection
// is missing (D-14). Pitfall 4: `flat-or-negative` still carries a non-null,
// possibly-negative `pctPerDay` — callers render the signed rate
// (`formatPctPerDay`) PLUS the "not growing" status copy.

import type { StorageProjectionStatus } from "@/lib/read/storage-growth";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Mirrors storage-growth.ts DEFAULT_MIN_WINDOW_MS (1h) — the module keeps its
// constant private, and importing a VALUE would break this module's purity
// contract only in spirit (storage-growth is also pure) but the default must
// stay in lockstep with the projection gate either way.
const DEFAULT_MIN_WINDOW_MS = HOUR_MS;

/**
 * Humanize a projected days-to-full per the locked D-15 bands:
 *   d ≥ 365      → ">1 year to full"          (calm, healthy)
 *   90 ≤ d < 365 → "~{round(d/30)} months to full"
 *   28 ≤ d < 90  → "~{nearest 5} days to full"
 *   7 ≤ d < 28   → "~{round(d/7)} weeks to full"  (singular at 1 week)
 *   1 ≤ d < 7    → "~{round(d)} days to full"     (singular at 1 day)
 *   d < 1        → "<1 day to full"               (never "~0 days")
 */
export function humanizeDaysToFull(days: number): string {
  if (days >= 365) return ">1 year to full";
  if (days >= 90) return `~${Math.round(days / 30)} months to full`;
  if (days >= 28) return `~${Math.round(days / 5) * 5} days to full`;
  if (days >= 7) {
    const weeks = Math.round(days / 7);
    return `~${weeks} ${weeks === 1 ? "week" : "weeks"} to full`;
  }
  const whole = Math.round(days);
  if (whole < 1) return "<1 day to full";
  return `~${whole} ${whole === 1 ? "day" : "days"} to full`;
}

/** Coarse age for the stale parenthetical: "30m" / "2h" / "3d". */
function humanizeAge(ageMs: number): string {
  if (ageMs < HOUR_MS) return `${Math.round(ageMs / (60 * 1000))}m`;
  if (ageMs < 48 * HOUR_MS) return `${Math.round(ageMs / HOUR_MS)}h`;
  return `${Math.round(ageMs / DAY_MS)}d`;
}

export interface ProjectionStatusCopyOptions {
  /** Age of the latest sample (stale copy: "…data stale (2h old)"). */
  ageMs?: number;
  /** First→last span of the gathered series (gathering ETA derivation). */
  currentSpanMs?: number;
  /** Minimum trusted window (defaults to storage-growth's 1h gate). */
  minWindowMs?: number;
}

/**
 * D-14 honest copy for every no-projection status — the row is NEVER silently
 * hidden; the operator always sees WHY the projection is missing:
 *   stale                → "projection unavailable — data stale (2h old)"
 *   insufficient-samples / insufficient-window
 *                        → "gathering data — projection in ~Nh"
 *                          (N = ceil((minWindow − currentSpan)/1h), floor 1)
 *   flat-or-negative     → "not growing"
 */
export function projectionStatusCopy(
  status: Exclude<StorageProjectionStatus, "ok">,
  opts: ProjectionStatusCopyOptions,
): string {
  switch (status) {
    case "stale":
      return opts.ageMs == null
        ? "projection unavailable — data stale"
        : `projection unavailable — data stale (${humanizeAge(opts.ageMs)} old)`;
    case "insufficient-samples":
    case "insufficient-window": {
      const minWindowMs = opts.minWindowMs ?? DEFAULT_MIN_WINDOW_MS;
      const currentSpanMs = opts.currentSpanMs ?? 0;
      const hours = Math.max(1, Math.ceil((minWindowMs - currentSpanMs) / HOUR_MS));
      return `gathering data — projection in ~${hours}h`;
    }
    case "flat-or-negative":
      return "not growing";
  }
}

/**
 * Signed growth rate for the storage row: "+0.4%/day" — the + is ALWAYS shown
 * for positive growth; negative keeps its minus; zero renders unsigned.
 */
export function formatPctPerDay(pctPerDay: number): string {
  const fixed = pctPerDay.toFixed(1);
  const sign = pctPerDay > 0 && !fixed.startsWith("-") ? "+" : "";
  // Normalize "-0.0" (tiny negative rates) to unsigned zero.
  const normalized = fixed === "-0.0" ? "0.0" : fixed;
  return `${sign}${normalized}%/day`;
}
