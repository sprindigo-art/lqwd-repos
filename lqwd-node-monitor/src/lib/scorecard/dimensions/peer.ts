import type { LatestNodeInfoRow } from "@/lib/read/node-info";
import type { DimensionResult } from "@/lib/scorecard/types";

// =====================================================
// Peer dimension (D-01 #7) — PARTIAL, pure transform
// =====================================================
// NEVER COUNT(*) lnd_node_peer_info — it is a CUMULATIVE LIFETIME log (one row
// per peer EVER connected; 22,868 rows for Canada = 22,868 peers ever seen,
// not current peers). Current peers = lnd_node_info.num_peers via the
// sanctioned latestNodeInfoAll() read (RESEARCH Pitfall 2).
//
// PURE module: zero DB imports (LatestNodeInfoRow is a type-only import).
// fleet.ts already holds the latest node-info rows for other dimensions —
// this transform reuses them instead of issuing a second warehouse read.
//
// PARTIAL dimension: num_peers is available, but flap-rate needs peer event
// history the warehouse doesn't have — every result carries the exact
// UI-SPEC partial-dimension note so the cell renders the partial state.

/** Exact UI-SPEC §Copywriting partial-dimension string — do not reword. */
export const PEER_PARTIAL_NOTE = "partial — flap-rate needs event history";

/**
 * Peer dimension from already-fetched latest node-info rows.
 * raw = num_peers: 0 stays 0 (0 is the unreachable Tier-1 signal, NOT missing
 * data — config peer.tier1 is raw < 1); null only when the column is null.
 */
export function peerFromNodeInfo(rows: LatestNodeInfoRow[]): Map<string, DimensionResult> {
  const out = new Map<string, DimensionResult>();
  for (const row of rows) {
    out.set(row.pubkey, {
      raw: row.num_peers ?? null,
      asOf: row.timestamp ?? null,
      note: PEER_PARTIAL_NOTE,
    });
  }
  return out;
}
