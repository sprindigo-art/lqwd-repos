import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildLatestChannelsSql,
  buildLatestChannelSql,
  projectChannelBaseline,
} from "@/lib/read/latest";

// AFM-001 helper-shape test (NO DB). Asserts the ONLY sanctioned latest-channel-state
// query emits DISTINCT ON (chan_id) ... ORDER BY chan_id, timestamp DESC and NEVER
// MAX( — the documented 480-channels-as-1 failure. Also confirms the pubkey is
// parameter-bound ($1), never string-concatenated into the SQL text.

const dialect = new PgDialect();

function renderFor(pubkey: string) {
  const built = dialect.sqlToQuery(buildLatestChannelsSql(pubkey));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("AFM-001 latestChannelsForNode SQL shape", () => {
  it("emits DISTINCT ON (chan_id)", () => {
    const { sql } = renderFor("0364913d18a19c");
    expect(sql).toContain("distinct on (chan_id)");
  });

  it("orders by chan_id, timestamp DESC (latest-per-channel)", () => {
    const { sql } = renderFor("0364913d18a19c");
    expect(sql).toContain("order by chan_id, timestamp desc");
  });

  it("never uses MAX( (the AFM-001 failure mode)", () => {
    const { sql } = renderFor("0364913d18a19c");
    expect(sql).not.toContain("max(");
  });

  it("parameter-binds localPubkey ($1), never concatenated into the SQL text", () => {
    const evil = "'; DROP TABLE lnd_node_channel_info; --";
    const { sql, params } = renderFor(evil);
    // the raw value must NOT appear in the SQL text…
    expect(sql).not.toContain("drop table");
    // …it must be carried as a bound parameter instead.
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });

  // PERF-01 mirror (T-18-15): the multi-channel DISTINCT ON is bounded by a
  // recency window (no unbounded full-partition scan), using the offset-stable
  // UTC idiom — never the AFM-001 MAX(timestamp) form.
  it("bounds the DISTINCT ON with a UTC recency window (make_interval, no unbounded scan)", () => {
    const { sql } = renderFor("0364913d18a19c");
    expect(sql).toContain("make_interval");
    expect(sql).toContain("at time zone 'utc'");
    expect(sql).toContain("timestamp >");
    expect(sql).not.toContain("max(");
  });
});

// Single-channel fallback: the window would drop a >30-day-stale channel, so the
// per-channel detail path must return that channel's latest row EVEN OUTSIDE the
// window (mirrors the single-node latestNodeInfo fallback — no detail regression).
describe("AFM-001 buildLatestChannelSql single-channel fallback", () => {
  function renderOne(pubkey: string, chanId: string) {
    const built = dialect.sqlToQuery(buildLatestChannelSql(pubkey, chanId));
    return { sql: built.sql.toLowerCase(), params: built.params };
  }

  it("returns the latest row for one channel with NO recency window (fallback)", () => {
    const { sql } = renderOne("0364913d18a19c", "780000x0x1");
    expect(sql).not.toContain("make_interval");
    expect(sql).toContain("order by timestamp desc");
    expect(sql).toContain("limit 1");
  });

  it("never uses MAX( and parameter-binds both pubkey and chan_id", () => {
    const { sql, params } = renderOne("0364913d18a19c", "780000x0x1");
    expect(sql).not.toContain("max(");
    expect(params).toContain("0364913d18a19c");
    expect(params).toContain("780000x0x1");
  });
});

// null-is-not-zero (T-18-14): an unknown base fee must NOT be shown as a definite 0.
describe("projectChannelBaseline — null-is-not-zero base fee", () => {
  const NOW = new Date("2026-07-14T00:00:00Z").getTime();

  it("preserves a NULL outgoing_fee_base_msat as null (unknown), never 0", () => {
    const baseline = projectChannelBaseline(
      { chan_id: "1", outgoing_fee_base_msat: null, timestamp: new Date(NOW) },
      NOW,
    );
    expect(baseline.baseFeeMsat).toBeNull();
  });

  it("keeps a present base fee as its numeric value", () => {
    const baseline = projectChannelBaseline(
      { chan_id: "1", outgoing_fee_base_msat: 1000, timestamp: new Date(NOW) },
      NOW,
    );
    expect(baseline.baseFeeMsat).toBe(1000);
  });
});
