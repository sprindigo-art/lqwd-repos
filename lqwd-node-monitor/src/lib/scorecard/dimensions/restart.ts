import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import type { DimensionResult } from "@/lib/scorecard/types";

// =====================================================
// Restart dimension (D-01 #6) — RECENCY ONLY
// =====================================================
// RECENCY ONLY — restart-loop Tier-1 is deferred until restart-history
// ingestion exists: `lnd_restart` stores ONLY the latest restart per node
// (columns: alias, pubkey, restarted, last_restart — no history; RESEARCH
// Open Question 2). A ≥2-in-window loop detector has no history to count, so
// this module promises NOTHING beyond "hours since the last restart".
//
// asOf is LEGITIMATELY OLD (verified Canada last_restart = 2025-03-13, >1yr) —
// a long uptime is the GOOD case here. fleet.ts therefore EXCLUDES restart
// from the D-13 worst-case freshness floor (RESEARCH A5); including it would
// flag every healthy node "stale".

/**
 * Latest restart row per node. Defensive DISTINCT ON even though the table is
 * documented as one-row-per-node today — it costs nothing and prevents drift
 * if the warehouse ever starts appending history (AFM-001 posture).
 */
export function buildRestartAllSql(): SQL {
  return sql`
    SELECT DISTINCT ON (pubkey) pubkey, last_restart, restarted
    FROM lnd_restart
    WHERE pubkey IS NOT NULL
    ORDER BY pubkey, last_restart DESC
  `;
}

/** Row shape surfaced by drizzle .execute for the builder above. last_restart
 * arrives as a STRING from postgres.js (raw .execute does not run the column
 * parsers Drizzle's typed selects use) — coerce at the mapping boundary. */
interface RestartRow {
  pubkey: string;
  last_restart: Date | string | null;
  restarted: boolean | null;
}

/** Coerce the raw driver value to a real Date (null stays null, invalid → null).
 * WR-01: `lnd_restart.last_restart` is `timestamp without time zone` storing
 * UTC wall time — offset-less strings MUST be parsed as UTC, never host-local,
 * via the shared boundary helper. */
export function toRestartDate(value: Date | string | null): Date | null {
  return parseDbTimestampUtc(value);
}

/**
 * Hours elapsed since `lastRestart`, rounded to 1 decimal; null when unknown.
 * Pure helper exported for the no-DB formula test.
 */
export function hoursSince(lastRestart: Date | null, nowMs: number = Date.now()): number | null {
  if (lastRestart == null) return null;
  return Math.round(((nowMs - lastRestart.getTime()) / 3_600_000) * 10) / 10;
}

/**
 * Restart dimension for the whole fleet: raw = hours since last_restart
 * (higher = longer uptime = better per config band); asOf = last_restart.
 */
export async function restartForFleet(): Promise<Map<string, DimensionResult>> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildRestartAllSql());
  const rows = result as unknown as RestartRow[];

  const out = new Map<string, DimensionResult>();
  for (const row of rows) {
    const lastRestart = toRestartDate(row.last_restart);
    out.set(row.pubkey, {
      raw: hoursSince(lastRestart),
      asOf: lastRestart,
    });
  }
  return out;
}
