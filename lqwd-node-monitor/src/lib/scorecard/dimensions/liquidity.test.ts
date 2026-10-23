import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildLiquidityAllSql,
  buildRebalanceSuccessAllSql,
} from "@/lib/scorecard/dimensions/liquidity";

// Liquidity dimension SQL-shape tests (NO DB). Asserts the fleet-wide latest-
// state aggregate uses the AFM-001 DISTINCT ON (local_pubkey, chan_id)
// subquery (per-node partition key — CR-01: a bare DISTINCT ON (chan_id)
// fleet-wide drops one side of intra-fleet channels; WR-01 NULL-key guards on
// both key columns), groups by local_pubkey in the OUTER query, filters to
// active non-closed channels, NULLIF-guards the capacity denominator, and
// never uses the `WHERE timestamp =` latest-state anti-pattern. The rebalance
// builder's window must be parameter-bound.

const dialect = new PgDialect();

function renderLiquidity() {
  const built = dialect.sqlToQuery(buildLiquidityAllSql());
  return { sql: built.sql.toLowerCase(), params: built.params };
}

function renderRebalance(windowDays?: number) {
  const built = dialect.sqlToQuery(buildRebalanceSuccessAllSql(windowDays));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("liquidity buildLiquidityAllSql SQL shape (AFM-001)", () => {
  it("takes latest channel state via DISTINCT ON (local_pubkey, chan_id) in a subquery (CR-01)", () => {
    const { sql } = renderLiquidity();
    expect(sql).toContain("distinct on (local_pubkey, chan_id)");
    expect(sql).toContain("order by local_pubkey, chan_id, timestamp desc");
    // CR-01 regression pin: the bare fleet-wide chan_id key must never return —
    // it collapses intra-fleet channels across node partitions.
    expect(sql).not.toContain("distinct on (chan_id)");
  });

  it("carries the WR-01 NULL-key guards inside the subquery", () => {
    const { sql } = renderLiquidity();
    expect(sql).toContain("chan_id is not null");
    expect(sql).toContain("local_pubkey is not null");
  });

  it("aggregates the OUTER query fleet-wide: GROUP BY local_pubkey", () => {
    const { sql } = renderLiquidity();
    expect(sql).toContain("group by local_pubkey");
    expect(sql).toContain("local_pubkey is not null");
  });

  it("filters to active, non-closed channels (boolean filter)", () => {
    const { sql } = renderLiquidity();
    expect(sql).toContain("active and not closed");
  });

  it("NULLIF-guards the zero-capacity denominator", () => {
    const { sql } = renderLiquidity();
    expect(sql).toContain("nullif");
  });

  it("never uses the AFM-001 `WHERE timestamp =` latest-state anti-pattern", () => {
    const { sql } = renderLiquidity();
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("liquidity buildRebalanceSuccessAllSql SQL shape", () => {
  it("computes paid/total per node with NULLIF guard, grouped by identity column", () => {
    const { sql } = renderRebalance();
    expect(sql).toContain("group by requesting_node_pubkey");
    expect(sql).toContain("requesting_node_pubkey is not null");
    expect(sql).toContain("paid_status");
    expect(sql).toContain("nullif");
  });

  it("parameter-binds windowDays ($1), never interpolated into the SQL text", () => {
    // windowDays is number-typed by signature, so a string injection cannot
    // even compile — the residual check is that the value travels as a bound
    // parameter ($1 placeholder), not as SQL text.
    const { sql, params } = renderRebalance(7);
    expect(params).toContain(7);
    expect(sql).toContain("$1");
  });

  it("never uses the AFM-001 `WHERE timestamp =` latest-state anti-pattern", () => {
    const { sql } = renderRebalance();
    expect(sql).not.toContain("where timestamp =");
  });
});
