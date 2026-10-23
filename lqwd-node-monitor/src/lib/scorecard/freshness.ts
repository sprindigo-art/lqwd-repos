// =====================================================
// D-13 — per-node worst-case freshness (pure, no DB)
// =====================================================
// Each node's "data as of" = the OLDEST of the latest timestamps across the
// tables its AVAILABLE dimensions depend on — the honest staleness floor: the
// grade is only as fresh as its stalest input. The CALLER excludes the restart
// dimension (lnd_restart.last_restart is legitimately old — a year-old restart
// must not flag every node stale, RESEARCH A5) and any no-data dim before
// handing asOf stamps in. Past the tunable threshold (STALENESS.warnAfterHours)
// the node gets a "stale" marker — still shown, never hidden.

const MS_PER_HOUR = 3600 * 1000;

/** MIN (oldest) of the non-null Dates; null when none are available. */
export function worstCaseAsOf(asOfs: Array<Date | null>): Date | null {
  let oldest: Date | null = null;
  for (const asOf of asOfs) {
    if (asOf === null) continue;
    if (oldest === null || asOf.getTime() < oldest.getTime()) oldest = asOf;
  }
  return oldest;
}

/**
 * Stale when the worst-case stamp is older than warnAfterHours (strictly past
 * the threshold). A null asOf (no timestamped inputs at all) is stale — the
 * fail-loud default: unknown freshness must never read as fresh.
 */
export function isStale(asOf: Date | null, warnAfterHours: number, now: Date = new Date()): boolean {
  if (asOf === null) return true;
  return now.getTime() - asOf.getTime() > warnAfterHours * MS_PER_HOUR;
}
