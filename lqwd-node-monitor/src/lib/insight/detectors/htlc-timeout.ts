import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import type { InsightKnobs } from "@/lib/insight/config";
import { buildDeepLink } from "@/lib/insight/deeplink";
import { CARD_SCHEMA_VERSION, type InsightCard } from "@/lib/insight/types";

// buildDeepLink THROWS on a non-`^[0-9a-f]{66}$` pubkey (open-redirect gate).
// This detector runs inside assembleCards, which is NOT degrade()-wrapped — so
// one malformed warehouse local_pubkey would reject the whole insight view
// (review I2). Pre-check here (mirroring stuck-pending) and skip the offending
// node's card: fail-soft to fewer cards, never throw out of assembly.
const PUBKEY_RE = /^[0-9a-f]{66}$/;

// =====================================================
// HTLC-timeout force-close signature detector (INSIGHT-02, Detector 4)
// =====================================================
// Source: `lnd_node_closed_channels` — ONE ROW PER CLOSE (verified 3,238 rows /
// 3,177 distinct chan_id for Canada — near 1:1). Identity column:
// `local_pubkey`. Aggregate BY ROW; no DISTINCT ON (this is NOT an
// event-duplicated table like lnd_node_channel_info).
//
// Signature [CITED: force-close-analysis-methodology.md Query 1]: a
// LOCAL_FORCE_CLOSE row is HTLC-timeout-signed when
//   time_locked_balance > 0 AND settled_balance::float / NULLIF(capacity, 0) < 0.8
// Fleet reference ratios: Canada LOCAL_FC settled ratio 0.701 (99% time-locked),
// France 0.651 (100%); undersettled cascade ratios 0.4–0.6.
//
// Window param is NUMBER-TYPED and parameter-bound via the Drizzle `sql`
// template (T-04-08); the 24h escalation bucket and the close_type enum are
// fixed literals from the verified enum set — never user input. Thresholds
// (warn ≥ htlcTimeoutMinCount in window, critical ≥ htlcTimeoutCriticalCount
// in 24h) live in INSIGHT_CONFIG (D-13) — never embedded here.

/**
 * Fleet-wide HTLC-timeout signature aggregate, bounded to the rolling window
 * (T-02-05): per node, the count of signature-matching LOCAL_FCs in the
 * window, the same count inside the fixed 24h escalation bucket, the avg
 * settled ratio and total time-locked balance over the signature rows, and
 * the latest close timestamp. One row per close — plain GROUP BY, no
 * DISTINCT ON (see banner). `windowDays` is bound.
 */
export function buildHtlcTimeoutSql(windowDays: number): SQL {
  return sql`
    SELECT
      local_pubkey,
      COUNT(*) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE'
        AND time_locked_balance > 0
        AND settled_balance::float / NULLIF(capacity, 0) < 0.8) AS sig_count,
      COUNT(*) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE'
        AND time_locked_balance > 0
        AND settled_balance::float / NULLIF(capacity, 0) < 0.8
        AND timestamp > now() - make_interval(hours => 24)) AS sig_count_24h,
      AVG(settled_balance::float / NULLIF(capacity, 0)) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE'
        AND time_locked_balance > 0
        AND settled_balance::float / NULLIF(capacity, 0) < 0.8) AS avg_settled_ratio,
      SUM(time_locked_balance) FILTER (WHERE close_type = 'LOCAL_FORCE_CLOSE'
        AND time_locked_balance > 0
        AND settled_balance::float / NULLIF(capacity, 0) < 0.8) AS total_time_locked,
      MAX(timestamp) AS as_of
    FROM lnd_node_closed_channels
    WHERE local_pubkey IS NOT NULL
      AND timestamp > now() - make_interval(days => ${windowDays})
    GROUP BY local_pubkey
  `;
}

/** Raw row shape surfaced by drizzle .execute for the builder above. */
interface HtlcTimeoutAggRow {
  local_pubkey: string;
  sig_count: number | string | bigint;
  sig_count_24h: number | string | bigint;
  avg_settled_ratio: number | string | null;
  total_time_locked: number | string | bigint | null;
  // STRING at runtime: drizzle's postgres-js adapter overrides the driver's
  // timestamp parsers, so raw .execute surfaces MAX(timestamp) as an ISO
  // string — coerce via parseDbTimestampUtc in the mapping below (WR-01).
  as_of: Date | string | null;
}

/** Coerced per-node signature aggregate — the pure detect() input. */
export interface HtlcRow {
  pubkey: string;
  /** Signature-matching LOCAL_FCs in the rolling window (htlcWindowDays). */
  sigCount: number;
  /** Signature-matching LOCAL_FCs in the fixed 24h escalation bucket. */
  sigCount24h: number;
  /** AVG settled ratio over signature rows — null when the node has none. */
  avgSettledRatio: number | null;
  /** SUM(time_locked_balance) over signature rows, sats (raw — AFM-002 at render). */
  totalTimeLockedSat: number;
  /** Latest close timestamp in the window (UTC — WR-01). */
  asOf: Date | null;
}

/**
 * The ONE mapping layer: every numeric coerces via Number(), every timestamp
 * via parseDbTimestampUtc (WR-01 — offset-less warehouse strings are UTC).
 */
function mapHtlcRows(rows: HtlcTimeoutAggRow[]): HtlcRow[] {
  return rows.map((row) => ({
    pubkey: row.local_pubkey,
    sigCount: Number(row.sig_count),
    sigCount24h: Number(row.sig_count_24h),
    // NULL when the node has no signature rows in the window — keep null
    // rather than fabricate a 0 ratio.
    avgSettledRatio: row.avg_settled_ratio == null ? null : Number(row.avg_settled_ratio),
    totalTimeLockedSat: row.total_time_locked == null ? 0 : Number(row.total_time_locked),
    asOf: parseDbTimestampUtc(row.as_of),
  }));
}

/**
 * Fetch + coerce the fleet-wide signature aggregate. Lazy import keeps the
 * server-only `dbRouting` client (postgres() pool + env at module load) out
 * of the no-DB shape test's import graph (T-04-09).
 */
export async function fetchHtlcTimeoutRows(windowDays: number): Promise<HtlcRow[]> {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildHtlcTimeoutSql(windowDays));
  return mapHtlcRows(result as unknown as HtlcTimeoutAggRow[]);
}

/** Node metadata the caller supplies — detect() stays pure (no backendFor/env). */
export interface HtlcNodeMeta {
  alias: string | null;
  backend: "lnd" | "ldk";
}

// Unreachable in practice for a firing row (a node only appears in the GROUP
// BY with ≥1 close in the window, so MAX(timestamp) is non-null) — an epoch
// sentinel is honest about "unknown", never a fabricated "now".
const EPOCH = new Date(0);

/**
 * Pure detection over coerced rows (fixture-testable, no DB):
 *  - critical when `sigCount24h >= htlcTimeoutCriticalCount` (escalation —
 *    supersedes warn; one card per node max);
 *  - warn when `sigCount >= htlcTimeoutMinCount` over the rolling window;
 *  - silent below the warn floor (healthy band 0–1 FC/month).
 * Thresholds and the window string come from `config` (D-13) — never embedded.
 * Suggested action is investigate-ONLY: mechanism diagnosis (chain-backend
 * sync health per the AP-11 residual-risk note) is a human job, never a write.
 * Evidence detail carries avgSettledRatio/totalTimeLockedSat RAW (AFM-002
 * formatter applies at render only).
 */
export function detectHtlcTimeout(
  rows: HtlcRow[],
  config: InsightKnobs,
  nodeMeta: ReadonlyMap<string, HtlcNodeMeta>,
): InsightCard[] {
  const cards: InsightCard[] = [];
  for (const row of rows) {
    const isCritical = row.sigCount24h >= config.htlcTimeoutCriticalCount;
    const isWarn = row.sigCount >= config.htlcTimeoutMinCount;
    if (!isCritical && !isWarn) continue;
    // I2 fail-soft: a malformed pubkey can't build a deep link — skip this card.
    if (!PUBKEY_RE.test(row.pubkey)) continue;

    // Caller-supplied metadata; absent entries fall back to the D-03 default
    // backend ("lnd") with no alias — same posture as backendFor.
    const meta = nodeMeta.get(row.pubkey) ?? { alias: null, backend: "lnd" as const };

    const detail: Record<string, number> = { totalTimeLockedSat: row.totalTimeLockedSat };
    // NULL aggregate (no signature rows) — omit rather than fabricate a ratio.
    if (row.avgSettledRatio != null) detail.avgSettledRatio = row.avgSettledRatio;

    cards.push({
      schemaVersion: CARD_SCHEMA_VERSION,
      // Dedupe-id rule (D-08): `${signal}:${pubkey}:${targetKey}`, node target
      // key is the literal "node" — stable across recomputes, no randomness.
      id: `htlc_timeout_fc:${row.pubkey}:node`,
      severity: isCritical ? "critical" : "warn",
      node: { pubkey: row.pubkey, alias: meta.alias, backend: meta.backend },
      target: { kind: "node" },
      signal: "htlc_timeout_fc",
      evidence: {
        metric: "htlcTimeoutSignatureCloses",
        observed: isCritical ? row.sigCount24h : row.sigCount,
        threshold: isCritical ? config.htlcTimeoutCriticalCount : config.htlcTimeoutMinCount,
        unit: "closes",
        window: isCritical ? "24h" : `${config.htlcWindowDays}d`,
        asOf: (row.asOf ?? EPOCH).toISOString(),
        deepLink: buildDeepLink(row.pubkey, "closes"),
        detail,
      },
      suggestedAction: { type: "investigate", params: {} },
      suppressed: { active: false, reason: null },
      provenance: "deterministic",
      rateLimitGuidance: null,
    });
  }
  return cards;
}

/**
 * Server executor: fetch the fleet aggregate, resolve node metadata
 * (backendFor + the fleet alias map the engine passes in), and run the pure
 * detector. backends.ts is `server-only` (reads process.env at module load),
 * so it is lazy-imported alongside the DB client (T-04-09).
 */
export async function htlcTimeoutCards(
  config: InsightKnobs,
  aliasByPubkey: ReadonlyMap<string, string | null> = new Map(),
): Promise<InsightCard[]> {
  const [rows, { backendFor }] = await Promise.all([
    fetchHtlcTimeoutRows(config.htlcWindowDays),
    import("@/lib/config/backends"),
  ]);

  const meta = new Map<string, HtlcNodeMeta>();
  for (const row of rows) {
    meta.set(row.pubkey, {
      alias: aliasByPubkey.get(row.pubkey) ?? null,
      backend: backendFor(row.pubkey),
    });
  }
  return detectHtlcTimeout(rows, config, meta);
}
