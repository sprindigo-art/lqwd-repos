import { sql, type SQL } from "drizzle-orm";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { deriveStale } from "@/lib/read/host-metrics";
import { TELEMETRY_BANDS, evaluateBand, type BandSeverity } from "@/lib/read/telemetry-bands";

// =====================================================
// TEL-03 — AFM-001 latest bitcoind chain telemetry + read-time blocks-behind + bands
// =====================================================
// `chain_telemetry` is an APPEND-HISTORY fact table: every collector tick emits a
// new row per host. The latest chain state of each host is its NEWEST row.
//
//   ✅  SELECT DISTINCT ON (host_id) ... ORDER BY host_id, collected_at DESC
//   ❌  WHERE collected_at = (SELECT MAX(collected_at) ...)  ← AFM-001 N-as-1 failure
//
// The collector stores RAW observed values ONLY (D-14): `blocks` and `headers` are
// persisted, NEVER a derived `blocks_behind` column. blocks-behind is computed HERE
// at read time, and D-14 threshold bands are attached at read time too — so
// re-tuning a band never re-ingests history. `host_id` is ALWAYS parameter-bound
// ($1), never concatenated (T-11-08). Staleness is derived from `collected_at`
// against the ~15-min window (D-13); no stored stale flag. Reads `dbNodemon`.

/** Latest-per-host row shape from `chain_telemetry` (raw-execute column names). */
export interface LatestChainTelemetryRow {
  host_id: string;
  collected_at: Date | null;
  blocks: bigint | number | null;
  headers: bigint | number | null;
  verification_progress: string | number | null;
  ibd: boolean | null;
  size_on_disk_bytes: bigint | number | null;
  peer_count: number | null;
  peers_in: number | null;
  peers_out: number | null;
  mempool_tx_count: number | null;
  mempool_bytes: bigint | number | null;
  mempool_min_fee: string | number | null;
}

/** A graded signal: the raw read-time value plus its D-14 band severity. */
export interface BandEvidence {
  value: number;
  band: BandSeverity;
}

/** The three read-time-graded chain signals (null when the input is absent). */
export interface ChainBands {
  blocksBehind: BandEvidence | null;
  verificationProgress: BandEvidence | null;
  peers: BandEvidence | null;
}

/** Per-host chain view: latest stats, read-time blocks-behind, bands, staleness. */
export interface ChainTelemetryView {
  hostId: string;
  hostname: string | null;
  collectedAt: Date | null;
  stale: boolean;
  hasData: boolean;
  ibd: boolean | null;
  /** headers - blocks, derived at read time (D-14). Null when either is missing. */
  blocksBehind: number | null;
  chain: LatestChainTelemetryRow | null;
  bands: ChainBands;
}

/**
 * Build the AFM-001 DISTINCT ON (host_id) latest-chain fragment for one host.
 * Exposed for the no-DB shape test. `hostId` is bound ($1), never interpolated.
 */
export function buildLatestChainTelemetrySql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM chain_telemetry
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
    ORDER BY host_id, collected_at DESC
  `;
}

/**
 * Fleet-wide latest chain telemetry, driven from the `hosts` DIMENSION via LEFT
 * JOIN so a declared-but-never-reported host returns NULL facts → no-data (SC#4).
 */
function buildFleetLatestChainTelemetrySql(): SQL {
  return sql`
    SELECT
      h.host_id, h.hostname,
      c.collected_at, c.blocks, c.headers, c.verification_progress, c.ibd,
      c.size_on_disk_bytes, c.peer_count, c.peers_in, c.peers_out,
      c.mempool_tx_count, c.mempool_bytes, c.mempool_min_fee
    FROM hosts h
    LEFT JOIN (
      SELECT DISTINCT ON (host_id) *
      FROM chain_telemetry
      WHERE host_id IS NOT NULL
      ORDER BY host_id, collected_at DESC
    ) c ON c.host_id = h.host_id
    ORDER BY h.host_id
  `;
}

/**
 * Read-time blocks-behind: headers - blocks (D-14 — never a stored column). Null
 * when either side is missing (no-data), so consumers don't render a phantom 0.
 */
export function deriveBlocksBehind(
  headers: bigint | number | null,
  blocks: bigint | number | null,
): number | null {
  if (headers == null || blocks == null) return null;
  return Number(headers) - Number(blocks);
}

/**
 * Attach D-14 threshold bands to a chain row at READ time (evidence = {value, band}).
 * Pure — same (row) → same evidence under the CURRENT config (re-tuning never
 * re-ingests). Returns all-null evidence for a missing row (no-data).
 */
export function buildChainEvidence(
  chain: LatestChainTelemetryRow | null,
): { blocksBehind: number | null; bands: ChainBands } {
  if (!chain) {
    return {
      blocksBehind: null,
      bands: { blocksBehind: null, verificationProgress: null, peers: null },
    };
  }
  const blocksBehind = deriveBlocksBehind(chain.headers, chain.blocks);
  const vp = chain.verification_progress == null ? null : Number(chain.verification_progress);
  const peers = chain.peer_count == null ? null : Number(chain.peer_count);
  return {
    blocksBehind,
    bands: {
      blocksBehind:
        blocksBehind == null
          ? null
          : { value: blocksBehind, band: evaluateBand(blocksBehind, TELEMETRY_BANDS.blocksBehind) },
      verificationProgress:
        vp == null
          ? null
          : { value: vp, band: evaluateBand(vp, TELEMETRY_BANDS.verificationProgress) },
      peers: peers == null ? null : { value: peers, band: evaluateBand(peers, TELEMETRY_BANDS.peers) },
    },
  };
}

/**
 * Latest chain telemetry for every DECLARED host: latest-per-host (DISTINCT ON),
 * read-time blocks-behind + D-14 bands, read-time staleness, never-reported hosts
 * as no-data. Reads the RW `dbNodemon` client.
 */
export async function getChainTelemetry(): Promise<ChainTelemetryView[]> {
  // Lazy import keeps the server-only `dbNodemon` client out of the no-DB shape
  // test's import graph (postgres() pool + requireEnv at module load).
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const rows = (await dbNodemon.execute(
    buildFleetLatestChainTelemetrySql(),
  )) as unknown as (LatestChainTelemetryRow & { hostname: string | null })[];

  return rows.map((row) => {
    const { hostname, ...chainCols } = row;
    const collectedAt = parseDbTimestampUtc(row.collected_at as Date | string | null);
    const hasData = collectedAt != null;
    const chain: LatestChainTelemetryRow | null = hasData
      ? { ...chainCols, collected_at: collectedAt }
      : null;
    const { blocksBehind, bands } = buildChainEvidence(chain);
    return {
      hostId: row.host_id,
      hostname: hostname ?? null,
      collectedAt,
      stale: deriveStale(collectedAt),
      hasData,
      ibd: chain?.ibd ?? null,
      blocksBehind,
      chain,
      bands,
    };
  });
}
