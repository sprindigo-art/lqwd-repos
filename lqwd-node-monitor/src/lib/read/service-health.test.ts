import { describe, it, expect, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildServiceHealthSql,
  deriveServiceHealth,
  getServiceHealth,
  COLLECTOR_WINDOW_MS,
  FUNCTIONING_GRACE,
  type ServiceHealthRow,
} from "@/lib/read/service-health";

// =====================================================
// service-health.test.ts — TEL-02 two-axis read helper
// =====================================================
// Task 1 (NO DB): asserts buildServiceHealthSql emits the AFM-001
// DISTINCT ON (host_id, service_name) shape over an INVENTORY-DRIVEN
// LEFT JOIN (so declared-but-never-reported services survive as no-data,
// SC#4), NEVER MAX( (the 480-as-1 failure moved to the per-service key),
// and binds the host key as $1 (T-11-11 SQL-injection mitigation).

const dialect = new PgDialect();

function renderFor(hostId: string) {
  const built = dialect.sqlToQuery(buildServiceHealthSql(hostId));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("AFM-001 buildServiceHealthSql shape (no DB)", () => {
  it("emits DISTINCT ON (host_id, service_name)", () => {
    const { sql } = renderFor("nodemon-host-1");
    expect(sql).toContain("distinct on (host_id, service_name)");
  });

  it("LEFT JOINs service_inventory (inventory-driven so declared-but-silent services survive)", () => {
    const { sql } = renderFor("nodemon-host-1");
    expect(sql).toContain("service_inventory");
    expect(sql).toContain("left join");
    expect(sql).toContain("service_health");
  });

  it("orders by host_id, service_name, collected_at DESC (latest-per-service)", () => {
    const { sql } = renderFor("nodemon-host-1");
    expect(sql).toContain("order by host_id, service_name, sh.collected_at desc");
  });

  it("never uses MAX( (the AFM-001 failure mode)", () => {
    const { sql } = renderFor("nodemon-host-1");
    expect(sql).not.toContain("max(");
  });

  it("filters service_name IS NOT NULL (NULL-key collapse guard)", () => {
    const { sql } = renderFor("nodemon-host-1");
    expect(sql).toContain("service_name is not null");
  });

  it("parameter-binds hostId ($1), never concatenated into the SQL text", () => {
    const evil = "'; DROP TABLE service_health; --";
    const { sql, params } = renderFor(evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });
});

// =====================================================
// Task 2 — pure two-axis + per-service-freshness derivation (NO DB)
// =====================================================
// deriveServiceHealth is a pure (row, now) → state map so the headline invariants
// are asserted deterministically without a live DB: up-but-dead → not-functioning,
// never-reported → no-data, and the per-service (NOT 15-min) freshness clock both
// ways (within interval → functioning; past interval → stale). "Green only when
// both axes true" is the running && functioning AND, expressed in the derivation.

const NOW = Date.parse("2026-06-29T12:00:00Z");
const min = (m: number) => m * 60 * 1000;

/** Minimal row factory — only the fields a scenario exercises, rest defaulted. */
function row(overrides: Partial<ServiceHealthRow>): ServiceHealthRow {
  return {
    host_id: "h1",
    service_name: "svc",
    inventory_node_pubkey: null,
    detection_method: null,
    expected_interval_seconds: null,
    is_expected: true,
    node_pubkey: null,
    collected_at: new Date(NOW).toISOString(),
    running: true,
    functioning: true,
    last_success_at: new Date(NOW).toISOString(),
    last_artifact_mtime: new Date(NOW).toISOString(),
    error_count: 0,
    detail: null,
    ...overrides,
  };
}

describe("deriveServiceHealth two-axis + per-service freshness (no DB)", () => {
  it("up-but-dead (running=true, functioning=false) reads not-functioning", () => {
    const s = deriveServiceHealth(
      row({ running: true, functioning: false, error_count: 17 }),
      NOW,
    );
    expect(s.running).toBe(true);
    expect(s.functioning).toBe(false);
    expect(s.noData).toBe(false);
    expect(s.green).toBe(false); // green ONLY when both axes true
    expect(s.errorCount).toBe(17);
  });

  it("declared-but-never-reported (no fact row) reads as no-data, not a false DOWN", () => {
    const s = deriveServiceHealth(
      row({
        collected_at: null,
        running: null,
        functioning: null,
        last_success_at: null,
        last_artifact_mtime: null,
        error_count: null,
      }),
      NOW,
    );
    expect(s.noData).toBe(true);
    expect(s.running).toBe(false);
    expect(s.functioning).toBe(false);
    expect(s.stale).toBe(false);
    expect(s.green).toBe(false);
  });

  it("healthy service (both axes true, fresh) reads green", () => {
    const s = deriveServiceHealth(row({ running: true, functioning: true }), NOW);
    expect(s.green).toBe(true);
    expect(s.stale).toBe(false);
    expect(s.collectorStale).toBe(false);
  });

  it("batch service older than 15 min but WITHIN its expected_interval reads functioning (NOT stale)", () => {
    // 60-min batch, artifact 20 min old: past the 15-min collector window yet
    // well within its own clock → must NOT read stale (RESEARCH Pitfall 1).
    const s = deriveServiceHealth(
      row({
        expected_interval_seconds: 3600,
        last_artifact_mtime: new Date(NOW - min(20)).toISOString(),
        // collector still ticked recently — collected_at is fresh.
        collected_at: new Date(NOW).toISOString(),
      }),
      NOW,
    );
    expect(s.stale).toBe(false);
    expect(s.functioning).toBe(true);
  });

  it("the SAME batch service PAST its expected_interval reads stale (functioning false)", () => {
    // Artifact 3 h old > expected_interval (3600s) × grace → functioning-stale.
    const s = deriveServiceHealth(
      row({
        expected_interval_seconds: 3600,
        last_artifact_mtime: new Date(NOW - min(180)).toISOString(),
      }),
      NOW,
    );
    expect(s.stale).toBe(true);
    expect(s.functioning).toBe(false);
    expect(s.green).toBe(false);
  });

  it("collector-freshness (15-min collected_at) is SEPARATE and never downs a batch service", () => {
    // collected_at 30 min old → collectorStale, but the per-service clock is fine,
    // so functioning stays true (the two clocks are not conflated).
    const s = deriveServiceHealth(
      row({
        expected_interval_seconds: 21600, // 6-hourly
        collected_at: new Date(NOW - min(30)).toISOString(),
        last_artifact_mtime: new Date(NOW - min(30)).toISOString(),
      }),
      NOW,
    );
    expect(s.collectorStale).toBe(true);
    expect(s.stale).toBe(false); // per-service clock: 30 min ≪ 6 h
    expect(s.functioning).toBe(true);
  });

  it("carries detail + detectionMethod through the MAIN branch (probe reason present)", () => {
    const s = deriveServiceHealth(
      row({
        running: true,
        functioning: false,
        detail: "probe: rpc timeout",
        detection_method: "systemd",
      }),
      NOW,
    );
    expect(s.noData).toBe(false);
    expect(s.detail).toBe("probe: rpc timeout");
    expect(s.detectionMethod).toBe("systemd");
  });

  it("carries detail + detectionMethod through the NO-DATA branch (still surfaced)", () => {
    const s = deriveServiceHealth(
      row({
        collected_at: null,
        running: null,
        functioning: null,
        last_success_at: null,
        last_artifact_mtime: null,
        error_count: null,
        detail: "probe: rpc timeout",
        detection_method: "systemd",
      }),
      NOW,
    );
    expect(s.noData).toBe(true);
    expect(s.detail).toBe("probe: rpc timeout");
    expect(s.detectionMethod).toBe("systemd");
  });

  it("detail=null (live LND fleet shape) yields state.detail null; errorCount/lastSuccessAt UNCHANGED", () => {
    const s = deriveServiceHealth(
      row({
        running: true,
        functioning: false,
        detail: null,
        detection_method: "systemd",
        error_count: 9,
        last_success_at: null,
      }),
      NOW,
    );
    expect(s.detail).toBeNull();
    expect(s.detectionMethod).toBe("systemd");
    expect(s.errorCount).toBe(9); // regression guard
    expect(s.lastSuccessAt).toBeNull(); // regression guard
  });

  it("exposes the freshness constants used by the derivation", () => {
    expect(COLLECTOR_WINDOW_MS).toBe(15 * 60 * 1000);
    expect(FUNCTIONING_GRACE).toBeGreaterThanOrEqual(2);
  });
});

// =====================================================
// D-svc (18-03 / HARDEN-01) — node attribution via the inventory fallback
// =====================================================
// The SQL has always selected `si.node_pubkey AS inventory_node_pubkey`, but the
// derivation read only the OBSERVED `sh.node_pubkey` — so a declared-but-silent
// node-scoped service (broken collector: no fact row, node_pubkey NULL) was
// misfiled as host-level infra and vanished from its node's grid. Attribution is
// `node_pubkey ?? inventory_node_pubkey` in BOTH branches (no-data + observed).
describe("deriveServiceHealth — node attribution fallback (D-svc)", () => {
  const NODE_PK = "02" + "ab".repeat(32);

  it("a declared-but-silent node-scoped service attributes to its node via inventory_node_pubkey", () => {
    const s = deriveServiceHealth(
      row({
        collected_at: null, // never reported — the LEFT JOIN miss
        node_pubkey: null,
        inventory_node_pubkey: NODE_PK,
        running: null,
        functioning: null,
        last_success_at: null,
        last_artifact_mtime: null,
        error_count: null,
      }),
      NOW,
    );
    expect(s.noData).toBe(true);
    expect(s.nodePubkey).toBe(NODE_PK); // NOT misfiled as host infra (null)
  });

  it("an observed row missing node_pubkey still attributes via the inventory declaration", () => {
    const s = deriveServiceHealth(
      row({ node_pubkey: null, inventory_node_pubkey: NODE_PK, running: true, functioning: true }),
      NOW,
    );
    expect(s.noData).toBe(false);
    expect(s.nodePubkey).toBe(NODE_PK);
  });

  it("an observed node_pubkey wins over the inventory declaration", () => {
    const OBSERVED_PK = "03" + "cd".repeat(32);
    const s = deriveServiceHealth(
      row({ node_pubkey: OBSERVED_PK, inventory_node_pubkey: NODE_PK }),
      NOW,
    );
    expect(s.nodePubkey).toBe(OBSERVED_PK);
  });

  it("a genuinely host-level service (no declaration either) stays unattributed", () => {
    const s = deriveServiceHealth(row({ node_pubkey: null, inventory_node_pubkey: null }), NOW);
    expect(s.nodePubkey).toBeNull();
  });
});

// =====================================================
// Task 2 — seeded integration (LIVE nodemon DB; skips cleanly without it)
// =====================================================
// Exercises getServiceHealth against the Plan-03 fixture. With no NODEMON_QUEUE_URL
// the suite SKIPS (no DB at module load — telemetry-fixture lazy-imports dbNodemon),
// which is the expected state in CI / this worktree. The fixture timestamps are
// relative to Date.now(), so the live read uses the default (real) clock.
const FIXTURE_KEY = "plan05";

describe.skipIf(!process.env.NODEMON_QUEUE_URL)("getServiceHealth seeded (live nodemon)", () => {
  afterAll(async () => {
    const { teardownTelemetryFixture } = await import("@/lib/read/telemetry-fixture");
    await teardownTelemetryFixture(FIXTURE_KEY);
  });

  it("up-but-dead service reads not-functioning; never-reported reads no-data; batch-within-interval reads functioning", async () => {
    const { seedTelemetryFixture } = await import("@/lib/read/telemetry-fixture");
    const seed = await seedTelemetryFixture(FIXTURE_KEY);

    const fresh = await getServiceHealth(seed.freshHostId);
    const byName = new Map(fresh.map((s) => [s.serviceName, s]));

    // (a) up-but-dead → not functioning.
    const dead = byName.get(seed.upButDeadService);
    expect(dead?.running).toBe(true);
    expect(dead?.functioning).toBe(false);
    expect(dead?.green).toBe(false);

    // healthy reference → green.
    const healthy = byName.get(seed.healthyService);
    expect(healthy?.green).toBe(true);

    // (c) batch within its own interval → functioning, NOT stale.
    const batch = byName.get(seed.batchService);
    expect(batch?.functioning).toBe(true);
    expect(batch?.stale).toBe(false);

    // (b) declared-but-never-reported service on the silent host → no-data.
    const silent = await getServiceHealth(seed.neverReportedHostId);
    const silentSvc = silent.find((s) => s.serviceName === seed.healthyService);
    expect(silentSvc?.noData).toBe(true);
  });
});
