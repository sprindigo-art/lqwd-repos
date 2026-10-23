import { beforeEach, describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildForwardsSummarySql,
  buildForwardsRowsSql,
  buildForwardsFullSql,
  buildForwardsPageSql,
  buildBusiestChannelSql,
  forwardsPageData,
} from "@/lib/console/forwards";
import { ROW_CAP } from "@/lib/console/config";

// forwardsPageData is exercised with the lazily-imported dbRouting client
// mocked (NO DB) so the CR-01 regression can pin the exact OFFSET the page
// query receives for a given raw ?page.
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock("@/lib/db/warehouse-routing", () => ({ dbRouting: { execute: executeMock } }));

// Forwards console-tab SQL-shape tests (NO DB). Every windowed builder must
// re-state the two Phase-2 landmines: NANOSECOND windows (timestamp_ns × 1e9 —
// RESEARCH Pitfall 6) and the AFM-002 sanctioned SUM(fee_msat)/1000.0 form.
// D-06: days arrives as a BOUND INTEGER from WINDOW_PRESETS — never a user
// string inside an interval. D-07: rendered rows are LIMIT-capped; the
// full-window export builder carries NO limit token.

const dialect = new PgDialect();
const PUBKEY = "0364913d18a19c671bb36dd04d6ad5be0fe8f2894314c36a9db3f03c2d414907";

function render(built: ReturnType<typeof buildForwardsSummarySql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildForwardsSummarySql shape", () => {
  it("windows on timestamp_ns with the *1e9 nanosecond factor (Pitfall 6)", () => {
    const { sql } = render(buildForwardsSummarySql(PUBKEY, 7));
    expect(sql).toContain("timestamp_ns");
    expect(sql).toContain("1e9");
  });

  it("uses the AFM-002 sanctioned SUM(fee_msat)/1000.0 sats form", () => {
    const { sql } = render(buildForwardsSummarySql(PUBKEY, 7));
    expect(sql).toContain("sum(fee_msat)");
    expect(sql).toContain("/1000.0");
  });

  it("binds the days integer and lnd_pubkey as params (D-06)", () => {
    const { params } = render(buildForwardsSummarySql(PUBKEY, 30));
    expect(params).toContain(PUBKEY);
    expect(params).toContain(30);
  });

  it("never uses bare max(timestamp) on the event table (MAX(timestamp_ns) for asOf is fine)", () => {
    const { sql } = render(buildForwardsSummarySql(PUBKEY, 7));
    expect(sql).not.toMatch(/max\(timestamp\)/);
    expect(sql).toContain("max(timestamp_ns)");
  });

  it("parameter-binds the pubkey, never concatenated (SQLi, T-03-07)", () => {
    const evil = "'; DROP TABLE lnd_node_forwards; --";
    const { sql, params } = render(buildForwardsSummarySql(evil, 7));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });
});

describe("buildForwardsRowsSql shape (capped, D-07)", () => {
  it("orders newest-first and caps with LIMIT", () => {
    const { sql } = render(buildForwardsRowsSql(PUBKEY, 7, ROW_CAP));
    expect(sql).toContain("order by timestamp_ns desc");
    expect(sql).toContain("limit");
  });

  it("binds ROW_CAP as a param", () => {
    const { params } = render(buildForwardsRowsSql(PUBKEY, 7, ROW_CAP));
    expect(params).toContain(ROW_CAP);
  });

  it("re-states the nanosecond window predicate", () => {
    const { sql } = render(buildForwardsRowsSql(PUBKEY, 7, ROW_CAP));
    expect(sql).toContain("timestamp_ns");
    expect(sql).toContain("1e9");
  });

  it("parameter-binds the pubkey (SQLi)", () => {
    const evil = "'; DROP TABLE lnd_node_forwards; --";
    const { sql, params } = render(buildForwardsRowsSql(evil, 7, ROW_CAP));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});

describe("buildForwardsFullSql shape (export, D-09)", () => {
  it("carries the same nanosecond window predicate", () => {
    const { sql } = render(buildForwardsFullSql(PUBKEY, 90));
    expect(sql).toContain("timestamp_ns");
    expect(sql).toContain("1e9");
  });

  it("has NO limit token — full window for CSV export", () => {
    const { sql } = render(buildForwardsFullSql(PUBKEY, 90));
    expect(sql).not.toContain("limit");
  });

  it("binds the days integer and pubkey", () => {
    const { params } = render(buildForwardsFullSql(PUBKEY, 90));
    expect(params).toContain(PUBKEY);
    expect(params).toContain(90);
  });

  it("parameter-binds the pubkey (SQLi)", () => {
    const evil = "'; DROP TABLE lnd_node_forwards; --";
    const { sql, params } = render(buildForwardsFullSql(evil, 90));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});

describe("buildForwardsPageSql shape (OFFSET pagination, G1)", () => {
  it("emits a bound LIMIT and a bound OFFSET, both ::int cast", () => {
    const { sql } = render(buildForwardsPageSql(PUBKEY, 7, 50, 100));
    expect(sql).toContain("limit");
    expect(sql).toContain("offset");
    // OFFSET follows LIMIT.
    expect(sql.indexOf("offset")).toBeGreaterThan(sql.indexOf("limit"));
    // Both bound params carry the ::int cast (guards 42725 unknown-param error).
    expect(sql).toMatch(/limit\s+\$\d+::int/);
    expect(sql).toMatch(/offset\s+\$\d+::int/);
  });

  it("binds limit and offset as params (never interpolated)", () => {
    const { params } = render(buildForwardsPageSql(PUBKEY, 7, 50, 100));
    expect(params).toContain(50);
    expect(params).toContain(100);
  });

  it("keeps the *1e9 nanosecond window factor and newest-first order", () => {
    const { sql } = render(buildForwardsPageSql(PUBKEY, 7, 50, 0));
    expect(sql).toContain("timestamp_ns");
    expect(sql).toContain("1e9");
    expect(sql).toContain("order by timestamp_ns desc");
  });

  it("parameter-binds the pubkey (SQLi)", () => {
    const evil = "'; DROP TABLE lnd_node_forwards; --";
    const { sql, params } = render(buildForwardsPageSql(evil, 7, 50, 0));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});

describe("forwardsPageData OFFSET honesty (CR-01 regression)", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  /** Summary result carrying the authoritative window total `n`. */
  function summaryRows(n: number) {
    return [{ n, total_amt_out_sat: "0", total_fees_sat: "0", avg_fee_sat: null, max_ts_ns: null }];
  }

  /** The OFFSET param bound into the page SQL (last param: pubkey, days, spd, limit, offset). */
  function boundOffset(): unknown {
    const pageSqlArg = executeMock.mock.calls[1][0] as ReturnType<typeof buildForwardsPageSql>;
    const { params } = render(pageSqlArg);
    return params[params.length - 1];
  }

  it("?page=3 binds OFFSET (3-1)*pageSize — never the page-1 offset", async () => {
    executeMock.mockResolvedValueOnce(summaryRows(500)).mockResolvedValueOnce([]);
    const view = await forwardsPageData(PUBKEY, "7d", "3");
    expect(view.pagination).toMatchObject({ page: 3, offset: 100, pageCount: 10 });
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(boundOffset()).toBe(100);
  });

  it("over-range ?page clamps to the REAL last page and binds ITS offset", async () => {
    executeMock.mockResolvedValueOnce(summaryRows(120)).mockResolvedValueOnce([]);
    const view = await forwardsPageData(PUBKEY, "7d", "99");
    expect(view.pagination).toMatchObject({ page: 3, offset: 100, pageCount: 3 });
    expect(boundOffset()).toBe(100);
  });

  it("invalid ?page widens to page 1 / OFFSET 0 (T-13-11-01)", async () => {
    executeMock.mockResolvedValueOnce(summaryRows(500)).mockResolvedValueOnce([]);
    const view = await forwardsPageData(PUBKEY, "7d", "'; DROP TABLE x; --");
    expect(view.pagination).toMatchObject({ page: 1, offset: 0 });
    expect(boundOffset()).toBe(0);
  });
});

describe("buildBusiestChannelSql shape (summary-strip cell)", () => {
  it("groups by chan_id_out, orders by count desc, limit 1", () => {
    const { sql } = render(buildBusiestChannelSql(PUBKEY, 7));
    expect(sql).toContain("group by chan_id_out");
    expect(sql).toContain("order by count(*) desc");
    expect(sql).toContain("limit 1");
  });

  it("re-states the nanosecond window predicate", () => {
    const { sql } = render(buildBusiestChannelSql(PUBKEY, 7));
    expect(sql).toContain("timestamp_ns");
    expect(sql).toContain("1e9");
  });

  it("parameter-binds the pubkey (SQLi)", () => {
    const evil = "'; DROP TABLE lnd_node_forwards; --";
    const { sql, params } = render(buildBusiestChannelSql(evil, 7));
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});
