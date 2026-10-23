// =====================================================
// Pitfall 7 — shared counter-reset clamp for cumulative counters
// =====================================================
// The warehouses store cumulative counters RAW (net_rx_bytes, tcp_retrans_segs,
// pg_stat_database.xact_rollback, …). Those counters reset to 0 on a PG restart /
// `pg_stat_reset()` / interface reset, so a naive `curr - prev` at read time can
// go NEGATIVE. Every rate derivation in the Plan-04/05 readers (pg-health.ts,
// host-metrics-ext.ts) goes through THIS single pure clamp instead.
//
// Contract (Δ is ALWAYS ≥ 0 or null — never negative):
//   - normal case (curr ≥ prev, same reset epoch)  → curr − prev
//   - curr < prev (counter went backwards ⇒ reset) → curr (fresh baseline)
//   - currReset differs from prevReset             → curr (reset boundary,
//     even if curr ≥ prev — the epochs are not comparable)
//   - prev null/undefined (no prior sample)        → null (no rate derivable
//     yet — honest no-data, mirrors the D-13 posture)
//
// Pure module: NO DB imports, no side effects, no clock — test-imported and
// safe anywhere (same posture as telemetry-bands.ts).

/** Counter inputs arrive as bigint (raw-execute pg bigint) or number. */
type CounterValue = bigint | number;

/** Normalize bigint|number to a plain number for the returned Δ. */
function toNum(v: CounterValue): number {
  return typeof v === "bigint" ? Number(v) : v;
}

/**
 * Clamp a cumulative-counter delta across reset boundaries (Pitfall 7).
 *
 * @param prev      Prior sample's counter value, or null/undefined if none exists.
 * @param curr      Current sample's counter value.
 * @param prevReset Prior sample's reset stamp (e.g. `pg_stat_database.stats_reset`),
 *                  if the source exposes one. Optional.
 * @param currReset Current sample's reset stamp. Optional.
 * @returns Δ ≥ 0, or null when no prior sample exists (no rate derivable yet).
 */
export function clampCounterDelta(
  prev: CounterValue | null | undefined,
  curr: CounterValue,
  prevReset?: string | null,
  currReset?: string | null,
): number | null {
  // No prior sample → no rate derivable yet (honest no-data).
  if (prev === null || prev === undefined) return null;

  const prevN = toNum(prev);
  const currN = toNum(curr);

  // stats_reset moved → the two samples are in different counter epochs;
  // curr is the fresh baseline even if it happens to exceed prev.
  // (null/undefined on both sides means the source has no stamp — same epoch.)
  const prevStamp = prevReset ?? null;
  const currStamp = currReset ?? null;
  if (prevStamp !== currStamp) return currN;

  // Counter went backwards → reset happened between samples; curr is the baseline.
  if (currN < prevN) return currN;

  // Normal case.
  return currN - prevN;
}
