import { sql, type SQL } from "drizzle-orm";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { FLEET_PENDING_LINK } from "@/lib/insight/deeplink";
import { CARD_SCHEMA_VERSION, type InsightCard, type Severity } from "@/lib/insight/types";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// D-10 fleet temporal close-cluster correlation (Phase 4 — INSIGHT-05, detector 8)
// =====================================================
// Source: `lnd_node_closed_channels` — identity column `local_pubkey`
// (Pitfall 6: forwards/sweeps partition on lnd_pubkey; this table does NOT).
// ONE ROW PER CLOSE (verified near-1:1 chan_id) — aggregate BY ROW, no
// DISTINCT ON (this is not an event-duplicated table).
//
// Cascade signatures (operational-anti-patterns.md AP-11 evidence): 2024-09-09
// fleet-wide — France 93 self-initiated in one hour + India + Sweden the same
// day (≥3 nodes, critical); post-migration reciprocation — 2025-07-16
// Canada+Australia, 2025-09-02 four nodes (≥2 nodes, warn). The per-node
// minimum is deliberately FAR below AP-11's single-node storm line (read from
// SCORECARD_CONFIG by close-storm.ts) so the cluster detector catches the
// cascade EARLIER and WIDER than the per-node red line.
//
// Known v1 limitation (Pitfall 8 — hour-bucket aliasing): fixed
// date_trunc('hour') buckets smear a storm straddling a bucket boundary
// (:58–:02) across two buckets; each side can sit below the per-node line
// during a real cascade onset. Accepted v1 risk — the 2024 reference event
// (93 in one hour) is far above smear sensitivity, and the low per-node knob
// trips within the next full bucket. A sliding window is a v2 knob; the
// boundary-straddle golden fixture asserts current behavior explicitly.
//
// All knobs live in INSIGHT_CONFIG (D-13): clusterScanWindowHours,
// clusterPerNodeMinCloses, clusterMinNodesWarn, clusterMinNodesCritical.
// The window is NUMBER-typed and parameter-bound (T-04-06); the
// close_initiator filter is a fixed enum literal — never user input.

/**
 * Hour-bucketed fleet aggregate of self-initiated closes: one row per
 * (bucket_hour, node) with its close count inside the scan window.
 * `scanWindowHours` is bound; INITIATOR_LOCAL is a fixed literal.
 */
export function buildClusterSql(scanWindowHours: number): SQL {
  return sql`
    SELECT
      date_trunc('hour', timestamp) AS bucket_hour,
      local_pubkey,
      COUNT(*) AS close_count
    FROM lnd_node_closed_channels
    WHERE local_pubkey IS NOT NULL
      AND close_initiator = 'INITIATOR_LOCAL'
      AND timestamp > now() - make_interval(hours => ${scanWindowHours})
    GROUP BY date_trunc('hour', timestamp), local_pubkey
  `;
}

/** Raw-row shape surfaced by drizzle .execute for buildClusterSql. */
export interface ClusterRow {
  // STRING at runtime: drizzle's postgres-js adapter overrides the driver's
  // timestamp parsers — raw .execute surfaces date_trunc as an offset-less
  // string; coerce via parseDbTimestampUtc (WR-01, never host-local).
  bucket_hour: Date | string;
  local_pubkey: string;
  close_count: number | string | bigint;
}

/**
 * Pure D-10 detection: per hour bucket, the nodes with at least
 * `clusterPerNodeMinCloses` self-initiated closes form the cluster; fire ONE
 * fleet card per qualifying bucket — critical at `clusterMinNodesCritical`
 * nodes, warn at `clusterMinNodesWarn`. Below the warn line (including the
 * single-node case) → no card: one loud node is AP-11 close-storm's job.
 */
export function detectCloseCluster(rows: ClusterRow[], config: InsightKnobs): InsightCard[] {
  // bucket ISO → (pubkey → self-close count), coerced once at the boundary.
  const buckets = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const bucket = parseDbTimestampUtc(row.bucket_hour);
    if (bucket === null) continue;
    const count = Number(row.close_count);
    if (!Number.isFinite(count)) continue;
    const iso = bucket.toISOString();
    let nodeCounts = buckets.get(iso);
    if (!nodeCounts) {
      nodeCounts = new Map<string, number>();
      buckets.set(iso, nodeCounts);
    }
    nodeCounts.set(row.local_pubkey, (nodeCounts.get(row.local_pubkey) ?? 0) + count);
  }

  const cards: InsightCard[] = [];
  // Deterministic output order: buckets ascending by hour.
  for (const bucketIso of [...buckets.keys()].sort()) {
    const nodeCounts = buckets.get(bucketIso)!;
    const qualifying = [...nodeCounts.entries()].filter(
      ([, count]) => count >= config.clusterPerNodeMinCloses,
    );
    let severity: Severity;
    let threshold: number;
    if (qualifying.length >= config.clusterMinNodesCritical) {
      severity = "critical";
      threshold = config.clusterMinNodesCritical;
    } else if (qualifying.length >= config.clusterMinNodesWarn) {
      severity = "warn";
      threshold = config.clusterMinNodesWarn;
    } else {
      continue;
    }

    const pubkeys = qualifying.map(([pubkey]) => pubkey).sort();
    // Per-node counts + the bucket hour — the inbox renders these and each
    // member node's console is one click away via its own pubkey.
    const detail: Record<string, string | number> = { bucketHour: bucketIso };
    for (const [pubkey, count] of qualifying) detail[pubkey] = count;

    cards.push({
      schemaVersion: CARD_SCHEMA_VERSION,
      // D-08 dedupe id: the hour bucket IS the event identity for fleet
      // cluster cards (types.ts banner) — sorted pubkeys + bucket hour.
      id: `fleet_close_cluster:fleet:${pubkeys.join("+")}:${bucketIso}`,
      severity,
      node: null,
      target: { kind: "fleet", pubkeys },
      signal: "fleet_close_cluster",
      evidence: {
        metric: "sameHourSelfCloseNodes",
        observed: qualifying.length,
        threshold,
        unit: "nodes",
        window: `${config.clusterScanWindowHours}h`,
        asOf: bucketIso,
        deepLink: FLEET_PENDING_LINK,
        detail,
      },
      // AP-11 playbook: investigate ONLY — this card never carries write params.
      suggestedAction: { type: "investigate", params: {} },
      suppressed: { active: false, reason: null },
      provenance: "deterministic",
      rateLimitGuidance: null,
    });
  }
  return cards;
}

/**
 * Lazy-import executor: runs the bounded windowed aggregate (T-04-07 — single
 * scan, GROUP BY bounded by fleet size) and hands rows to the pure detector.
 * The dynamic import keeps the server-only `dbRouting` client (postgres()
 * pool + env at module load) out of the no-DB shape test's import graph.
 */
export async function closeClusterCards(
  config: InsightKnobs = INSIGHT_CONFIG.lnd,
): Promise<InsightCard[]> {
  const { dbRouting } = await import("@/lib/db/warehouse-routing");
  const result = await dbRouting.execute(buildClusterSql(config.clusterScanWindowHours));
  return detectCloseCluster(result as unknown as ClusterRow[], config);
}
