import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildLatestPgHealthSql,
  buildFleetRecentPgHealthSql,
  derivePgHealthVerdict,
  getPgHealth,
  type LatestPgHealthRow,
} from "@/lib/read/pg-health";

// =====================================================
// COL-02 — pg_health latest-per-host reader + AP-12 discriminator (NO DB)
// =====================================================
// derivePgHealthVerdict is PURE (mirrors buildChainEvidence): it takes RAW
// pg_health rows and derives the AP-12a-vs-b discriminator + the
// connection-saturation / 40001-rate bands at READ time (D-14 — no a/b verdict
// is ever read from the DB). The 40001 rate promotes benign→ap12 ONLY at ≥10×
// the 400–800/day chronic-benign baseline (BP-005) so a healthy node's chronic
// 40001s never false-page. Counter deltas go through clampCounterDelta so a
// stats_reset boundary can never yield a negative Δ (Pitfall 7).

const dialect = new PgDialect();

function renderLatest(hostId: string) {
  const built = dialect.sqlToQuery(buildLatestPgHealthSql(hostId));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

// One day apart — makes per-day rate scaling arithmetic exact in fixtures.
const PREV_AT = new Date("2026-07-13T00:00:00Z");
const CURR_AT = new Date("2026-07-14T00:00:00Z");

function makeRow(overrides: Partial<LatestPgHealthRow> = {}): LatestPgHealthRow {
  return {
    host_id: "host-1",
    collected_at: CURR_AT,
    datname: "lnd_canary",
    max_connections: 100,
    active_connections: 20,
    numbackends: 20,
    xact_commit: 1_000_000n,
    xact_rollback: 5_000n,
    deadlocks: 0n,
    too_many_clients_count: 0n,
    serialization_40001_count: 100_000n,
    fatal_count: 0n,
    blocked_queries: 0,
    slow_query_gt_1s: 0,
    stats_reset: "2026-07-01 00:00:00",
    ...overrides,
  };
}

function makePrev(overrides: Partial<LatestPgHealthRow> = {}): LatestPgHealthRow {
  return makeRow({ collected_at: PREV_AT, ...overrides });
}

// =====================================================
// AFM-001 SQL shape — DISTINCT ON, param-bound, never MAX(
// =====================================================
describe("buildLatestPgHealthSql SQL shape (AFM-001)", () => {
  it("emits DISTINCT ON (host_id)", () => {
    expect(renderLatest("host-1").sql).toContain("distinct on (host_id)");
  });

  it("orders by host_id, collected_at DESC (latest-per-host)", () => {
    expect(renderLatest("host-1").sql).toContain("order by host_id, collected_at desc");
  });

  it("never uses MAX( (the AFM-001 failure mode)", () => {
    expect(renderLatest("host-1").sql).not.toContain("max(");
  });

  it("parameter-binds hostId ($1), never concatenated (T-15-01)", () => {
    const evil = "'; DROP TABLE pg_health; --";
    const { sql, params } = renderLatest(evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });

  // The single-host reader is the single-entity FALLBACK — it must stay UNBOUNDED
  // so a >30-day-stale host's detail still resolves (mirrors latestNodeInfo).
  it("single-host reader carries NO recency window (single-entity fallback)", () => {
    expect(renderLatest("host-1").sql).not.toContain("make_interval");
  });
});

// PERF-01 mirror (T-18-15): the FLEET ROW_NUMBER scan over all of pg_health is the
// unbounded full-partition scan — it MUST carry a UTC recency window, never MAX().
describe("buildFleetRecentPgHealthSql — bounded fleet window (T-18-15)", () => {
  function renderFleet() {
    return dialect.sqlToQuery(buildFleetRecentPgHealthSql()).sql.toLowerCase();
  }

  it("bounds the ROW_NUMBER scan with a UTC recency window (make_interval)", () => {
    const sql = renderFleet();
    expect(sql).toContain("row_number()");
    expect(sql).toContain("make_interval");
    expect(sql).toContain("at time zone 'utc'");
    expect(sql).toContain("collected_at >");
  });

  it("never uses MAX( (AFM-001)", () => {
    expect(renderFleet()).not.toContain("max(");
  });
});

// =====================================================
// derivePgHealthVerdict — the AP-12a/b discriminator (pure, read-time)
// =====================================================
describe("derivePgHealthVerdict — AP-12a (connection exhaustion)", () => {
  it("high too_many_clients_count ⇒ variant 'ap12a'", () => {
    const verdict = derivePgHealthVerdict(makeRow({ too_many_clients_count: 150n }));
    expect(verdict.ap12Variant).toBe("ap12a");
    expect(verdict.tooManyClients).toBe(150);
  });

  it("saturation ≥ 0.8 with zero too-many-clients ⇒ still 'ap12a'", () => {
    const verdict = derivePgHealthVerdict(
      makeRow({ active_connections: 90, max_connections: 100 }),
    );
    expect(verdict.ap12Variant).toBe("ap12a");
    expect(verdict.connSaturation?.value).toBeCloseTo(0.9);
    expect(verdict.connSaturation?.band).toBe("warn");
  });

  it("saturation > 0.95 grades the conn band critical", () => {
    const verdict = derivePgHealthVerdict(
      makeRow({ active_connections: 98, max_connections: 100 }),
    );
    expect(verdict.ap12Variant).toBe("ap12a");
    expect(verdict.connSaturation?.band).toBe("critical");
  });

  it("ap12a takes precedence over a simultaneous 40001 storm (runbook step 5)", () => {
    const verdict = derivePgHealthVerdict(
      makeRow({ too_many_clients_count: 200n, serialization_40001_count: 120_000n }),
      makePrev({ serialization_40001_count: 100_000n }),
    );
    expect(verdict.ap12Variant).toBe("ap12a");
  });
});

describe("derivePgHealthVerdict — AP-12b (serialization storm, ≥10× baseline)", () => {
  it("high 40001 rate (≥10× baseline) + zero too-many-clients ⇒ 'ap12b'", () => {
    // Δ = 10,000 over exactly one day = 10,000/day vs 600/day baseline ≈ 16.7×.
    const verdict = derivePgHealthVerdict(
      makeRow({ serialization_40001_count: 110_000n }),
      makePrev({ serialization_40001_count: 100_000n }),
    );
    expect(verdict.ap12Variant).toBe("ap12b");
    expect(verdict.serialization40001PerDay).toBeCloseTo(10_000);
    expect(verdict.rateMultiple?.value).toBeCloseTo(10_000 / 600);
    expect(verdict.rateMultiple?.band).toBe("critical");
  });

  it("respects an explicit baseline override", () => {
    // Δ = 10,000/day vs a 5,000/day baseline = 2× → NOT promoted.
    const verdict = derivePgHealthVerdict(
      makeRow({ serialization_40001_count: 110_000n }),
      makePrev({ serialization_40001_count: 100_000n }),
      5_000,
    );
    expect(verdict.ap12Variant).toBeNull();
    expect(verdict.rateMultiple?.band).toBe("healthy");
  });
});

describe("derivePgHealthVerdict — benign baseline never false-pages (BP-005)", () => {
  it("500/day 40001 (inside the 400–800/day chronic-benign band) ⇒ null variant", () => {
    const verdict = derivePgHealthVerdict(
      makeRow({ serialization_40001_count: 100_500n }),
      makePrev({ serialization_40001_count: 100_000n }),
    );
    expect(verdict.ap12Variant).toBeNull();
    expect(verdict.serialization40001PerDay).toBeCloseTo(500);
    expect(verdict.rateMultiple?.band).toBe("healthy");
  });
});

describe("derivePgHealthVerdict — counter-reset clamp (Pitfall 7)", () => {
  it("a stats_reset boundary clamps the 40001 Δ to ≥0 (curr as fresh baseline)", () => {
    // Counter went 100,000 → 200 across a moved stats_reset: naive Δ = -99,800.
    const verdict = derivePgHealthVerdict(
      makeRow({ serialization_40001_count: 200n, stats_reset: "2026-07-13 12:00:00" }),
      makePrev({ serialization_40001_count: 100_000n, stats_reset: "2026-07-01 00:00:00" }),
    );
    expect(verdict.serialization40001PerDay).toBeCloseTo(200);
    expect(verdict.serialization40001PerDay!).toBeGreaterThanOrEqual(0);
    expect(verdict.ap12Variant).toBeNull();
    expect(verdict.xactRollbackDelta).not.toBeLessThan(0);
  });
});

describe("derivePgHealthVerdict — honest no-data", () => {
  it("no previous sample ⇒ null rates, no ap12b promotion possible", () => {
    const verdict = derivePgHealthVerdict(makeRow());
    expect(verdict.serialization40001PerDay).toBeNull();
    expect(verdict.rateMultiple).toBeNull();
    expect(verdict.xactRollbackDelta).toBeNull();
    expect(verdict.ap12Variant).toBeNull();
  });

  it("missing max/active connections ⇒ null saturation (never a phantom 0)", () => {
    const verdict = derivePgHealthVerdict(
      makeRow({ max_connections: null, active_connections: null }),
    );
    expect(verdict.connSaturation).toBeNull();
  });

  it("too-many-clients still discriminates ap12a without a previous sample", () => {
    const verdict = derivePgHealthVerdict(makeRow({ too_many_clients_count: 42n }));
    expect(verdict.ap12Variant).toBe("ap12a");
  });
});

// getPgHealth needs a live nodemon DB with the 0003 tables applied (operator
// gate, Plan 15-01) — the export's existence is asserted; live coverage rides
// the Plan 15-09 canary.
describe("getPgHealth export", () => {
  it("is exported as an async reader function", () => {
    expect(typeof getPgHealth).toBe("function");
  });
});
