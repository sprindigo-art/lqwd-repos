// =====================================================
// WR-01 — UTC-explicit driver-boundary timestamp parse
// =====================================================
// Every consumed warehouse timestamp column (lnd_node_info.timestamp,
// lnd_node_channel_info.timestamp, lnd_node_closed_channels.timestamp,
// lnd_restart.last_restart) is `timestamp WITHOUT time zone` and the writer
// stores UTC wall time (live-verified: max(timestamp) 04:10 vs warehouse
// now()-UTC 04:13). Drizzle's postgres-js adapter overrides the driver's
// timestamp parsers, so raw `.execute()` surfaces these columns as
// OFFSET-LESS strings (e.g. "2026-06-10 04:10:26") — and JavaScript
// `new Date(offset-less)` parses HOST-LOCAL, shifting every asOf by the
// host's UTC offset (+7h on an America/Vancouver host, which pushed the
// D-13 6-hour stale flag out to ~13h). This helper is the ONE place the
// rule lives: offset-less warehouse strings are UTC. Every raw-execute
// timestamp coercion MUST route through it.

/**
 * Parse a raw-execute warehouse timestamp into a real Date, treating
 * OFFSET-LESS strings as UTC.
 *
 * - `Date` instances pass through unchanged.
 * - Strings with an explicit offset (`Z`, `+00`, `-07:00`, …) are parsed
 *   AS-IS — V8's lenient parser already honors the offset, and bare `+00`
 *   only parses on the space-separated path, so do NOT rewrite them.
 * - Offset-less strings get the separator normalized (space → `T`) and a
 *   `Z` appended, pinning the UTC interpretation regardless of host TZ.
 * - `null` stays `null`; unparseable input returns `null` (never an
 *   Invalid Date).
 */
export function parseDbTimestampUtc(value: Date | string | null): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const s = value.trim();
  // Offset detection: anything after the YYYY-MM-DD prefix containing
  // Z/z/+/- is an explicit offset (the time-of-day part can never contain
  // those characters). slice(10) skips the date's own hyphens.
  const hasExplicitOffset = /[Zz+-]/.test(s.slice(10));
  const date = hasExplicitOffset ? new Date(s) : new Date(`${s.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
