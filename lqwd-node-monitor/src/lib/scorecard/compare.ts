import { COMPARE_CONFIG, type Direction } from "@/lib/scorecard/config";
import type { PeerRelative } from "@/lib/scorecard/types";

// =====================================================
// D-10/D-11/D-12 — MAD cross-node comparison (pure, no dependency)
// =====================================================
// D-12 — outlier is a SEPARATE signal; it NEVER alters the absolute grade
// (enforced by having no grade inputs/outputs here). Cohorts are per-backend
// (D-11): callers build the cohort from same-backend nodes only; a cohort
// smaller than minCohortForMedian is suppressed → "no peer baseline yet".
// median/mad/outlierCheck implementation per RESEARCH §"MAD Comparison Math".

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// MAD (robust spread). 1.4826 scales MAD to ~σ for normal data (standard constant).
export function mad(xs: number[]): number {
  const med = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - med)));
}

// Outlier if |x - median| > N * MAD. Robust small-sample guard:
//  - cohort < minCohortForMedian (default 3): SUPPRESS — "no peer baseline yet" (D-11)
//  - MAD === 0 (cohort identical / tight): NOBODY is an outlier (D-12 intent — don't always flag)
export function outlierCheck(
  value: number,
  cohort: number[],
  madN: number = COMPARE_CONFIG.madN,
  minCohort: number = COMPARE_CONFIG.minCohortForMedian,
):
  | { suppressed: true }
  | { suppressed: false; median: number; isOutlier: boolean; deltaFromMedian: number } {
  if (cohort.length < minCohort) return { suppressed: true as const };
  const med = median(cohort);
  const spread = mad(cohort);
  const isOutlier = spread > 0 && Math.abs(value - med) > madN * spread;
  return { suppressed: false as const, median: med, isOutlier, deltaFromMedian: value - med };
}

/**
 * Direction-aware bad-tail outlier (D-12): only the BAD tail flags —
 *  - higher-better: only value BELOW the median can be an outlier (low tail bad);
 *  - lower-better:  only value ABOVE the median (high tail bad);
 *  - mid-better:    either tail (any extreme deviation is bad).
 * Returns the PeerRelative shape the scorecard view carries — a separate
 * marker/reason input only, never a grade input.
 */
export function outlierFor(
  value: number,
  cohort: number[],
  direction: Direction,
  madN: number = COMPARE_CONFIG.madN,
  minCohort: number = COMPARE_CONFIG.minCohortForMedian,
): PeerRelative {
  const check = outlierCheck(value, cohort, madN, minCohort);
  if (check.suppressed) return { suppressed: true };
  const onBadTail =
    direction === "mid-better" ||
    (direction === "higher-better" && check.deltaFromMedian < 0) ||
    (direction === "lower-better" && check.deltaFromMedian > 0);
  return {
    suppressed: false,
    median: check.median,
    deltaFromMedian: check.deltaFromMedian,
    isOutlier: check.isOutlier && onBadTail,
  };
}
