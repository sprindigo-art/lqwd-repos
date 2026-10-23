import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildForceCloseAggSql,
  buildSelfCloseStormSql,
} from "@/lib/scorecard/dimensions/force-close";
import { SCORECARD_CONFIG } from "@/lib/scorecard/config";

// Force-close dimension SQL-shape tests (NO DB). Asserts:
//  - the agg builder counts via FILTER on verified close_type enum literals + NULLIF
//  - the storm builder hour-buckets self-initiated closes (AP-11 input)
//  - both group per node and exclude NULL local_pubkey
//  - window params are NUMBER-typed and parameter-BOUND ($1), never concatenated
//  - the extras key the executor emits matches the config tier1 metric string
//    exactly (T-02-07 — a mismatch silently disables the AP-11 red line)

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildForceCloseAggSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

describe("buildForceCloseAggSql shape", () => {
  it("filters LOCAL_FORCE_CLOSE and COOPERATIVE_CLOSE via COUNT FILTER on enum literals", () => {
    const { sql } = render(buildForceCloseAggSql());
    expect(sql).toContain("filter (where close_type = ");
    expect(sql).toContain("'local_force_close'");
    expect(sql).toContain("'cooperative_close'");
    expect(sql).toContain("'initiator_remote'");
  });

  it("guards the coop-REMOTE share denominator with NULLIF", () => {
    const { sql } = render(buildForceCloseAggSql());
    expect(sql).toContain("nullif");
  });

  it("aggregates per node and excludes NULL local_pubkey", () => {
    const { sql } = render(buildForceCloseAggSql());
    expect(sql).toContain("group by local_pubkey");
    expect(sql).toContain("local_pubkey is not null");
  });

  it("binds the window-days param ($1) instead of interpolating it", () => {
    const { sql, params } = render(buildForceCloseAggSql(30));
    expect(sql).toContain("$1");
    expect(params).toContain(30);
  });

  it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
    const { sql } = render(buildForceCloseAggSql());
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("buildSelfCloseStormSql shape (AP-11 input)", () => {
  it("hour-buckets via date_trunc('hour') and filters self-initiated closes", () => {
    const { sql } = render(buildSelfCloseStormSql());
    expect(sql).toContain("date_trunc('hour'");
    expect(sql).toContain("'initiator_local'");
  });

  it("aggregates per node and excludes NULL local_pubkey", () => {
    const { sql } = render(buildSelfCloseStormSql());
    expect(sql).toContain("group by local_pubkey");
    expect(sql).toContain("local_pubkey is not null");
  });

  it("binds the window-hours param ($1) instead of interpolating it", () => {
    const { sql, params } = render(buildSelfCloseStormSql(24));
    expect(sql).toContain("$1");
    expect(params).toContain(24);
  });

  it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
    const { sql } = render(buildSelfCloseStormSql());
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("injection surface", () => {
  it("builders accept only number args — enum strings are fixed literals, params carry only the bound numbers", () => {
    const agg = render(buildForceCloseAggSql(7));
    const storm = render(buildSelfCloseStormSql(6));
    // Every bound param is a number (no string ever flows into the SQL).
    expect(agg.params.every((p) => typeof p === "number")).toBe(true);
    expect(storm.params.every((p) => typeof p === "number")).toBe(true);
    expect(agg.params).toEqual([7]);
    expect(storm.params).toEqual([6]);
  });
});

describe("AP-11 tier1 metric key contract (T-02-07)", () => {
  it('config tier1 metric for forceClose is exactly "maxHourlySelfCloses" on both backends', () => {
    expect(SCORECARD_CONFIG.lnd.forceClose.tier1?.metric).toBe("maxHourlySelfCloses");
    expect(SCORECARD_CONFIG.ldk.forceClose.tier1?.metric).toBe("maxHourlySelfCloses");
  });
});
