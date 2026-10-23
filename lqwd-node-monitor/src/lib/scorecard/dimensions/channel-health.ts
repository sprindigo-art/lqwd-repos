import type { DimensionResult } from "@/lib/scorecard/types";
import type { LatestNodeInfoRow } from "@/lib/read/node-info";

// =====================================================
// Channel-health dimension — inactive-channel ratio (PURE transform, no SQL)
// =====================================================
// Computes from LatestNodeInfoRow[] — callers MUST pass latestNodeInfoAll()
// output (the AFM-001 DISTINCT ON (pubkey) latest-per-node read). NEVER feed
// this rows from a bare `SELECT ... FROM lnd_node_info WHERE pubkey=$x` —
// lnd_node_info is APPEND-ONLY (RESEARCH Pitfall 1: a direct select returns
// hundreds of thousands of historical rows, not one current row per node).
//
// Pure module: type-only imports, zero database access — test it with plain
// row literals. Returns { raw, asOf, extras } only — no grades, no thresholds
// (D-02 separation).

/**
 * Inactive-channel ratio per node: raw = inactive / (active + inactive),
 * null when the node reports zero channels (no denominator ≠ "0% inactive").
 * extras carry the raw counts for the scorecard detail row.
 */
export function channelHealthFromNodeInfo(
  rows: LatestNodeInfoRow[],
): Map<string, DimensionResult> {
  const map = new Map<string, DimensionResult>();
  for (const row of rows) {
    const active = row.active_channels ?? 0;
    const inactive = row.inactive_channels ?? 0;
    const total = active + inactive;
    map.set(row.pubkey, {
      raw: total === 0 ? null : inactive / total,
      asOf: row.timestamp,
      extras: { activeChannels: active, inactiveChannels: inactive },
    });
  }
  return map;
}
