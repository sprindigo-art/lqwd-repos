// =====================================================
// read-only-probe — PURE verdict classifier for the boot read-only check
// =====================================================
// No client imports, no network, no env: importable from the DB-less test graph
// (health.ts eagerly constructs the postgres() singletons at module load, so the
// classifier must live OUTSIDE it to stay testable without a live warehouse).
//
// The boot probe attempts a write the ROLE should be denied on a REAL warehouse
// table — with the session `default_transaction_read_only` flag stripped first —
// so the outcome reflects the role's GRANTS, not the client session flag. This
// resolves the cross-engine health.ts:56 conflict (T-18-13): the old probe
// keyed on a temp-table create through a client that already forced the session
// read-only flag, so a `25006` session rejection (or a `42501` from a missing
// TEMP privilege) passed even for a role that could INSERT into real tables.

/** PostgreSQL SQLSTATEs the boot read-only probe keys on. */
export const READ_ONLY_SQLSTATE = "25006"; // read_only_sql_transaction (SESSION flag)
export const INSUFFICIENT_PRIV_SQLSTATE = "42501"; // insufficient_privilege (ROLE grant)

/**
 * - `read-only-confirmed`: a genuine role-level denial (42501) — the ONLY pass.
 * - `writable`: the write was accepted, or it passed the privilege gate and only
 *   then hit a later error (e.g. a 23xxx constraint) — the role CAN write.
 * - `inconclusive`: a 25006 session-flag rejection masked the role grant — the
 *   probe could NOT confirm the role is read-only, so it must fail loud.
 */
export type ReadOnlyProbeVerdict = "read-only-confirmed" | "writable" | "inconclusive";

/**
 * Classify a write-probe outcome by its SQLSTATE (or `undefined` when the write
 * was ACCEPTED). Only a role-level `42501` confirms read-only; a `25006` session
 * flag is inconclusive (never a pass); everything else means the role can write.
 */
export function classifyReadOnlyProbe(code: string | undefined): ReadOnlyProbeVerdict {
  if (code === INSUFFICIENT_PRIV_SQLSTATE) return "read-only-confirmed";
  if (code === READ_ONLY_SQLSTATE) return "inconclusive";
  return "writable";
}
