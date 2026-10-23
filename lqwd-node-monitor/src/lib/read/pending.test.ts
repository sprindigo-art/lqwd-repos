import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildCurrentPendingChannelsSql,
  buildCurrentPendingSweepsSql,
  buildPendingView,
} from "@/lib/read/pending";

// PENDING-01 shape tests (NO DB). The pending tables retain months of resolved
// residue — these tests pin the ONLY sanctioned read shape: recency-filtered,
// DISTINCT ON (channel_point) with the NULL-key guard, identity-correct per
// table (channels: local_pubkey, sweeps: lnd_pubkey), parameter-bound, never
// MAX( — plus the pure buildPendingView shaper contract (grouping, oldest-first
// sort, sweep nesting, orphan retention, asOf).

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildCurrentPendingChannelsSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildCurrentPendingChannelsSql shape", () => {
  it("emits DISTINCT ON (channel_point) with the NULL-key guard and recency predicate", () => {
    const { sql } = render(buildCurrentPendingChannelsSql(6));
    expect(sql).toContain("distinct on (channel_point)");
    expect(sql).toContain("channel_point is not null");
    expect(sql).toContain("make_interval(hours =>");
    expect(sql).toContain("order by channel_point, updated_at desc");
  });

  it("parameter-binds localPubkey when scoped — SQLi payload lands in params, never SQL text", () => {
    const evil = "'; DROP TABLE lnd_node_pending_channels; --";
    const { sql, params } = render(buildCurrentPendingChannelsSql(6, evil));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
    expect(sql).toContain("local_pubkey =");
  });

  it("omits the local_pubkey predicate when unscoped (fleet-wide)", () => {
    const { sql } = render(buildCurrentPendingChannelsSql(6));
    expect(sql).not.toContain("local_pubkey");
  });
});

describe("buildCurrentPendingSweepsSql shape", () => {
  it("filters on updated_at recency and contains no DISTINCT ON (one row per outpoint)", () => {
    const { sql } = render(buildCurrentPendingSweepsSql(6));
    expect(sql).toContain("updated_at >");
    expect(sql).toContain("make_interval(hours =>");
    expect(sql).not.toContain("distinct on");
  });

  it("binds lnd_pubkey (NOT local_pubkey) when scoped — the sweeps identity column", () => {
    const evil = "'; DROP TABLE lnd_node_pending_sweeps; --";
    const { sql, params } = render(buildCurrentPendingSweepsSql(6, evil));
    expect(sql).toContain("lnd_pubkey =");
    expect(sql).not.toContain("local_pubkey");
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });

  it("omits the lnd_pubkey predicate when unscoped", () => {
    const { sql } = render(buildCurrentPendingSweepsSql(6));
    expect(sql).not.toContain("lnd_pubkey");
  });
});

describe("neither builder uses MAX( (the AFM-001 failure mode)", () => {
  it("channels builder", () => {
    expect(render(buildCurrentPendingChannelsSql(6, "abc")).sql).not.toContain("max(");
  });
  it("sweeps builder", () => {
    expect(render(buildCurrentPendingSweepsSql(6, "abc")).sql).not.toContain("max(");
  });
});

// ---------------------------------------------------------------------------
// buildPendingView — pure shaper (T-02-07: views render this shape verbatim)
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-10T12:00:00Z");

function chan(over: Record<string, unknown>): Record<string, unknown> {
  return {
    local_pubkey: "node-a",
    lnd_alias: "Alpha",
    channel_point: "cp-1:0",
    remote_node_pub: "remote-1",
    channel_state: "PENDING_OPEN",
    limbo_balance: "0",
    blocks_til_maturity: null,
    closing_txid: null,
    created_at: "2026-06-10 10:00:00+00",
    updated_at: "2026-06-10 11:00:00+00",
    ...over,
  };
}

function sweep(over: Record<string, unknown>): Record<string, unknown> {
  return {
    lnd_pubkey: "node-a",
    lnd_alias: "Alpha",
    outpoint_txid: "txid-fc-1",
    outpoint_output_index: 0,
    amount_sat: 1000,
    broadcast_attempts: 2,
    next_broadcast_height: 900000,
    sat_per_vbyte: "5",
    requested_sat_per_vbyte: "10",
    created_at: "2026-06-10 10:30:00+00",
    updated_at: "2026-06-10 11:30:00+00",
    ...over,
  };
}

describe("buildPendingView shaper", () => {
  it("groups rows per node into sections keyed by verbatim channel_state", () => {
    const view = buildPendingView(
      [
        chan({ channel_point: "cp-1:0", channel_state: "PENDING_OPEN" }),
        chan({ channel_point: "cp-2:0", channel_state: "WAITING_CLOSE" }),
        chan({ channel_point: "cp-3:0", channel_state: "FORCE_CLOSE", closing_txid: "txid-fc-1" }),
      ],
      [],
      NOW,
    );
    expect(view.nodes).toHaveLength(1);
    const node = view.nodes[0];
    expect(node.localPubkey).toBe("node-a");
    expect(node.sections["PENDING_OPEN"]).toHaveLength(1);
    expect(node.sections["WAITING_CLOSE"]).toHaveLength(1);
    expect(node.sections["FORCE_CLOSE"]).toHaveLength(1);
    // state is carried verbatim on each row (Pitfall 10)
    expect(node.sections["WAITING_CLOSE"][0].state).toBe("WAITING_CLOSE");
  });

  it("sorts rows oldest-first (created_at ASC) within each section (D-13)", () => {
    const view = buildPendingView(
      [
        chan({ channel_point: "cp-new:0", created_at: "2026-06-10 11:00:00+00" }),
        chan({ channel_point: "cp-old:0", created_at: "2026-06-09 08:00:00+00" }),
        chan({ channel_point: "cp-mid:0", created_at: "2026-06-10 01:00:00+00" }),
      ],
      [],
      NOW,
    );
    const opens = view.nodes[0].sections["PENDING_OPEN"];
    expect(opens.map((r) => r.channelPoint)).toEqual(["cp-old:0", "cp-mid:0", "cp-new:0"]);
    // age computed from created_at via parseDbTimestampUtc (UTC-pinned)
    expect(opens[0].ageMs).toBe(NOW.getTime() - new Date("2026-06-09T08:00:00Z").getTime());
  });

  it("nests sweeps under their force-close via closing_txid === outpoint_txid", () => {
    const view = buildPendingView(
      [chan({ channel_point: "cp-fc:0", channel_state: "FORCE_CLOSE", closing_txid: "txid-fc-1" })],
      [sweep({ outpoint_txid: "txid-fc-1", broadcast_attempts: 7 })],
      NOW,
    );
    const fc = view.nodes[0].sections["FORCE_CLOSE"][0];
    expect(fc.sweeps).toHaveLength(1);
    expect(fc.sweeps[0].broadcastAttempts).toBe(7);
    expect(view.nodes[0].unattachedSweeps).toHaveLength(0);
  });

  it("keeps orphan sweeps visible in unattachedSweeps — never dropped (every sat accounted for)", () => {
    const view = buildPendingView(
      [chan({ channel_point: "cp-fc:0", channel_state: "FORCE_CLOSE", closing_txid: "txid-fc-1" })],
      [
        sweep({ outpoint_txid: "txid-fc-1" }),
        sweep({ outpoint_txid: "txid-orphan", amount_sat: 333 }),
        // orphan sweep on a node with NO pending channels still gets a group
        sweep({ lnd_pubkey: "node-b", lnd_alias: "Bravo", outpoint_txid: "txid-other" }),
      ],
      NOW,
    );
    const nodeA = view.nodes.find((n) => n.localPubkey === "node-a")!;
    expect(nodeA.unattachedSweeps).toHaveLength(1);
    expect(nodeA.unattachedSweeps[0].amountSat).toBe(333);
    const nodeB = view.nodes.find((n) => n.localPubkey === "node-b")!;
    expect(nodeB.unattachedSweeps).toHaveLength(1);
    expect(nodeB.sections["FORCE_CLOSE"]).toHaveLength(0);
  });

  it("computes asOf as the max updated_at across the scoped rows and sweeps", () => {
    const view = buildPendingView(
      [
        chan({ channel_point: "cp-1:0", updated_at: "2026-06-10 09:00:00+00" }),
        chan({ channel_point: "cp-2:0", updated_at: "2026-06-10 11:00:00+00" }),
      ],
      [sweep({ outpoint_txid: "txid-x", updated_at: "2026-06-10 11:45:00+00" })],
      NOW,
    );
    const node = view.nodes[0];
    expect(node.asOf?.toISOString()).toBe("2026-06-10T11:45:00.000Z");
    expect(view.asOf?.toISOString()).toBe("2026-06-10T11:45:00.000Z");
  });

  it("carries raw limbo_balance untouched (string — formatting happens at render)", () => {
    const view = buildPendingView(
      [chan({ channel_state: "FORCE_CLOSE", limbo_balance: "70621359" })],
      [],
      NOW,
    );
    expect(view.nodes[0].sections["FORCE_CLOSE"][0].limboBalance).toBe("70621359");
  });
});
