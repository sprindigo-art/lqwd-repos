// =====================================================
// ttl.ts — THE single validated NODEMON_TTL_HOURS reader (D-11 / WR-04)
// =====================================================
// Pure module (no server runtime imports). Read at CALL time (not module load)
// so a test overriding NODEMON_TTL_HOURS in env takes effect. WR-04: a
// non-numeric / non-positive env value (typo, "24h", empty string) falls back
// to the default instead of yielding NaN — `new Date(NaN).toISOString()`
// throws a RangeError, which previously 500'd the whole channels surface.
// Shared by enqueue.ts, enqueue-props.ts, and channel-enqueue-props.ts so the
// enqueue-time TTL and the preview labels can never diverge on bad config.

/** Default command TTL in hours (D-11) when NODEMON_TTL_HOURS is unset/invalid. */
export const DEFAULT_TTL_HOURS = 24;

/** Config-tunable TTL (D-11), validated: finite and > 0, else the default. */
export function ttlHours(): number {
  const raw = process.env.NODEMON_TTL_HOURS;
  if (raw === undefined) return DEFAULT_TTL_HOURS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_HOURS;
}

/**
 * Humanized "expires" preview label (IN-05): relative TTL plus a compact,
 * deterministic UTC timestamp — never the raw ISO-8601 string. Formatted
 * server-side so every timestamp on the operator-decision panel reads the
 * same way. E.g. `in 24h (2026-07-11 03:14 UTC)`.
 */
export function expiryLabel(expiresAt: Date): string {
  const compactUtc = expiresAt.toISOString().slice(0, 16).replace("T", " ");
  return `in ${ttlHours()}h (${compactUtc} UTC)`;
}
