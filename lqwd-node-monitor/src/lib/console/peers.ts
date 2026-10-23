import { sql, type SQL } from "drizzle-orm";
import { latestChannelsForNode } from "@/lib/read/latest";
import { latestNodeInfo } from "@/lib/read/node-info";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";
import { formatSats } from "@/lib/format/units";

// =====================================================
// Peers console tab — channel counterparties, NEVER the lifetime log
// =====================================================
// Pitfall 5: `lnd_node_peer_info` is a CUMULATIVE LIFETIME log — one row per
// peer EVER connected (Canada: 22,872 rows vs num_peers 1,290; only 1 row
// within 6h — timestamps are insert-time, not refreshed). Neither COUNT(*)
// nor recency yields current peers (T-03-09).
//
// The Peers tab is therefore defined as CHANNEL COUNTERPARTIES: distinct
// remote_pubkey over latestChannelsForNode active channels, enriched with the
// latest peer_info metadata row per remote pubkey (alias, flapcount).
// The honest headline pairs latestNodeInfo's num_peers with the shown partner
// count: "{num_peers} connected peers · showing {n} channel partners".
//
// flapcount is LIFETIME-CUMULATIVE — surfaced as `flapCountLifetime` with
// FLAP_COUNT_LIFETIME_NOTE for the UI tooltip; never present it as recent flaps.

/** Column-metadata note for the flap-count UI tooltip — lifetime, not recent. */
export const FLAP_COUNT_LIFETIME_NOTE =
  "lifetime cumulative flap count (since first seen) — not recent activity";

/** Raw enrichment row surfaced by buildPeerInfoLatestSql via raw .execute. */
interface PeerInfoLatestRow {
  peer_pubkey: string;
  alias: string | null;
  flapcount: string | number | null;
  total_capacity: string | null;
  num_channels: string | null;
  address: string | null;
}

/** One channel-partner row with peer_info enrichment when available. */
export interface PeerRowView {
  remotePubkey: string;
  alias: string | null;
  /** LIFETIME cumulative (FLAP_COUNT_LIFETIME_NOTE) — null when no peer_info row exists. */
  flapCountLifetime: number | null;
  /** This node's active channels to the partner (from the latest-channel rows). */
  channelCount: number;
  /** Sum of this node's active-channel capacity to the partner, raw sats. */
  totalCapacitySat: number;
  totalCapacityDisplay: string;
}

/** Honest-labeling headline: "{numPeers} connected peers · showing {shownPartners} channel partners". */
export interface PeersHeadline {
  numPeers: number | null;
  shownPartners: number;
}

/** The Peers tab view consumed by PeersPanel (03-06). */
export interface PeersTabView {
  headline: PeersHeadline;
  rows: PeerRowView[];
  /** Max latest-channel row timestamp — scopes the panel's FreshnessStamp. */
  asOf: Date | null;
}

/**
 * Latest peer_info metadata row per remote pubkey for one node — enrichment
 * ONLY, never a peer count (Pitfall 5: no COUNT(*) over the lifetime log).
 * DISTINCT ON (peer_pubkey) with the NULL-key guard (WR-01: DISTINCT ON
 * collapses NULL keys into one row). `localPubkey` is bound, not interpolated.
 */
export function buildPeerInfoLatestSql(localPubkey: string): SQL {
  return sql`
    SELECT DISTINCT ON (peer_pubkey)
      peer_pubkey, alias, flapcount, total_capacity, num_channels, address
    FROM lnd_node_peer_info
    WHERE local_pubkey = ${localPubkey}
      AND peer_pubkey IS NOT NULL
    ORDER BY peer_pubkey, timestamp DESC
  `;
}

/**
 * Pure shaper: distinct remote_pubkey of ACTIVE channels (the counterparty
 * set), enriched by peer_info metadata when available; asOf = max channel-row
 * timestamp via parseDbTimestampUtc (same convention as the static-tab
 * shapers). Exported separately for the no-DB fixture test.
 */
export function shapePeersTab(
  channelRows: Record<string, unknown>[],
  peerInfoRows: Record<string, unknown>[],
  nodeInfo: { num_peers: number | null } | null,
): PeersTabView {
  const infoByPubkey = new Map<string, PeerInfoLatestRow>();
  for (const r of peerInfoRows) {
    if (r.peer_pubkey != null) {
      infoByPubkey.set(String(r.peer_pubkey), r as unknown as PeerInfoLatestRow);
    }
  }

  // Aggregate active channels per counterparty; track per-view asOf.
  //
  // G7 root-cause: derive the counterparty set from `active === true` ONLY —
  // matching projectChannelBaseline (src/lib/read/latest.ts) / NodeChannelsTable,
  // the sanctioned reader the operator confirmed renders channels correctly. In
  // routing_vm the `closed` column is UNRELIABLE: it coexists with `active=true`
  // on the latest row (fleet-wide 4463 active+closed rows vs 231 active+open; the
  // top node had 1002 active counterparties but 0 survived a `closed` filter).
  // Excluding on `closed` discarded the vast majority of live channels and emptied
  // the peers table. `active` is the honest current-channel signal here.
  const partners = new Map<string, { channelCount: number; capacitySat: number }>();
  let asOf: Date | null = null;
  for (const r of channelRows) {
    if (r.active !== true || r.remote_pubkey == null) continue;
    const key = String(r.remote_pubkey);
    const agg = partners.get(key) ?? { channelCount: 0, capacitySat: 0 };
    agg.channelCount += 1;
    agg.capacitySat += Number(r.capacity ?? 0);
    partners.set(key, agg);

    const ts = parseDbTimestampUtc((r.timestamp ?? null) as Date | string | null);
    if (ts && (asOf === null || ts > asOf)) asOf = ts;
  }

  const rows: PeerRowView[] = [...partners.entries()].map(([remotePubkey, agg]) => {
    const info = infoByPubkey.get(remotePubkey);
    return {
      remotePubkey,
      alias: info?.alias ?? null,
      flapCountLifetime: info?.flapcount == null ? null : Number(info.flapcount),
      channelCount: agg.channelCount,
      totalCapacitySat: agg.capacitySat,
      totalCapacityDisplay: formatSats(agg.capacitySat),
    };
  });

  return {
    headline: {
      numPeers: nodeInfo?.num_peers ?? null,
      shownPartners: rows.length,
    },
    rows,
    asOf,
  };
}

/**
 * Peers tab data for one node: counterparties from the sanctioned latest
 * reader, honest num_peers headline from latestNodeInfo, peer_info enrichment
 * via the builder above — all in one Promise.all pass.
 *
 * WR-05: callers that already hold the latest-channel rows pass them as
 * `preReadChannelRows` so the DISTINCT-ON query runs ONCE per request and the
 * partner rows + per-peer gauges derive from the SAME snapshot of the
 * event-driven table (never two snapshots that can disagree).
 */
export async function peersTabData(
  pubkey: string,
  preReadChannelRows?: Record<string, unknown>[],
): Promise<PeersTabView> {
  // Lazy import keeps the server-only `dbRouting` client (postgres() pool +
  // env at module load) out of the no-DB shape test's import graph.
  const { dbRouting } = await import("@/lib/db/warehouse-routing");

  const [channelRows, nodeInfo, enrichmentResult] = await Promise.all([
    preReadChannelRows !== undefined
      ? Promise.resolve(preReadChannelRows)
      : latestChannelsForNode(pubkey),
    latestNodeInfo(pubkey),
    dbRouting.execute(buildPeerInfoLatestSql(pubkey)),
  ]);

  return shapePeersTab(
    channelRows,
    enrichmentResult as unknown as Record<string, unknown>[],
    nodeInfo,
  );
}
