import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildRevenueAllSql } from "@/lib/scorecard/dimensions/revenue";

// Revenue dimension SQL-shape test (NO DB). Asserts the fleet-wide earnings/PPM
// aggregate uses fee_msat (NEVER raw `fee` — AFM-002 1000x-off failure), a
// NULLIF-guarded PPM denominator over amt_in_msat, NANOSECOND windows
// (timestamp_ns × 1e9 — RESEARCH Pitfall 3), and never the AFM-001
// `WHERE timestamp =` latest-state anti-pattern.

const dialect = new PgDialect();

function render() {
  const built = dialect.sqlToQuery(buildRevenueAllSql());
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("revenue buildRevenueAllSql SQL shape", () => {
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

  it("uses fee_msat, never the forbidden raw `fee` column (AFM-002)", () => {
    const { sql } = render();
    expect(sql).toContain("fee_msat");
    expect(sql).not.toMatch(/sum\(fee\s*\)/);
  });

  it("guards the PPM denominator with NULLIF over amt_in_msat (null, not 0, on no flow)", () => {
    const { sql } = render();
    expect(sql).toContain("nullif");
    expect(sql).toContain("amt_in_msat");
  });

  it("never uses the AFM-001 `WHERE timestamp =` latest-state anti-pattern", () => {
    const { sql } = render();
    expect(sql).not.toContain("where timestamp =");
  });
});
