import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildPeerInfoLatestSql, shapePeersTab } from "@/lib/console/peers";

// Peers console-tab tests (NO DB). Pitfall 5: lnd_node_peer_info is a CUMULATIVE
// LIFETIME log (Canada: 22,872 rows, num_peers 1,290, only 1 row within 6h) —
// COUNT(*) and recency are both wrong. The Peers tab is therefore CHANNEL
// COUNTERPARTIES (distinct remote_pubkey of active channels) enriched with the
// latest peer_info metadata row per remote pubkey; the honest headline is
// num_peers from latestNodeInfo ("{num_peers} connected peers · showing {n}
// channel partners").

const dialect = new PgDialect();
const PUBKEY = "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907";

function render(pubkey: string) {
  const q = dialect.sqlToQuery(buildPeerInfoLatestSql(pubkey));
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildPeerInfoLatestSql shape", () => {
  it("selects the latest peer_info row per remote pubkey (DISTINCT ON form)", () => {
    const { sql } = render(PUBKEY);
    expect(sql).toContain("distinct on (peer_pubkey)");
    expect(sql).toContain("order by peer_pubkey, timestamp desc");
  });

  it("guards the DISTINCT ON key against NULL collapse (WR-01)", () => {
    const { sql } = render(PUBKEY);
    expect(sql).toContain("peer_pubkey is not null");
  });

  it("contains no bare count(*) over the lifetime log as a peers count (Pitfall 5)", () => {
    const { sql } = render(PUBKEY);
    expect(sql).not.toContain("count(*)");
  });

  it("parameter-binds the node identity — the SQLi payload lands in params", () => {
    const evil = "'; DROP TABLE lnd_node_peer_info; --";
    const { sql, params } = render(evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });
});

describe("shapePeersTab (counterparty derivation, no DB)", () => {
  const channelRows: Record<string, unknown>[] = [
    {
      chan_id: "1",
      remote_pubkey: "02aaaa",
      active: true,
      closed: false,
      capacity: "1000000",
      timestamp: "2026-06-10 04:10:26",
    },
    {
      chan_id: "2",
      remote_pubkey: "02aaaa", // second channel to the same partner — ONE row out
      active: true,
      closed: false,
      capacity: "500000",
      timestamp: "2026-06-10 03:00:00",
    },
    {
      chan_id: "3",
      remote_pubkey: "02bbbb",
      active: true,
      closed: false,
      capacity: "2000000",
      timestamp: "2026-06-10 02:00:00",
    },
    {
      chan_id: "4",
      remote_pubkey: "02dddd", // inactive — NOT a current partner
      active: false,
      closed: false,
      capacity: "700000",
      timestamp: "2026-06-10 01:00:00",
    },
    {
      chan_id: "5",
      remote_pubkey: null, // no counterparty — excluded
      active: true,
      closed: false,
      capacity: "300000",
      timestamp: "2026-06-10 00:30:00",
    },
  ];

  // G7 regression fixture: the live-warehouse case — a genuinely active channel
  // whose latest row also carries closed=true (routing_vm: 4463 such rows fleet-
  // wide). It MUST contribute its counterparty now (previously wrongly excluded).
  const closedFlagChannelRows: Record<string, unknown>[] = [
    {
      chan_id: "9",
      remote_pubkey: "02cccc",
      active: true,
      closed: true, // unreliable `closed` flag coexisting with active=true
      capacity: "1200000",
      timestamp: "2026-06-10 05:00:00",
    },
  ];

  const peerInfoRows: Record<string, unknown>[] = [
    { peer_pubkey: "02aaaa", alias: "AliceNode", flapcount: "42", total_capacity: "1500000" },
    // 02bbbb has no peer_info row — metadata stays null, the row still renders
  ];

  const nodeInfo = { num_peers: 1290 };

  it("returns distinct active-channel counterparties with enrichment when available", () => {
    const view = shapePeersTab(channelRows, peerInfoRows, nodeInfo);
    expect(view.rows).toHaveLength(2); // 02aaaa deduped, 02dddd inactive excluded
    const alice = view.rows.find((r) => r.remotePubkey === "02aaaa");
    expect(alice?.alias).toBe("AliceNode");
    expect(alice?.flapCountLifetime).toBe(42);
    expect(alice?.channelCount).toBe(2);
    const bob = view.rows.find((r) => r.remotePubkey === "02bbbb");
    expect(bob?.alias).toBeNull();
    expect(bob?.flapCountLifetime).toBeNull();
  });

  it("includes an active counterparty whose latest row also has closed=true (G7 regression)", () => {
    const view = shapePeersTab(closedFlagChannelRows, [], nodeInfo);
    expect(view.rows).toHaveLength(1);
    const partner = view.rows.find((r) => r.remotePubkey === "02cccc");
    expect(partner).toBeDefined();
    expect(partner?.channelCount).toBe(1);
    expect(partner?.totalCapacitySat).toBe(1200000);
  });

  it("headline carries the honest num_peers + shownPartners pair", () => {
    const view = shapePeersTab(channelRows, peerInfoRows, nodeInfo);
    expect(view.headline.numPeers).toBe(1290);
    expect(view.headline.shownPartners).toBe(2);
  });

  it("derives asOf from the latest-channel rows as a UTC Date (WR-01)", () => {
    const view = shapePeersTab(channelRows, peerInfoRows, nodeInfo);
    expect(view.asOf).toEqual(new Date("2026-06-10T04:10:26Z"));
  });

  it("handles missing node info: null numPeers, partners still shown", () => {
    const view = shapePeersTab(channelRows, peerInfoRows, null);
    expect(view.headline.numPeers).toBeNull();
    expect(view.headline.shownPartners).toBe(2);
  });
});
