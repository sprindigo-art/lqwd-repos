import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildServiceLogEventsSql,
  mapServiceLogEventRow,
  getServiceLogEvents,
  type ServiceLogEventRow,
} from "@/lib/read/service-log-events";

// =====================================================
// COL-01 service-log-events reader — shape tests (NO DB)
// =====================================================
// Asserts the log-stream read emits the D-04 read-time benign-suppression JOIN
// keyed on the matched-pattern PRIMARY KEY (`c.id = e.config_id`) — NEVER on
// `classification`, which does not uniquely determine `suppress` (the `benign`
// class holds both suppress=true BP-rows and the suppress=false SQLSTATE 40001
// sibling; `critical` holds 5 sibling rows). A classification join would invert
// suppression (BP-001 leaks) and fan out rows (a critical line rendered 5×).
// Also confirms this is a STREAM (ORDER BY collected_at DESC LIMIT N, never
// DISTINCT ON) and that hostId/service are BOUND parameters (T-15-01).

const dialect = new PgDialect();

function render(hostId: string, service: string | null) {
  const built = dialect.sqlToQuery(buildServiceLogEventsSql(hostId, service));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("COL-01 buildServiceLogEventsSql SQL shape", () => {
  it("LEFT JOINs log_patterns_config on the matched-pattern PK (c.id = e.config_id)", () => {
    const { sql } = render("host-1", null);
    expect(sql).toContain("left join log_patterns_config");
    expect(sql).toContain("c.id = e.config_id");
  });

  it("suppresses at read via COALESCE(c.suppress, false) = false (unmatched lines survive)", () => {
    expect(render("host-1", null).sql).toContain("coalesce(c.suppress, false) = false");
  });

  it("NEVER joins on classification (the suppression-inversion / fan-out bug)", () => {
    expect(render("host-1", null).sql).not.toContain("c.classification = e.classification");
    expect(render("host-1", null).sql).not.toContain("classification =");
  });

  it("is a log STREAM: collected_at DESC + LIMIT, no DISTINCT ON, no MAX(", () => {
    const { sql } = render("host-1", null);
    expect(sql).toContain("collected_at desc");
    expect(sql).toContain("limit");
    expect(sql).not.toContain("distinct on");
    expect(sql).not.toContain("max(");
  });

  it("asserts host_id IS NOT NULL (RLS honesty)", () => {
    expect(render("host-1", null).sql).toContain("host_id is not null");
  });

  it("parameter-binds hostId ($1), never concatenated into the SQL text (T-15-01)", () => {
    const evil = "'; DROP TABLE service_log_events; --";
    const { sql, params } = render(evil, null);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });

  it("adds a BOUND service_name filter only when a service is given", () => {
    const without = render("host-1", null);
    expect(without.sql).not.toContain("service_name =");

    const evilService = "bitcoind'; DELETE FROM service_log_events; --";
    const withService = render("host-1", evilService);
    expect(withService.sql).toContain("e.service_name =");
    expect(withService.sql).not.toContain("delete from");
    expect(withService.params).toContain(evilService);
  });

  // ── Phase-16 D-04/D-05 taxonomy-reconcile guardrails ────────────────
  // The read-layer benign suppression is keyed on the matched-pattern PK
  // (config_id), NEVER on the classification string. Under the new
  // {info,warn,critical} taxonomy (16-04) a config_id=NULL ("other" /
  // unmatched) row MUST still survive — LEFT JOIN + COALESCE(false) shows it.
  // These would FAIL if a future edit regressed to a classification-string
  // join or added a `config_id IS NOT NULL` filter that drops unmatched lines.
  it("keeps unmatched (config_id = NULL) lines via LEFT JOIN + COALESCE — never drops them", () => {
    const { sql } = render("host-1", null);
    expect(sql).toContain("left join log_patterns_config");
    expect(sql).toContain("coalesce(c.suppress, false) = false");
    // A NULL-config row must NOT be filtered out by the query itself.
    expect(sql).not.toContain("config_id is not null");
    expect(sql).not.toContain("e.config_id =");
  });

  it("suppression is NEVER keyed on the classification string (D-04 inversion guard)", () => {
    const { sql } = render("host-1", null);
    expect(sql).not.toContain("classification");
    expect(sql).toContain("c.id = e.config_id");
  });
});

describe("COL-01 mapServiceLogEventRow → NodeLogLine", () => {
  function row(overrides: Partial<ServiceLogEventRow> = {}): ServiceLogEventRow {
    return {
      id: "row-1",
      host_id: "host-1",
      collected_at: new Date("2026-07-14T10:03:22Z"),
      service_name: "bitcoind",
      level: "error",
      message: "boom",
      ...overrides,
    };
  }

  it("maps id/service/message through and pre-formats ts (component does no unit math)", () => {
    const line = mapServiceLogEventRow(row());
    expect(line.id).toBe("row-1");
    expect(line.service).toBe("bitcoind");
    expect(line.message).toBe("boom");
    expect(line.level).toBe("error");
    expect(typeof line.ts).toBe("string");
    expect(line.ts).toContain("10:03:22");
  });

  it('narrows level "debug" → "info" (unknown levels never leak into the chip)', () => {
    expect(mapServiceLogEventRow(row({ level: "debug" })).level).toBe("info");
  });

  it("narrows unknown / null levels → info; warn variants → warn; fatal → error", () => {
    expect(mapServiceLogEventRow(row({ level: "whatever" })).level).toBe("info");
    expect(mapServiceLogEventRow(row({ level: null })).level).toBe("info");
    expect(mapServiceLogEventRow(row({ level: "WARN" })).level).toBe("warn");
    expect(mapServiceLogEventRow(row({ level: "warning" })).level).toBe("warn");
    expect(mapServiceLogEventRow(row({ level: "fatal" })).level).toBe("error");
  });

  it("passes the message through UNCHANGED — inert data, no interpolation (T-15-05/T-15-07)", () => {
    const hostile = '<script>alert(1)</script> `rm -rf /` ${process.env.SECRET}';
    expect(mapServiceLogEventRow(row({ message: hostile })).message).toBe(hostile);
  });

  // ── Phase-16 {info,warn,critical} taxonomy narrowing guardrails ─────
  // 16-04 re-derives classification into {info,warn,critical}. The reader
  // narrows the LEVEL column into the chip vocabulary; these lock the
  // level→chip mapping so it stays stable across the taxonomy rename.
  it("narrows the new taxonomy levels: critical/crit → error, warn/warning → warn, info → info", () => {
    expect(mapServiceLogEventRow(row({ level: "critical" })).level).toBe("error");
    expect(mapServiceLogEventRow(row({ level: "crit" })).level).toBe("error");
    expect(mapServiceLogEventRow(row({ level: "warn" })).level).toBe("warn");
    expect(mapServiceLogEventRow(row({ level: "warning" })).level).toBe("warn");
    expect(mapServiceLogEventRow(row({ level: "info" })).level).toBe("info");
  });
});

// =====================================================
// Seeded (live nodemon DB) — skips cleanly with no NODEMON_QUEUE_URL.
// Requires the Phase-15 0003 migration applied (operator-gated, Plan 15-01);
// if the tables are absent the suite skips per-test rather than erroring.
// =====================================================
const HAS_DB = !!process.env.NODEMON_QUEUE_URL;
const HOST = "svc-log-events-test-host";

describe.skipIf(!HAS_DB)("getServiceLogEvents (seeded — per-pattern suppression)", () => {
  let tablesReady = false;
  let bp001ConfigId: string;
  let sql40001ConfigId: string;
  let criticalConfigId: string;
  const configIds: string[] = [];

  beforeAll(async () => {
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { sql } = await import("drizzle-orm");

    // Phase-15 tables are operator-gated (Plan 15-01) — skip if 0003 not applied.
    const probe = (await dbNodemon.execute(
      sql`SELECT to_regclass('service_log_events') AS t, to_regclass('log_patterns_config') AS c`,
    )) as unknown as { t: string | null; c: string | null }[];
    tablesReady = !!probe[0]?.t && !!probe[0]?.c;
    if (!tablesReady) return;

    const { serviceLogEvents, logPatternsConfig } = await import("@/lib/db/schema/nodemon");

    // Idempotent: clean any prior run's rows first.
    await dbNodemon.execute(sql`DELETE FROM service_log_events WHERE host_id = ${HOST}`);
    await dbNodemon.execute(
      sql`DELETE FROM log_patterns_config WHERE note LIKE ${"svc-log-events-test:%"}`,
    );

    // Two config rows SHARING classification `benign` — one suppress=true (BP-001)
    // and one suppress=false (SQLSTATE 40001): classification does NOT determine
    // suppress. Plus TWO sibling `critical` rows so classification is non-unique
    // (a classification join would fan a critical event out 2×).
    const configs = await dbNodemon
      .insert(logPatternsConfig)
      .values([
        {
          matchExpression: "svc-test-bp001",
          service: "postgres",
          level: "info",
          classification: "benign",
          suppress: true,
          note: "svc-log-events-test:bp001",
        },
        {
          matchExpression: "svc-test-40001",
          service: "postgres",
          level: "warn",
          classification: "benign",
          suppress: false,
          note: "svc-log-events-test:40001",
        },
        {
          matchExpression: "svc-test-critical",
          service: "bitcoind",
          level: "error",
          classification: "critical",
          suppress: false,
          note: "svc-log-events-test:critical",
        },
        {
          matchExpression: "svc-test-critical-sibling",
          service: "lnd",
          level: "error",
          classification: "critical",
          suppress: false,
          note: "svc-log-events-test:critical-sibling",
        },
      ])
      .returning({ id: logPatternsConfig.id, note: logPatternsConfig.note });

    for (const c of configs) configIds.push(c.id);
    bp001ConfigId = configs.find((c) => c.note === "svc-log-events-test:bp001")!.id;
    sql40001ConfigId = configs.find((c) => c.note === "svc-log-events-test:40001")!.id;
    criticalConfigId = configs.find((c) => c.note === "svc-log-events-test:critical")!.id;

    const now = Date.now();
    await dbNodemon.insert(serviceLogEvents).values([
      {
        hostId: HOST,
        collectedAt: new Date(now - 3000),
        serviceName: "postgres",
        level: "info",
        message: "svc-test BP-001 benign checkpoint line",
        signature: "svc-test-sig-bp001",
        classification: "benign",
        configId: bp001ConfigId,
      },
      {
        hostId: HOST,
        collectedAt: new Date(now - 2000),
        serviceName: "postgres",
        level: "warn",
        message: "svc-test SQLSTATE 40001 serialization failure",
        signature: "svc-test-sig-40001",
        classification: "benign",
        configId: sql40001ConfigId,
      },
      {
        hostId: HOST,
        collectedAt: new Date(now - 1000),
        serviceName: "bitcoind",
        level: "error",
        message: "svc-test critical corruption line",
        signature: "svc-test-sig-critical",
        classification: "critical",
        configId: criticalConfigId,
      },
    ]);
  });

  afterAll(async () => {
    if (!HAS_DB || !tablesReady) return;
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { sql } = await import("drizzle-orm");
    await dbNodemon.execute(sql`DELETE FROM service_log_events WHERE host_id = ${HOST}`);
    await dbNodemon.execute(
      sql`DELETE FROM log_patterns_config WHERE note LIKE ${"svc-log-events-test:%"}`,
    );
  });

  it("SUPPRESSES the BP-001 line (matched pattern suppress=true) at read time", async (ctx) => {
    if (!tablesReady) return ctx.skip();
    const view = await getServiceLogEvents(HOST, null);
    expect(view.lines.some((l) => l.message.includes("BP-001"))).toBe(false);
  });

  it("the 40001 sibling (same classification, suppress=false) SURVIVES — no inversion", async (ctx) => {
    if (!tablesReady) return ctx.skip();
    const view = await getServiceLogEvents(HOST, null);
    expect(view.lines.some((l) => l.message.includes("40001"))).toBe(true);
  });

  it("a critical event whose classification has sibling config rows appears EXACTLY ONCE", async (ctx) => {
    if (!tablesReady) return ctx.skip();
    const view = await getServiceLogEvents(HOST, null);
    expect(view.lines.filter((l) => l.message.includes("critical corruption"))).toHaveLength(1);
  });

  it("returns newest-first and filters by service when given", async (ctx) => {
    if (!tablesReady) return ctx.skip();
    const view = await getServiceLogEvents(HOST, null);
    expect(view.lines[0]?.message).toContain("critical corruption");
    expect(view.stale).toBe(false);

    const pgOnly = await getServiceLogEvents(HOST, "postgres");
    expect(pgOnly.lines.every((l) => l.service === "postgres")).toBe(true);
    expect(pgOnly.lines.some((l) => l.message.includes("critical"))).toBe(false);
  });
});
