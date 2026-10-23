import type { OverviewData } from "@/app/(overview)/page";

// =====================================================
// overview-cache — the SINGLE owner of the overview 20s TTL memo global
// =====================================================
// The Ops Center overview serves its "5 reads → cutoff → assemble → rollup"
// pipeline through a short-TTL, constant-keyed in-process memo (backlog #1). That
// memo used to be an inline module global in page.tsx. QUICK-REFRESH relocates it
// here so BOTH the page (read/write) and the refreshData() server action (bust via
// clearOverviewCache) address the SAME global — if two caches diverged, the manual
// Refresh would clear one while the page kept serving the other, and the bust would
// be a silent no-op. There is exactly ONE cache, and it lives here.
//
// The promise payload type is imported TYPE-ONLY from page.tsx — type imports are
// fully erased at compile time, so this helper pulls no server-only DB/env module
// into its runtime graph and stays unit-testable under plain node (no cycle).

/** ~20s memo window — far under any honest-staleness display window (T-12-12-01). */
export const OVERVIEW_TTL_MS = 20_000;

interface OverviewCacheEntry {
  at: number;
  promise: Promise<OverviewData>;
}

const globalForOverview = globalThis as unknown as {
  _overviewDataCache?: OverviewCacheEntry;
};

/** The current memo entry, or undefined when nothing is cached / it was evicted. */
export function getOverviewCache(): OverviewCacheEntry | undefined {
  return globalForOverview._overviewDataCache;
}

/**
 * Install a memo entry keyed by wall-clock `at` and return it, so the caller can
 * hold the exact identity for its failure-eviction "only if still current" guard.
 */
export function setOverviewCache(at: number, promise: Promise<OverviewData>): OverviewCacheEntry {
  const entry: OverviewCacheEntry = { at, promise };
  globalForOverview._overviewDataCache = entry;
  return entry;
}

/** Evict the memo so the next load recomputes — the refreshData() bust and the
 *  page's on-failure eviction both funnel through this ONE unset. */
export function clearOverviewCache(): void {
  globalForOverview._overviewDataCache = undefined;
}
