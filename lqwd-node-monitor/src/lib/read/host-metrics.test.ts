import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildLatestHostMetricsSql,
  buildLatestHostStorageSql,
  getLatestHostMetrics,
  deriveStale,
  type HostMetricsView,
} from "@/lib/read/host-metrics";
import {
  seedTelemetryFixture,
  cleanupTelemetryFixture,
  type SeededTelemetry,
} from "@/lib/read/telemetry-fixture";

// =====================================================
// AFM-001 host-metrics helper-shape test (NO DB)
// =====================================================
// Asserts the latest-host-vitals reads emit DISTINCT ON the entity key
// (host_id / host_id, mount_point) ... ORDER BY key, collected_at DESC and
// NEVER MAX( — the documented 480-read-as-1 failure moved onto the telemetry
// tables. Also confirms hostId is parameter-bound ($1), never concatenated.

const dialect = new PgDialect();

function renderMetrics(hostId: string) {
  const built = dialect.sqlToQuery(buildLatestHostMetricsSql(hostId));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

function renderStorage(hostId: string) {
  const built = dialect.sqlToQuery(buildLatestHostStorageSql(hostId));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("AFM-001 buildLatestHostMetricsSql SQL shape", () => {
  it("emits DISTINCT ON (host_id)", () => {
    expect(renderMetrics("host-1").sql).toContain("distinct on (host_id)");
  });

  it("orders by host_id, collected_at DESC (latest-per-host)", () => {
    expect(renderMetrics("host-1").sql).toContain("order by host_id, collected_at desc");
  });

  it("never uses MAX( (the AFM-001 failure mode)", () => {
    expect(renderMetrics("host-1").sql).not.toContain("max(");
  });

  it("parameter-binds hostId ($1), never concatenated into the SQL text", () => {
    const evil = "'; DROP TABLE host_metrics; --";
    const { sql, params } = renderMetrics(evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });
});

describe("AFM-001 buildLatestHostStorageSql SQL shape", () => {
  it("emits DISTINCT ON (host_id, mount_point)", () => {
    expect(renderStorage("host-1").sql).toContain("distinct on (host_id, mount_point)");
  });

  it("never uses MAX(", () => {
    expect(renderStorage("host-1").sql).not.toContain("max(");
  });

  it("parameter-binds hostId ($1)", () => {
    const { sql, params } = renderStorage("host-1");
    expect(params).toContain("host-1");
    expect(sql).toContain("$1");
  });
});

describe("deriveStale (read-time D-13 staleness, no stored flag)", () => {
  it("a row collected now reads NOT stale", () => {
    expect(deriveStale(new Date())).toBe(false);
  });

  it("a row collected 30 min ago reads stale (~15-min window)", () => {
    expect(deriveStale(new Date(Date.now() - 30 * 60 * 1000))).toBe(true);
  });

  it("a never-reported host (null collected_at) reads stale / no-data", () => {
    expect(deriveStale(null)).toBe(true);
  });
});

// =====================================================
// Seeded (live nodemon DB) — skips cleanly with no NODEMON_QUEUE_URL
// =====================================================
const HAS_DB = !!process.env.NODEMON_QUEUE_URL;
const KEY = "host-metrics-test";

describe.skipIf(!HAS_DB)("getLatestHostMetrics (seeded)", () => {
  let seeded: SeededTelemetry;
  let views: HostMetricsView[];

  beforeAll(async () => {
    seeded = await seedTelemetryFixture(KEY);
    // Insert an OLDER history row for the fresh host to prove latest-per-host.
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { hostMetrics } = await import("@/lib/db/schema/nodemon");
    await dbNodemon.insert(hostMetrics).values({
      hostId: seeded.freshHostId,
      collectedAt: new Date(Date.now() - 60 * 60 * 1000), // 1h older
      cpuPct: "99.0",
      memTotalKb: 32_000_000n,
      memAvailableKb: 1_000_000n,
    });
    views = await getLatestHostMetrics();
  });

  afterAll(async () => {
    await cleanupTelemetryFixture(KEY);
  });

  function viewFor(hostId: string): HostMetricsView | undefined {
    return views.find((v) => v.hostId === hostId);
  }

  it("returns exactly one entry per declared host_id (DISTINCT-ON, not N rows)", () => {
    for (const hostId of seeded.allHostIds) {
      expect(views.filter((v) => v.hostId === hostId)).toHaveLength(1);
    }
  });

  it("returns the LATEST row per host even when older history exists", () => {
    const fresh = viewFor(seeded.freshHostId);
    expect(fresh?.hasData).toBe(true);
    // The newest row's cpu_pct is 12.5 (fixture), not the 99.0 older row.
    expect(String(fresh?.metrics?.cpu_pct)).toBe("12.5");
  });

  it("fresh host reads NOT stale; stale host reads stale (D-13)", () => {
    expect(viewFor(seeded.freshHostId)?.stale).toBe(false);
    expect(viewFor(seeded.staleHostId)?.stale).toBe(true);
  });

  it("declared-but-never-reported host reads as no-data (LEFT JOIN, SC#4)", () => {
    const silent = viewFor(seeded.neverReportedHostId);
    expect(silent).toBeDefined();
    expect(silent?.hasData).toBe(false);
    expect(silent?.metrics).toBeNull();
    expect(silent?.stale).toBe(true);
  });

  it("surfaces latest per-mount storage for the fresh host", () => {
    const fresh = viewFor(seeded.freshHostId);
    expect(fresh?.storage.length).toBeGreaterThanOrEqual(1);
    expect(fresh?.storage[0]?.mount_point).toBe("/");
  });
});
