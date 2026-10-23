import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildLatestHostMetricsExtSql,
  buildLatestHostCpuCoreSql,
  buildLatestHostDiskIoSql,
  buildLatestHostNetIfaceSql,
  deriveHostMetricsExt,
  type HostMetricsExtSample,
  type LatestHostMetricsExtRow,
  type LatestHostCpuCoreRow,
  type LatestHostNetIfaceRow,
} from "@/lib/read/host-metrics-ext";
import type { SQL } from "drizzle-orm";

// =====================================================
// COL-03 host-metrics-ext helper-shape tests (NO DB)
// =====================================================
// Asserts the deep-VM latest reads emit DISTINCT ON the entity key
// (host_id / host_id, <dim>) ... ORDER BY key, collected_at DESC and NEVER
// MAX( — the AFM-001 480-read-as-1 failure. The child dimension key MUST
// appear inside DISTINCT ON *before* collected_at ordering so one row PER
// core/device/iface survives (Pitfall 4 — not collapsed to 1). hostId is
// parameter-bound ($1), never concatenated.

const dialect = new PgDialect();

function render(builder: (hostId: string) => SQL, hostId: string) {
  const built = dialect.sqlToQuery(builder(hostId));
  return { sql: built.sql.toLowerCase(), params: built.params };
}

describe("AFM-001 buildLatestHostMetricsExtSql SQL shape (scalar)", () => {
  it("emits DISTINCT ON (host_id)", () => {
    expect(render(buildLatestHostMetricsExtSql, "host-1").sql).toContain("distinct on (host_id)");
  });

  it("orders by host_id, collected_at DESC (latest-per-host)", () => {
    expect(render(buildLatestHostMetricsExtSql, "host-1").sql).toContain(
      "order by host_id, collected_at desc",
    );
  });

  it("never uses MAX( (the AFM-001 failure mode)", () => {
    expect(render(buildLatestHostMetricsExtSql, "host-1").sql).not.toContain("max(");
  });

  it("parameter-binds hostId ($1), never concatenated into the SQL text", () => {
    const evil = "'; DROP TABLE host_metrics_ext; --";
    const { sql, params } = render(buildLatestHostMetricsExtSql, evil);
    expect(sql).not.toContain("drop table");
    expect(params).toContain(evil);
    expect(sql).toContain("$1");
  });

  // PERF-01 mirror (T-18-15): the per-host DISTINCT ON scans that host's full
  // history — bound it with a UTC recency window so it is never a full-partition
  // scan. The host_id predicate is the single-entity bound; the window adds the
  // recency bound (offset-stable UTC idiom, never MAX()).
  it("bounds the DISTINCT ON with a UTC recency window (make_interval)", () => {
    const { sql } = render(buildLatestHostMetricsExtSql, "host-1");
    expect(sql).toContain("make_interval");
    expect(sql).toContain("at time zone 'utc'");
    expect(sql).toContain("collected_at >");
  });
});

// Each child builder: DISTINCT ON must include the dimension key, and the
// dimension key must come BEFORE collected_at in the ORDER BY (Pitfall 4).
const childCases = [
  {
    name: "buildLatestHostCpuCoreSql",
    builder: () => buildLatestHostCpuCoreSql,
    dim: "core_index",
    table: "host_cpu_core",
  },
  {
    name: "buildLatestHostDiskIoSql",
    builder: () => buildLatestHostDiskIoSql,
    dim: "device",
    table: "host_disk_io",
  },
  {
    name: "buildLatestHostNetIfaceSql",
    builder: () => buildLatestHostNetIfaceSql,
    dim: "iface",
    table: "host_net_iface",
  },
] as const;

describe.each(childCases)("AFM-001 $name SQL shape (child fact)", ({ builder, dim, table }) => {
  it(`emits DISTINCT ON (host_id, ${dim})`, () => {
    expect(render(builder(), "host-1").sql).toContain(`distinct on (host_id, ${dim})`);
  });

  it(`orders by host_id, ${dim}, collected_at DESC (dim key BEFORE collected_at)`, () => {
    expect(render(builder(), "host-1").sql).toContain(
      `order by host_id, ${dim}, collected_at desc`,
    );
  });

  it("reads the right table", () => {
    expect(render(builder(), "host-1").sql).toContain(`from ${table}`);
  });

  it("never uses MAX( (AFM-001)", () => {
    expect(render(builder(), "host-1").sql).not.toContain("max(");
  });

  it("parameter-binds hostId ($1)", () => {
    const { sql, params } = render(builder(), "host-1");
    expect(params).toContain("host-1");
    expect(sql).toContain("$1");
  });

  it("bounds the per-entity DISTINCT ON with a UTC recency window (T-18-15)", () => {
    const { sql } = render(builder(), "host-1");
    expect(sql).toContain("make_interval");
    expect(sql).toContain("at time zone 'utc'");
    expect(sql).toContain("collected_at >");
  });
});

// =====================================================
// deriveHostMetricsExt — PURE evaluator (D-14: rates + bands at read only)
// =====================================================
// Fixture-driven, no DB. Every cumulative counter goes through clampCounterDelta
// (Δ≥0, Pitfall 7 / T-15-08); severity attaches via evaluateBand from Plan 02's
// bands; gauges (failed units, clock offset) band directly.

function scalarRow(overrides: Partial<LatestHostMetricsExtRow> = {}): LatestHostMetricsExtRow {
  return {
    host_id: "host-1",
    collected_at: new Date(),
    ctxt: null,
    intr: null,
    cached_kb: null,
    buffers_kb: null,
    dirty_kb: null,
    writeback_kb: null,
    slab_kb: null,
    sreclaimable_kb: null,
    pgfault: null,
    pgmajfault: null,
    pswpin: null,
    pswpout: null,
    oom_kill: null,
    tcp_retrans_segs: null,
    tcp_out_segs: null,
    tcp_in_segs: null,
    tcp_active_opens: null,
    tcp_attempt_fails: null,
    sockets_total: null,
    tcp_estab: null,
    tcp_time_wait: null,
    fd_allocated: null,
    fd_max: null,
    procs_running: null,
    procs_blocked: null,
    failed_units_count: null,
    clock_offset_seconds: null,
    nproc: null,
    entropy_avail: null,
    btime: null,
    ...overrides,
  };
}

function coreRow(overrides: Partial<LatestHostCpuCoreRow> = {}): LatestHostCpuCoreRow {
  return {
    host_id: "host-1",
    collected_at: new Date(),
    core_index: 0,
    user_jiffies: 0n,
    nice_jiffies: 0n,
    system_jiffies: 0n,
    idle_jiffies: 0n,
    iowait_jiffies: 0n,
    irq_jiffies: 0n,
    softirq_jiffies: 0n,
    steal_jiffies: 0n,
    guest_jiffies: 0n,
    ...overrides,
  };
}

function ifaceRow(overrides: Partial<LatestHostNetIfaceRow> = {}): LatestHostNetIfaceRow {
  return {
    host_id: "host-1",
    collected_at: new Date(),
    iface: "eth0",
    rx_bytes: 0n,
    rx_errs: 0n,
    rx_drop: 0n,
    tx_bytes: 0n,
    tx_errs: 0n,
    tx_drop: 0n,
    tx_colls: 0n,
    ...overrides,
  };
}

function sample(overrides: Partial<HostMetricsExtSample> = {}): HostMetricsExtSample {
  return { scalar: null, cpuCores: [], disks: [], netIfaces: [], ...overrides };
}

describe("deriveHostMetricsExt — steal% band promotion (two-sample jiffies)", () => {
  // prev: total 1000 jiffies, steal 0. curr: +1000 total, +200 steal → 20% steal.
  const prev = sample({
    cpuCores: [coreRow({ user_jiffies: 500n, idle_jiffies: 500n, steal_jiffies: 0n })],
  });
  const curr = sample({
    cpuCores: [
      coreRow({ user_jiffies: 900n, idle_jiffies: 900n, steal_jiffies: 200n }),
    ],
  });

  it("promotes 20% steal to critical (Plan-02 cpu_steal_pct >10 ⇒ critical)", () => {
    const derived = deriveHostMetricsExt(curr, prev);
    const core = derived.cpuCores[0];
    expect(core?.stealPct?.value).toBeCloseTo(20, 5);
    expect(core?.stealPct?.band).toBe("critical");
  });

  it("grades 5% steal as warn (2 < 5 ≤ 10)", () => {
    const warnCurr = sample({
      cpuCores: [
        coreRow({ user_jiffies: 975n, idle_jiffies: 975n, steal_jiffies: 50n }),
      ],
    });
    const derived = deriveHostMetricsExt(warnCurr, prev);
    expect(derived.cpuCores[0]?.stealPct?.value).toBeCloseTo(5, 5);
    expect(derived.cpuCores[0]?.stealPct?.band).toBe("warn");
  });

  it("derives iowait% from raw jiffies and bands it (cpu_iowait_pct)", () => {
    const ioCurr = sample({
      cpuCores: [
        coreRow({ user_jiffies: 700n, idle_jiffies: 1000n, iowait_jiffies: 300n, steal_jiffies: 0n }),
      ],
    });
    const derived = deriveHostMetricsExt(ioCurr, prev);
    // Δiowait 300 / Δtotal 1000 = 30% → critical (>20).
    expect(derived.cpuCores[0]?.iowaitPct?.value).toBeCloseTo(30, 5);
    expect(derived.cpuCores[0]?.iowaitPct?.band).toBe("critical");
  });
});

describe("deriveHostMetricsExt — counter reset clamps to Δ≥0 (T-15-08)", () => {
  it("tcp retransmit rate stays non-negative when counters went backwards", () => {
    const prev = sample({
      scalar: scalarRow({ tcp_retrans_segs: 1000n, tcp_out_segs: 100000n }),
    });
    const curr = sample({
      scalar: scalarRow({ tcp_retrans_segs: 5n, tcp_out_segs: 500n }),
    });
    const derived = deriveHostMetricsExt(curr, prev);
    // clampCounterDelta: retrans Δ = 5 (reset baseline), out Δ = 500 → 0.01.
    expect(derived.tcpRetransmitRate).not.toBeNull();
    expect(derived.tcpRetransmitRate!.value).toBeGreaterThanOrEqual(0);
    expect(derived.tcpRetransmitRate!.value).toBeCloseTo(0.01, 5);
  });

  it("net errs delta is clamped (curr < prev → curr, never negative)", () => {
    const prev = sample({ netIfaces: [ifaceRow({ rx_errs: 500n })] });
    const curr = sample({ netIfaces: [ifaceRow({ rx_errs: 3n })] });
    const derived = deriveHostMetricsExt(curr, prev);
    expect(derived.netIfaces[0]?.rxErrsDelta).toBe(3);
  });

  it("oom_kill delta is clamped and banded hard-zero (any >0 ⇒ critical)", () => {
    const prev = sample({ scalar: scalarRow({ oom_kill: 2n }) });
    const curr = sample({ scalar: scalarRow({ oom_kill: 3n }) });
    const derived = deriveHostMetricsExt(curr, prev);
    expect(derived.oomKillsDelta?.value).toBe(1);
    expect(derived.oomKillsDelta?.band).toBe("critical");
  });
});

describe("deriveHostMetricsExt — null prior ⇒ honest no-rate (no-data)", () => {
  const curr = sample({
    scalar: scalarRow({
      tcp_retrans_segs: 10n,
      tcp_out_segs: 1000n,
      oom_kill: 0n,
      failed_units_count: 1,
      clock_offset_seconds: "-0.6",
    }),
    cpuCores: [coreRow({ user_jiffies: 100n, idle_jiffies: 900n })],
  });

  it("yields null rates for every counter-derived signal", () => {
    const derived = deriveHostMetricsExt(curr, null);
    expect(derived.tcpRetransmitRate).toBeNull();
    expect(derived.oomKillsDelta).toBeNull();
    expect(derived.cpuCores[0]?.stealPct).toBeNull();
    expect(derived.cpuCores[0]?.busyPct).toBeNull();
  });

  it("still bands gauges (failed units warn at 1; |clock offset| 0.6s critical)", () => {
    const derived = deriveHostMetricsExt(curr, null);
    expect(derived.failedUnits?.value).toBe(1);
    expect(derived.failedUnits?.band).toBe("warn");
    // Absolute value taken at read: -0.6 → 0.6 > 0.5 ⇒ critical.
    expect(derived.clockOffsetAbsSeconds?.value).toBeCloseTo(0.6, 5);
    expect(derived.clockOffsetAbsSeconds?.band).toBe("critical");
  });
});

describe("deriveHostMetricsExt — children stay per-entity (not collapsed)", () => {
  it("a 4-core fixture returns 4 host_cpu_core entries", () => {
    const cores = [0, 1, 2, 3].map((i) =>
      coreRow({ core_index: i, user_jiffies: 100n, idle_jiffies: 900n }),
    );
    const derived = deriveHostMetricsExt(sample({ cpuCores: cores }), null);
    expect(derived.cpuCores).toHaveLength(4);
    expect(derived.cpuCores.map((c) => c.coreIndex)).toEqual([0, 1, 2, 3]);
  });

  it("pairs prior child rows by entity key, not by array position", () => {
    const prev = sample({
      cpuCores: [
        coreRow({ core_index: 1, user_jiffies: 0n, idle_jiffies: 1000n }),
        coreRow({ core_index: 0, user_jiffies: 500n, idle_jiffies: 500n, steal_jiffies: 0n }),
      ],
    });
    const curr = sample({
      cpuCores: [
        coreRow({ core_index: 0, user_jiffies: 900n, idle_jiffies: 900n, steal_jiffies: 200n }),
        coreRow({ core_index: 1, user_jiffies: 0n, idle_jiffies: 2000n }),
      ],
    });
    const derived = deriveHostMetricsExt(curr, prev);
    const core0 = derived.cpuCores.find((c) => c.coreIndex === 0);
    const core1 = derived.cpuCores.find((c) => c.coreIndex === 1);
    // core 0 matched against ITS prior (steal 20% → critical), core 1 idle-only.
    expect(core0?.stealPct?.band).toBe("critical");
    expect(core1?.stealPct?.value).toBe(0);
  });
});
