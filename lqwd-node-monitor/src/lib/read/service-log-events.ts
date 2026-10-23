import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { deriveStale } from "@/lib/read/host-metrics";
import type { NodeLogLine } from "@/components/node/NodeLogsStream";

// =====================================================
// COL-01 — service log stream with D-04 read-time benign suppression
// =====================================================
// `service_log_events` is an APPEND-HISTORY log fact: the collector persists
// EVERYTHING it matches (suppression is never a collect-time drop — D-04/D-10).
// Benign filtering happens HERE, at read, by LEFT JOINing `log_patterns_config`
// on the event's `config_id` — the matched-pattern PRIMARY KEY the collector
// stamped at classify time — and dropping rows whose matched pattern has
// `suppress = true`. Re-tuning a benign rule is a single UPDATE on the config
// row; no fleet redeploy, no data loss.
//
// JOIN KEY DISCIPLINE: the join is `c.id = e.config_id`, NEVER
// `c.classification = e.classification`. Classification is a 6-value class that
// does NOT uniquely determine `suppress` — the `benign` class holds both
// suppress=true BP-rows and the suppress=false `SQLSTATE 40001` sibling, and
// `critical` holds several sibling rows. A classification join would therefore
// (a) INVERT suppression — a BP-001 event joins the suppress=false 40001
// sibling and leaks into the UI — and (b) FAN OUT rows — one critical event
// rendered once per sibling config row. The PK join is 1:1: neither happens.
// An event with config_id = NULL (unmatched/"other") LEFT-JOINs to no config
// row, COALESCE yields false, and the line SURVIVES — unmatched lines are
// shown, never silently dropped.
//
// TAXONOMY (Phase-16, D-04/D-05): classification is re-derived into
// {info, warn, critical} with a human-readable `category` label; the opaque
// ap11/ap12 codes are gone. This read layer NEVER branches on the classification
// STRING — the config_id PK join above is the only suppression mechanism, so the
// rename is inert here (the join and the config_id=NULL survival invariant are
// load-bearing and unchanged). D-05 info-tier collect-time override: info lines
// are COUNT-ONLY at collect time (their aggregate survives in log_patterns — D-06),
// so info exemplars are suppressed via their config row's suppress flag while
// warn/critical exemplars stay visible and rate-banded. The AP-12 advisory fires
// purely from pg_health COUNTERS (ap12-advisory.ts / telemetry-bands.ts) and is
// unaffected by dropping the old ap12 LOG class (D-04).
//
// This is a log STREAM (newest-first, LIMIT N), NOT a latest-per-entity read —
// so it orders `collected_at DESC LIMIT n` and deliberately has no DISTINCT ON.
// `hostId` / `service` are ALWAYS parameter-bound via the Drizzle `sql`
// template, never string-concatenated (T-15-01). The message is returned as
// INERT data only — never evaluated, interpolated, or fed to command derivation
// (T-15-05 / T-15-07); downstream React rendering escapes it.
//
// Staleness is DERIVED at read time via `deriveStale` (D-13) — no stored flag.

/** Default stream depth — enough for the UI tail without a firehose. */
const DEFAULT_LIMIT = 500;

/** Raw row shape from `service_log_events` (raw-execute column names). */
export interface ServiceLogEventRow {
  id: string;
  host_id: string;
  collected_at: Date | string | null;
  service_name: string | null;
  level: string | null;
  message: string | null;
}

/** The reader's view: mapped lines + read-time data-freshness honesty. */
export interface ServiceLogEventsView {
  /** Newest-first, benign-suppressed lines in the shipped NodeLogLine shape. */
  lines: NodeLogLine[];
  /** collected_at of the newest surviving line (null when no lines). */
  asOf: Date | null;
  /** Read-time D-13 derivation off `asOf`; true when no lines exist. */
  stale: boolean;
}

/**
 * Build the COL-01 log-stream fragment for one host (optionally one service).
 * LEFT JOIN keyed on the matched-pattern PRIMARY KEY (`c.id = e.config_id`) so
 * `suppress` resolves per PATTERN — never per classification (see module doc).
 * Exposed separately so the no-DB shape test asserts the emitted SQL without a
 * live nodemon connection. All inputs are bound parameters, never interpolated.
 */
export function buildServiceLogEventsSql(hostId: string, service: string | null): SQL {
  return sql`
    SELECT e.id, e.host_id, e.collected_at, e.service_name, e.level, e.message
    FROM service_log_events e
    LEFT JOIN log_patterns_config c ON c.id = e.config_id
    WHERE e.host_id = ${hostId}
      AND e.host_id IS NOT NULL
      ${service == null ? sql`` : sql`AND e.service_name = ${service}`}
      AND COALESCE(c.suppress, false) = false
    ORDER BY e.collected_at DESC
    LIMIT ${DEFAULT_LIMIT}
  `;
}

/**
 * Narrow a raw log level to the NodeLogLine chip vocabulary. Unknown levels
 * (including "debug") read as "info" — the chip never renders a raw value.
 */
function narrowLevel(level: string | null | undefined): NodeLogLine["level"] {
  const l = (level ?? "").toLowerCase();
  if (l === "error" || l === "err" || l === "fatal" || l === "crit" || l === "critical") {
    return "error";
  }
  if (l === "warn" || l === "warning") return "warn";
  return "info";
}

/** Pre-format a timestamp for the mono TIME column (UTC, reader-side — D-13). */
function formatTs(collectedAt: Date | null): string {
  if (collectedAt == null) return "—";
  const iso = collectedAt.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/**
 * Map one raw row to the shipped NodeLogLine shape. The reader does ALL
 * formatting (ts is a pre-formatted string; level is narrowed); the message
 * passes through UNCHANGED as inert text.
 */
export function mapServiceLogEventRow(row: ServiceLogEventRow): NodeLogLine {
  return {
    id: row.id,
    service: row.service_name ?? "unknown",
    ts: formatTs(parseDbTimestampUtc(row.collected_at)),
    level: narrowLevel(row.level),
    message: row.message ?? "",
  };
}

/**
 * Newest-first, benign-suppressed (per matched pattern via config_id) log lines
 * for one host, optionally scoped to one service. Reads the RW `dbNodemon`
 * client; staleness derived at read time off the newest surviving line.
 */
export async function getServiceLogEvents(
  hostId: string,
  service: string | null = null,
): Promise<ServiceLogEventsView> {
  // Lazy import keeps the server-only `dbNodemon` client (postgres() pool +
  // requireEnv at module load) out of the no-DB shape test's import graph.
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const rows = (await dbNodemon.execute(
    buildServiceLogEventsSql(hostId, service),
  )) as unknown as ServiceLogEventRow[];

  const lines = rows.map(mapServiceLogEventRow);
  const asOf = rows.length > 0 ? parseDbTimestampUtc(rows[0].collected_at) : null;

  return { lines, asOf, stale: deriveStale(asOf) };
}
