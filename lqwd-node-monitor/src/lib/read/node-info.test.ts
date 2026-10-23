import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildLatestNodeInfoSql, buildLatestNodeInfoAllSql } from "@/lib/read/node-info";

// AFM-001 helper-shape tests (NO DB) for the ONLY sanctioned lnd_node_info
// latest-per-node reads. lnd_node_info is APPEND-ONLY (RESEARCH Pitfall 1) —
// the fleet builder must emit DISTINCT ON (pubkey) ... ORDER BY pubkey,
// timestamp DESC with a NULL-key guard (WR-01), the single-node builder must
// emit ORDER BY timestamp DESC LIMIT 1, neither may use MAX(, and the pubkey
// must be parameter-bound ($1), never string-concatenated into the SQL text.

const dialect = new PgDialect();

function renderAll() {
  const built = dialect.sqlToQuery(buildLatestNodeInfoAllSql());
  return { sql: built.sql.toLowerCase(), params: built.params };
}

function renderSingle(pubkey: string) {
  const built = dialect.sqlToQuery(buildLatestNodeInfoSql(pubkey));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("AFM-001 latestNodeInfoAll SQL shape (fleet-wide)", () => {
  it("emits DISTINCT ON (pubkey)", () => {
    const { sql } = renderAll();
    expect(sql).toContain("distinct on (pubkey)");
  });

  it("orders by pubkey, timestamp DESC (latest-per-node)", () => {
    const { sql } = renderAll();
    expect(sql).toContain("order by pubkey, timestamp desc");
  });

  it("guards pubkey IS NOT NULL (WR-01 NULL-key collapse)", () => {
    const { sql } = renderAll();
    expect(sql).toContain("pubkey is not null");
  });

  it("bounds to the last 30 days (PERF-01 recency window)", () => {
    const { sql, params } = renderAll();
    // The added recency predicate — the DISTINCT ON shape is unchanged, this
    // only bounds the scan (never the MAX-timestamp form).
    expect(sql).toContain("timestamp >");
    expect(sql).toContain("make_interval(days =>");
    expect(sql).toContain("now() at time zone 'utc'");
    // 30 is carried as a bound parameter, not concatenated.
    expect(params).toContain(30);
  });
});

describe("AFM-001 latestNodeInfo SQL shape (single node)", () => {
  it("orders by timestamp DESC with LIMIT 1", () => {
    const { sql } = renderSingle("0364913d18a19c");
    expect(sql).toContain("order by timestamp desc");
    expect(sql).toContain("limit 1");
  });
});

describe("AFM-001 failure modes", () => {
  it("neither builder uses MAX( (the AFM-001 failure mode)", () => {
    expect(renderAll().sql).not.toContain("max(");
    expect(renderSingle("0364913d18a19c").sql).not.toContain("max(");
  });

  it("parameter-binds pubkey ($1), never concatenated into the SQL text", () => {
    const evil = "'; DROP TABLE lnd_node_info; --";
    const { sql, params } = renderSingle(evil);
    // the raw value must NOT appear in the SQL text…
    expect(sql).not.toContain("drop table");
    // …it must be carried as a bound parameter instead.
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });
});
