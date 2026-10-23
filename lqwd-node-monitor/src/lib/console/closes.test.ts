import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildClosesSummarySql,
  buildClosesRowsSql,
  buildClosesFullSql,
} from "@/lib/console/closes";
import { ROW_CAP } from "@/lib/console/config";

// Closes console-tab SQL-shape tests (NO DB). lnd_node_closed_channels is ONE
// ROW PER CLOSE (no DISTINCT ON needed — force-close.ts precedent). D-06: the
// window is make_interval(days => $bound_integer) — never a user string in an
// interval. D-07: rendered rows are LIMIT-capped; the full-window export
// builder carries NO limit token. Identity column: local_pubkey.

const dialect = new PgDialect();
const PUBKEY = "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907";

function render(built: ReturnType<typeof buildClosesSummarySql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildClosesSummarySql shape", () => {
  it("windows via make_interval(days => $bound) on the timestamp column (D-06)", () => {
    const { sql, params } = render(buildClosesSummarySql(PUBKEY, 30));
    expect(sql).toContain("make_interval(days =>");
    expect(params).toContain(30);
  });

  it("compares against now() AT TIME ZONE 'UTC' — boundary never depends on session TimeZone (WR-04)", () => {
    for (const built of [
      buildClosesSummarySql(PUBKEY, 30),
      buildClosesRowsSql(PUBKEY, 30, ROW_CAP),
      buildClosesFullSql(PUBKEY, 90),
    ]) {
      const { sql } = render(built);
      expect(sql).toContain("(now() at time zone 'utc') - make_interval");
      // the bare timestamptz form (implicit session-tz cast) must be gone
      expect(sql).not.toContain("> now() -");
    }
  });

  it("binds the identity on local_pubkey", () => {
    const { sql, params } = render(buildClosesSummarySql(PUBKEY, 30));
    expect(sql).toContain("local_pubkey");
    expect(params).toContain(PUBKEY);
  });

  it("aggregates capacity + settled_balance and per-close_type FILTER counts", () => {
    const { sql } = render(buildClosesSummarySql(PUBKEY, 30));
    expect(sql).toContain("sum(capacity)");
    expect(sql).toContain("sum(settled_balance)");
    expect(sql).toContain("filter");
    // verified enum literals (schema doc) — fixed SQL text, never user input
    expect(sql).toContain("cooperative_close");
    expect(sql).toContain("local_force_close");
    expect(sql).toContain("remote_force_close");
  });

  it("parameter-binds the pubkey — the SQLi payload lands in params (T-03-07)", () => {
    const evil = "'; DROP TABLE lnd_node_closed_channels; --";
    const { sql, params } = render(buildClosesSummarySql(evil, 30));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });
});

describe("buildClosesRowsSql shape (capped, D-07)", () => {
  it("orders newest-first and caps with LIMIT, binding ROW_CAP", () => {
    const { sql, params } = render(buildClosesRowsSql(PUBKEY, 30, ROW_CAP));
    expect(sql).toContain("order by timestamp desc");
    expect(sql).toContain("limit");
    expect(params).toContain(ROW_CAP);
  });

  it("re-states the make_interval window predicate", () => {
    const { sql } = render(buildClosesRowsSql(PUBKEY, 30, ROW_CAP));
    expect(sql).toContain("make_interval(days =>");
  });

  it("parameter-binds the pubkey (SQLi)", () => {
    const evil = "'; DROP TABLE lnd_node_closed_channels; --";
    const { sql, params } = render(buildClosesRowsSql(evil, 30, ROW_CAP));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});

describe("buildClosesFullSql shape (export, D-09)", () => {
  it("carries the same window predicate", () => {
    const { sql } = render(buildClosesFullSql(PUBKEY, 90));
    expect(sql).toContain("make_interval(days =>");
  });

  it("has NO limit token — full window for CSV export", () => {
    const { sql } = render(buildClosesFullSql(PUBKEY, 90));
    expect(sql).not.toContain("limit");
  });

  it("binds the days integer and pubkey", () => {
    const { params } = render(buildClosesFullSql(PUBKEY, 90));
    expect(params).toContain(PUBKEY);
    expect(params).toContain(90);
  });

  it("parameter-binds the pubkey (SQLi)", () => {
    const evil = "'; DROP TABLE lnd_node_closed_channels; --";
    const { sql, params } = render(buildClosesFullSql(evil, 90));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});
