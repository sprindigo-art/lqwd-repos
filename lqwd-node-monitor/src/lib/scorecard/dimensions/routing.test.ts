import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildRoutingAllSql } from "@/lib/scorecard/dimensions/routing";

// Routing dimension SQL-shape test (NO DB). Asserts the fleet-wide forwards
// aggregate is GROUP BY lnd_pubkey over a NANOSECOND window (timestamp_ns ×
// 1e9 — RESEARCH Pitfall 3), never the AFM-001 `WHERE timestamp =` latest-state
// anti-pattern, and never the forbidden raw `fee` column (AFM-002).

const dialect = new PgDialect();

function render(windowDays?: number) {
  const built = dialect.sqlToQuery(buildRoutingAllSql(windowDays));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("routing buildRoutingAllSql SQL shape", () => {
  it("is fleet-wide: GROUP BY lnd_pubkey with NULL-key guard", () => {
    const { sql } = render();
    expect(sql).toContain("group by lnd_pubkey");
    expect(sql).toContain("lnd_pubkey is not null");
  });

  it("windows on timestamp_ns with the *1e9 nanosecond factor (Pitfall 3)", () => {
    const { sql } = render();
    expect(sql).toContain("timestamp_ns");
    expect(sql).toContain("1e9");
  });

  it("never uses the AFM-001 `WHERE timestamp =` latest-state anti-pattern", () => {
    const { sql } = render();
    expect(sql).not.toContain("where timestamp =");
  });

  it("never touches the forbidden raw `fee` column (AFM-002)", () => {
    const { sql } = render();
    expect(sql).not.toMatch(/sum\(fee\s*\)/);
  });

  it("parameter-binds windowDays ($1), never interpolated into the SQL text", () => {
    // windowDays is number-typed by signature, so a string injection cannot
    // even compile — the residual check is that the value travels as a bound
    // parameter ($1 placeholder), not as SQL text.
    const { sql, params } = render(7);
    expect(params).toContain(7);
    expect(sql).toContain("$1");
  });
});
