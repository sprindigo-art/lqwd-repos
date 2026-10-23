import { describe, it, expect, expectTypeOf } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildHostMetricsHistorySql,
  buildHostStorageHistorySql,
  getHostMetricsHistory,
  getHostStorageHistory,
  type HostMetricsHistoryPoint,
} from "@/lib/read/host-history";
import type { StorageGrowthSample } from "@/lib/read/storage-growth";

// =====================================================
// HOST-02 host-history helper-shape test (NO DB)
// =====================================================
// History reads are PLAIN BOUNDED SCANS over the append-history fact tables —
// NOT DISTINCT ON (that is the latest-per-entity pattern in host-metrics.ts)
// and NEVER `WHERE collected_at = MAX(...)` (the AFM-001 480-read-as-1
// landmine). Every scan is time-bounded (make_interval predicate — T-14-05)
// and hostId is ALWAYS parameter-bound ($1), never concatenated (T-14-03).

const dialect = new PgDialect();
const DAY_MS = 24 * 60 * 60 * 1000;

function renderMetrics(hostId: string, windowMs = DAY_MS) {
  const built = dialect.sqlToQuery(buildHostMetricsHistorySql(hostId, windowMs));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

function renderStorage(hostId: string, windowMs = DAY_MS) {
  const built = dialect.sqlToQuery(buildHostStorageHistorySql(hostId, windowMs));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("buildHostMetricsHistorySql SQL shape (bounded scan)", () => {
  it("scans host_metrics with a WHERE clause", () => {
    const { sql } = renderMetrics("host-1");
    expect(sql).toContain("from host_metrics");
    expect(sql).toContain("where");
  });

  it("parameter-binds hostId ($1), never concatenated", () => {
    const { sql, params } = renderMetrics("host-1");
    expect(sql).toContain("$1");
    expect(params).toContain("host-1");
  });

  it("bounds the scan with a make_interval window predicate (no unbounded scan)", () => {
    const { sql, params } = renderMetrics("host-1", DAY_MS);
    expect(sql).toContain("make_interval");
    expect(sql).toContain("collected_at >");
    // The window is bound as seconds, not interpolated.
    expect(params).toContain(DAY_MS / 1000);
  });

  it("orders ascending by collected_at (chart-ready series)", () => {
    expect(renderMetrics("host-1").sql).toContain("order by collected_at asc");
  });

  it("uses the offset-stable UTC now() idiom (DB1 — 24h window must not shift by session offset)", () => {
    const { sql } = renderMetrics("host-1");
    expect(sql).toContain("at time zone 'utc'");
  });

  it("is a plain scan — no DISTINCT ON and no MAX( (AFM-001 landmine)", () => {
    const { sql } = renderMetrics("host-1");
    expect(sql).not.toContain("distinct on");
    expect(sql).not.toContain("max(");
  });

  it("injection binding: evil hostId lands in params, never in the SQL text", () => {
    const evil = "'; DROP TABLE host_metrics; --";
    const { sql, params } = renderMetrics(evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});

describe("buildHostStorageHistorySql SQL shape (bounded scan)", () => {
  it("scans host_storage including mount_point, used_bytes, total_bytes", () => {
    const { sql } = renderStorage("host-1");
    expect(sql).toContain("from host_storage");
    expect(sql).toContain("mount_point");
    expect(sql).toContain("used_bytes");
    expect(sql).toContain("total_bytes");
  });

  it("parameter-binds hostId and the window", () => {
    const { sql, params } = renderStorage("host-1", DAY_MS);
    expect(sql).toContain("$1");
    expect(params).toContain("host-1");
    expect(sql).toContain("make_interval");
    expect(params).toContain(DAY_MS / 1000);
  });

  it("orders ascending by collected_at", () => {
    expect(renderStorage("host-1").sql).toContain("order by collected_at asc");
  });

  it("is a plain scan — no DISTINCT ON and no MAX(", () => {
    const { sql } = renderStorage("host-1");
    expect(sql).not.toContain("distinct on");
    expect(sql).not.toContain("max(");
  });

  it("injection binding: evil hostId never appears in the rendered SQL", () => {
    const evil = "'; DROP TABLE host_storage; --";
    const { sql, params } = renderStorage(evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
  });
});

describe("coercion contract (type-level, no DB)", () => {
  it("getHostMetricsHistory yields Date timestamps and number vitals", () => {
    expectTypeOf(getHostMetricsHistory).returns.resolves.toEqualTypeOf<
      HostMetricsHistoryPoint[]
    >();
    expectTypeOf<HostMetricsHistoryPoint["collectedAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<HostMetricsHistoryPoint["cpuPct"]>().toEqualTypeOf<number | null>();
    expectTypeOf<HostMetricsHistoryPoint["memTotalKb"]>().toEqualTypeOf<number | null>();
    expectTypeOf<HostMetricsHistoryPoint["memAvailableKb"]>().toEqualTypeOf<number | null>();
  });

  it("getHostStorageHistory yields StorageGrowthSample[] per mount (computeStorageGrowth-ready)", () => {
    expectTypeOf(getHostStorageHistory).returns.resolves.toEqualTypeOf<
      Map<string, StorageGrowthSample[]>
    >();
  });
});

// =====================================================
// Seeded (live nodemon DB) — skips cleanly with no NODEMON_QUEUE_URL
// =====================================================
const HAS_DB = !!process.env.NODEMON_QUEUE_URL;

describe.skipIf(!HAS_DB)("getHostMetricsHistory / getHostStorageHistory (live)", () => {
  it("metrics history returns coerced Dates and numbers, ascending", async () => {
    const points = await getHostMetricsHistory("host-metrics-test-fresh");
    for (const p of points) {
      expect(p.collectedAt).toBeInstanceOf(Date);
      if (p.cpuPct != null) expect(typeof p.cpuPct).toBe("number");
    }
    for (let i = 1; i < points.length; i++) {
      expect(points[i].collectedAt.getTime()).toBeGreaterThanOrEqual(
        points[i - 1].collectedAt.getTime(),
      );
    }
  });

  it("storage history groups ascending samples per mount", async () => {
    const byMount = await getHostStorageHistory("host-metrics-test-fresh");
    for (const samples of byMount.values()) {
      for (let i = 1; i < samples.length; i++) {
        expect(samples[i].collectedAt.getTime()).toBeGreaterThanOrEqual(
          samples[i - 1].collectedAt.getTime(),
        );
      }
    }
  });
});
