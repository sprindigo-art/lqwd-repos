// =====================================================
// HOST-02 — read-time storage %/day growth + projected time-to-full (PURE)
// =====================================================
// Storage growth is computed at READ time from the retained `host_storage`
// history — NOTHING about growth or projection is ever stored (D-13/D-14). This
// module is a PURE transform (named exports, no server/DB imports — tested like
// units.ts): the caller passes the rows, it returns numbers.
//
// HONESTY gate (HOST-02): a projection is only emitted when the evidence supports
// it. With < 2 samples, too short a span, a stale latest reading, or flat/negative
// growth, the result carries an explicit no-projection STATUS and `daysToFull = null`
// — never a fabricated number and never a divide-by-~0 Infinity dressed up as data.
//
// Byte columns are read as RATIOS (used/total) only — there is NO inline binary
// byte-unit scaling here; that display-unit math lives solely in units.ts
// (AFM-002). This module deals in fractions, percentage-points, and days.

const DAY_MS = 24 * 60 * 60 * 1000;
// Minimum first→last span to trust a growth RATE (default 1h). Shorter windows
// turn collector jitter into wild slopes — refuse to project (HOST-02).
const DEFAULT_MIN_WINDOW_MS = 60 * 60 * 1000;
// Latest sample older than this → the reading itself is stale; no projection (D-13).
const DEFAULT_FRESHNESS_MS = 15 * 60 * 1000;

/** One retained storage observation for a single mount. */
export interface StorageGrowthSample {
  collectedAt: Date;
  usedBytes: number | bigint;
  totalBytes: number | bigint;
}

/** Why a projection was or was not produced (HOST-02 honesty). */
export type StorageProjectionStatus =
  | "ok"
  | "insufficient-samples"
  | "insufficient-window"
  | "stale"
  | "flat-or-negative";

export interface StorageGrowth {
  status: StorageProjectionStatus;
  /** Percentage-points of disk used per day; null when not computable. */
  pctPerDay: number | null;
  /** Projected days until 100% full; null unless status === "ok". */
  daysToFull: number | null;
  /** Latest used % (0–100); null when there are no samples or total ≤ 0. */
  latestPctUsed: number | null;
}

export interface StorageGrowthOptions {
  /** Minimum first→last span to trust the rate (default 1h). */
  minWindowMs?: number;
  /** Latest sample older than this reads stale (default 15 min, D-13). */
  freshnessMs?: number;
  /** Injectable clock for tests (default Date.now()). */
  now?: number;
}

/** Used fraction (0–1) for a sample, or null when total ≤ 0 (undefined ratio). */
function usedFraction(s: StorageGrowthSample): number | null {
  const total = Number(s.totalBytes);
  if (!(total > 0)) return null;
  return Number(s.usedBytes) / total;
}

/**
 * Compute %/day growth + projected time-to-full from a storage history series,
 * applying the HOST-02 honesty gate. The series may be unsorted and may carry
 * bigint byte columns; this function sorts ascending by `collectedAt` internally.
 */
export function computeStorageGrowth(
  samples: StorageGrowthSample[],
  opts: StorageGrowthOptions = {},
): StorageGrowth {
  const now = opts.now ?? Date.now();
  const minWindowMs = opts.minWindowMs ?? DEFAULT_MIN_WINDOW_MS;
  const freshnessMs = opts.freshnessMs ?? DEFAULT_FRESHNESS_MS;

  // Sort ascending so first/last are unambiguous regardless of caller order.
  const series = [...samples].sort(
    (a, b) => a.collectedAt.getTime() - b.collectedAt.getTime(),
  );

  const last = series[series.length - 1];
  const lastFrac = last ? usedFraction(last) : null;
  const latestPctUsed = lastFrac == null ? null : lastFrac * 100;

  // Gate 1: need at least two points to derive a rate at all.
  if (series.length < 2) {
    return { status: "insufficient-samples", pctPerDay: null, daysToFull: null, latestPctUsed };
  }

  const first = series[0];
  const firstFrac = usedFraction(first);
  if (firstFrac == null || lastFrac == null) {
    return { status: "insufficient-samples", pctPerDay: null, daysToFull: null, latestPctUsed };
  }

  // Gate 2: the latest reading itself must be fresh, else the projection is moot.
  if (now - last.collectedAt.getTime() > freshnessMs) {
    return { status: "stale", pctPerDay: null, daysToFull: null, latestPctUsed };
  }

  // Gate 3: the window must span enough time to trust the slope.
  const spanMs = last.collectedAt.getTime() - first.collectedAt.getTime();
  if (spanMs < minWindowMs) {
    return { status: "insufficient-window", pctPerDay: null, daysToFull: null, latestPctUsed };
  }

  const days = spanMs / DAY_MS;
  const fracPerDay = (lastFrac - firstFrac) / days;
  const pctPerDay = fracPerDay * 100;

  // Gate 4: flat or shrinking usage never yields a finite, honest time-to-full.
  if (fracPerDay <= 0) {
    return { status: "flat-or-negative", pctPerDay, daysToFull: null, latestPctUsed };
  }

  const daysToFull = (1 - lastFrac) / fracPerDay;
  return { status: "ok", pctPerDay, daysToFull, latestPctUsed };
}
