// =====================================================
// QUEUE-01/03/04 — pure command state machine + clock-injectable TTL
// =====================================================
// PURE module (no DB/env) so the deterministic suite drives it without a pool
// (RESEARCH Pitfall 7). The transition table is the lost-update guard: every
// flip is a transactional `UPDATE … WHERE id=? AND state=<expected>` PLUS an
// audit insert; `canTransition` pins the legal edges enforced in code + tests.
//
// State machine (RESEARCH §Pattern 4):
//   draft → pending_approval → approved → claimed → executing → succeeded|failed
//   + terminal `rejected` (from pending_approval)
//   + terminal `expired` (fail-closed TTL from any non-terminal pre-execution state)
//   + terminal `withdrawn` (D-01 operator-undo edge — approved → withdrawn ONLY)

export const LEGAL: Record<string, readonly string[]> = {
  draft: ["pending_approval", "expired"],
  pending_approval: ["approved", "rejected", "expired"],
  approved: ["claimed", "expired", "withdrawn" /* D-01 operator undo */],
  claimed: ["executing", "approved" /* reaper release */, "failed" /* reaper fail */, "expired"],
  executing: ["succeeded", "failed"],
  succeeded: [],
  failed: [],
  rejected: [],
  expired: [],
  withdrawn: [],
};

/** True ONLY for a legal edge in the transition table; unknown from-state → false. */
export function canTransition(from: string, to: string): boolean {
  return LEGAL[from]?.includes(to) ?? false;
}

/**
 * Clock-injectable, fail-closed TTL check (mirrors freshness.isStale(now=…)).
 * A row is expired when its `expiresAt` is STRICTLY before `now` — exactly at
 * the deadline is not yet expired. Accepts an ISO string or a Date so callers
 * can pass the row value directly.
 */
export function isExpired(expiresAt: string | Date, now: Date = new Date()): boolean {
  const deadline = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return deadline.getTime() < now.getTime();
}
