import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildForwardsDailySql, buildClosesDailySql } from "@/lib/console/trends";

// Trend-series SQL-shape tests (NO DB). These daily-bucket aggregates feed the
// evidence-panel sparklines (sketch 003) — display-only series, no grading.
// They must carry the same Phase-2 landmines as every other warehouse read:
// NANOSECOND windows on lnd_node_forwards (timestamp_ns × 1e9 — Pitfall 6),
// the AFM-002 sanctioned SUM(fee_msat)/1000.0 form (NEVER the raw `fee`
// column), and D-06 bound-integer windows (T-03-22 SQLi / T-03-23 DoS:
// every builder is windowed — no unbounded scan).

const dialect = new PgDialect();
const PUBKEY = "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907";

function render(built: ReturnType<typeof buildForwardsDailySql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildForwardsDailySql shape", () => {
  it("targets lnd_node_forwards with the *1e9 nanosecond window factor (Pitfall 6)", () => {
    const { sql } = render(buildForwardsDailySql(PUBKEY, 7));
    expect(sql).toContain("lnd_node_forwards");
    expect(sql).toContain("1e9");
  });

  it("buckets by day from timestamp_ns and GROUPs BY the day bucket", () => {
    const { sql } = render(buildForwardsDailySql(PUBKEY, 7));
    expect(sql).toContain("to_timestamp(timestamp_ns / 1e9)::date");
    expect(sql).toContain("group by");
  });

  it("computes fees via the AFM-002 sanctioned SUM(fee_msat)/1000.0 — raw `fee` column absent", () => {
    const { sql } = render(buildForwardsDailySql(PUBKEY, 7));
    expect(sql).toContain("sum(fee_msat)");
    expect(sql).toContain("/1000.0");
    // \bfee\b: `fee_msat` and `fees_sat` carry word chars after "fee", so this
    // only matches a bare raw-column reference (the documented 1000x failure).
    expect(sql).not.toMatch(/\bfee\b/);
  });

  it("orders by day ASCENDING — sparklines draw left-to-right oldest-first", () => {
    const { sql } = render(buildForwardsDailySql(PUBKEY, 7));
    expect(sql).toContain("order by 1 asc");
  });

  it("binds pubkey, days, and the seconds-per-day factor as params (D-06, T-03-22)", () => {
    const { sql, params } = render(buildForwardsDailySql(PUBKEY, 30));
    expect(params).toContain(PUBKEY);
    expect(params).toContain(30);
    expect(params).toContain(86400);
    expect(sql).not.toContain(PUBKEY);
  });

  it("parameter-binds the pubkey, never concatenated (SQLi, T-03-22)", () => {
    const evil = "'; DROP TABLE lnd_node_forwards; --";
    const { sql, params } = render(buildForwardsDailySql(evil, 7));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });

  it("is windowed — never an unbounded scan (T-03-23)", () => {
    const { sql } = render(buildForwardsDailySql(PUBKEY, 7));
    expect(sql).toContain("extract(epoch from now())");
    expect(sql).toContain("timestamp_ns >");
  });
});

describe("buildClosesDailySql shape", () => {
  it("targets lnd_node_closed_channels via local_pubkey identity", () => {
    const { sql } = render(buildClosesDailySql(PUBKEY, 30));
    expect(sql).toContain("lnd_node_closed_channels");
    expect(sql).toContain("local_pubkey");
  });

  it("buckets by timestamp::date and GROUPs BY the day bucket", () => {
    const { sql } = render(buildClosesDailySql(PUBKEY, 30));
    expect(sql).toContain("timestamp::date");
    expect(sql).toContain("group by");
  });

  it("windows via make_interval with the bound days integer (D-06, T-03-23)", () => {
    const { sql, params } = render(buildClosesDailySql(PUBKEY, 30));
    expect(sql).toContain("make_interval");
    expect(params).toContain(30);
  });

  it("compares against now() AT TIME ZONE 'UTC' — boundary never depends on session TimeZone (WR-04)", () => {
    const { sql } = render(buildClosesDailySql(PUBKEY, 30));
    expect(sql).toContain("(now() at time zone 'utc') - make_interval");
    expect(sql).not.toContain("> now() -");
  });

  it("orders by day ASCENDING — sparklines draw left-to-right oldest-first", () => {
    const { sql } = render(buildClosesDailySql(PUBKEY, 30));
    expect(sql).toContain("order by 1 asc");
  });

  it("parameter-binds the pubkey, never concatenated (SQLi, T-03-22)", () => {
    const evil = "'; DROP TABLE lnd_node_closed_channels; --";
    const { sql, params } = render(buildClosesDailySql(evil, 30));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).not.toContain(PUBKEY);
  });
});
