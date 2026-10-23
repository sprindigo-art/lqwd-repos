// Pure module: no server runtime imports, no DB — fixture-testable anywhere.
// =====================================================
// freshness-cutoff.ts — the 30-day staleness ELIMINATOR (backlog #8, LOCKED)
// =====================================================
// The operator's LOCKED rule: any entity with NO data present in the last 30
// days is treated as GONE (unlikely to return) and ELIMINATED from monitoring —
// not shown in the queue, not counted in the vitals denominators. This is the
// deliberate fix for the current 1000+ STALE flood from long-dead nodes.
//
// The 12-12 page wiring applies this filter to EVERY layer's entity array
// BEFORE incident assembly (OVW-01) and vitals rollup (OVW-03), so a dead
// entity leaves both the attention queue and the fleet-vitals math in one pass.
//
// LOCKED null-stamp decision (documented so it cannot silently drift): an entity
// whose stamp is `null` has never reported — it therefore has NO data present in
// the last 30 days and is ELIMINATED here (treated as gone). This is NOT the
// honest no-data display path: that path (D-08) still applies to entities WITHIN
// the 30-day window whose latest fact is merely stale-but-recent. The two clocks
// are distinct — the collector's ~15-minute `deriveStale` window (host-metrics.ts)
// answers "is this fact fresh enough to show?", while THIS 30-day window answers
// "is this entity alive enough to monitor at all?". Never conflate them.
//
// The boundary is INCLUSIVE (`<=`): an entity whose age equals the window
// exactly still survives — the window can only widen at the edge, never silently
// tighten (threat T-12-08-01: a live-but-quiet entity must not be wrongly
// eliminated; 30 days is far beyond any healthy poll interval).

/** LOCKED monitoring-liveness window in days — an entity silent longer is gone. */
export const STALENESS_CUTOFF_DAYS = 30;

/** The LOCKED window in milliseconds (derived from the day constant). */
export const STALENESS_CUTOFF_MS = STALENESS_CUTOFF_DAYS * 24 * 60 * 60 * 1000;

/**
 * Generic 30-day staleness eliminator. Keeps an item ONLY when its stamp is a
 * non-null `Date` AND its age (`nowMs - stamp`) is within `maxAgeMs` (inclusive).
 * A null stamp is DROPPED (never reported = gone — LOCKED backlog #8).
 *
 * Pure and deterministic: same `(items, stampOf, nowMs, maxAgeMs)` yields the
 * same surviving set. Never mutates `items` (returns a new array via `.filter`);
 * survivor order preserves input order (no `.sort`).
 *
 * @param items     the layer's entity array (nodes / hosts / services / …)
 * @param stampOf   per-item accessor returning the latest data `Date` or `null`
 * @param nowMs     the clock, in ms; defaults to `Date.now()`
 * @param maxAgeMs  the liveness window in ms; defaults to `STALENESS_CUTOFF_MS`
 * @returns a new array of only the entities alive within the window
 */
export function applyFreshnessCutoff<T>(
  items: T[],
  stampOf: (item: T) => Date | null,
  nowMs: number = Date.now(),
  maxAgeMs: number = STALENESS_CUTOFF_MS,
): T[] {
  return items.filter((item) => {
    const stamp = stampOf(item);
    if (stamp == null) return false; // never reported = gone (LOCKED)
    return nowMs - stamp.getTime() <= maxAgeMs; // inclusive boundary
  });
}
