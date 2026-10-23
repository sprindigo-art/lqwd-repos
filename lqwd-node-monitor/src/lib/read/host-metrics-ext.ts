import { sql, type SQL } from "drizzle-orm";
import { clampCounterDelta } from "@/lib/read/counter-delta";
import { TELEMETRY_BANDS, evaluateBand, type BandSeverity } from "@/lib/read/telemetry-bands";
import { deriveStale } from "@/lib/read/host-metrics";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// =====================================================
// COL-03 — AFM-001 latest deep-VM metrics (host_metrics_ext + child facts)
// =====================================================
// `host_metrics_ext`, `host_cpu_core`, `host_disk_io` and `host_net_iface` are
// APPEND-HISTORY fact tables (Plan 15-01): every collector tick emits a new row
// per host (and per core/device/iface for the children). The latest state of
// each entity is its NEWEST row PER entity key.
//
//   ✅  SELECT DISTINCT ON (<entity key>) ... ORDER BY <entity key>, collected_at DESC
//   ❌  WHERE collected_at = (SELECT MAX(collected_at) ...)  ← AFM-001 480-as-1 failure
//
// Child facts key on (host_id, <dim>) — the dimension key sits INSIDE the
// DISTINCT ON and BEFORE collected_at in the ORDER BY so one row PER core /
// device / iface survives (Pitfall 4 — never collapsed to 1 per host).
//
// `host_id` is ALWAYS parameter-bound via the Drizzle `sql` template, never
// string-concatenated (SQL-injection mitigation, T-15-01). Reads use the RW
// `dbNodemon` client via lazy import (same posture as host-metrics.ts).
//
// The DB stores RAW cumulative counters and raw jiffies ONLY (D-06b/D-14): no
// severity, no rate, no stale flag is ever read from a row. Rates go through
// the shared clampCounterDelta (Δ≥0, Pitfall 7 / T-15-08) and bands attach at
// read time via evaluateBand — all in the PURE deriveHostMetricsExt evaluator.

/** Latest scalar row shape from `host_metrics_ext` (raw-execute column names). */
export interface LatestHostMetricsExtRow {
  host_id: string;
  collected_at: Date | string | null;
  ctxt: bigint | number | null;
  intr: bigint | number | null;
  cached_kb: bigint | number | null;
  buffers_kb: bigint | number | null;
  dirty_kb: bigint | number | null;
  writeback_kb: bigint | number | null;
  slab_kb: bigint | number | null;
  sreclaimable_kb: bigint | number | null;
  pgfault: bigint | number | null;
  pgmajfault: bigint | number | null;
  pswpin: bigint | number | null;
  pswpout: bigint | number | null;
  oom_kill: bigint | number | null;
  tcp_retrans_segs: bigint | number | null;
  tcp_out_segs: bigint | number | null;
  tcp_in_segs: bigint | number | null;
  tcp_active_opens: bigint | number | null;
  tcp_attempt_fails: bigint | number | null;
  sockets_total: number | null;
  tcp_estab: number | null;
  tcp_time_wait: number | null;
  fd_allocated: bigint | number | null;
  fd_max: bigint | number | null;
  procs_running: number | null;
  procs_blocked: number | null;
  failed_units_count: number | null;
  clock_offset_seconds: string | number | null;
  nproc: number | null;
  entropy_avail: number | null;
  btime: bigint | number | null;
}

/** Latest-per-core row shape from `host_cpu_core` (key = core_index). */
export interface LatestHostCpuCoreRow {
  host_id: string;
  collected_at: Date | string | null;
  core_index: number | null;
  user_jiffies: bigint | number | null;
  nice_jiffies: bigint | number | null;
  system_jiffies: bigint | number | null;
  idle_jiffies: bigint | number | null;
  iowait_jiffies: bigint | number | null;
  irq_jiffies: bigint | number | null;
  softirq_jiffies: bigint | number | null;
  steal_jiffies: bigint | number | null;
  guest_jiffies: bigint | number | null;
}

/** Latest-per-device row shape from `host_disk_io` (key = device). */
export interface LatestHostDiskIoRow {
  host_id: string;
  collected_at: Date | string | null;
  device: string | null;
  reads_completed: bigint | number | null;
  sectors_read: bigint | number | null;
  writes_completed: bigint | number | null;
  sectors_written: bigint | number | null;
  ios_in_progress: bigint | number | null;
  ms_doing_io: bigint | number | null;
}

// PERF-01 recency bound (T-18-15). Each per-host DISTINCT ON / ROW_NUMBER scans
// that host's ENTIRE deep-VM history. Bounding to the last 30 days (tied by value
// to STALENESS_CUTOFF_DAYS) keeps the scan off the full partition; the host_id
// predicate is the single-entity bound, this adds the recency bound. The prior
// (rn=2) sample sits ~one collector tick before the latest, well inside the window.
const HOST_METRICS_EXT_WINDOW_DAYS = 30;

/** The offset-stable UTC recency predicate shared by every builder below. */
const recencyWindow = sql`collected_at > (now() AT TIME ZONE 'UTC') - make_interval(days => ${HOST_METRICS_EXT_WINDOW_DAYS})`;

/** Latest-per-iface row shape from `host_net_iface` (key = iface). */
export interface LatestHostNetIfaceRow {
  host_id: string;
  collected_at: Date | string | null;
  iface: string | null;
  rx_bytes: bigint | number | null;
  rx_errs: bigint | number | null;
  rx_drop: bigint | number | null;
  tx_bytes: bigint | number | null;
  tx_errs: bigint | number | null;
  tx_drop: bigint | number | null;
  tx_colls: bigint | number | null;
}

/**
 * Build the AFM-001 DISTINCT ON (host_id) latest deep-VM scalar fragment for
 * one host. Exposed so the no-DB shape test asserts the emitted SQL without a
 * live nodemon connection. `hostId` is bound ($1), never interpolated.
 */
export function buildLatestHostMetricsExtSql(hostId: string): SQL {
  // `host_id IS NOT NULL` keeps every real host distinct under DISTINCT ON even
  // if a keyless row is ever emitted (AFM-001 key-dimension guard).
  return sql`
    SELECT DISTINCT ON (host_id) *
    FROM host_metrics_ext
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
      AND ${recencyWindow}
    ORDER BY host_id, collected_at DESC
  `;
}

/**
 * Latest-per-core jiffies for one host. Entity key is (host_id, core_index) —
 * the core dimension sits inside DISTINCT ON and before collected_at in the
 * ORDER BY so one row PER core survives (Pitfall 4).
 */
export function buildLatestHostCpuCoreSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id, core_index) *
    FROM host_cpu_core
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
      AND ${recencyWindow}
    ORDER BY host_id, core_index, collected_at DESC
  `;
}

/** Latest-per-device /proc/diskstats counters (entity key = host_id, device). */
export function buildLatestHostDiskIoSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id, device) *
    FROM host_disk_io
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
      AND ${recencyWindow}
    ORDER BY host_id, device, collected_at DESC
  `;
}

/** Latest-per-iface /proc/net/dev counters (entity key = host_id, iface). */
export function buildLatestHostNetIfaceSql(hostId: string): SQL {
  return sql`
    SELECT DISTINCT ON (host_id, iface) *
    FROM host_net_iface
    WHERE host_id = ${hostId}
      AND host_id IS NOT NULL
      AND ${recencyWindow}
    ORDER BY host_id, iface, collected_at DESC
  `;
}

// -----------------------------------------------------
// Prior-sample builders (rank 2 per entity) — feed the counter Δ derivation.
// ROW_NUMBER (not MAX() — AFM-001) ranks each entity's history newest-first;
// rn = 2 is the sample immediately BEFORE the latest one. hostId stays bound.
// -----------------------------------------------------

function buildPriorHostMetricsExtSql(hostId: string): SQL {
  return sql`
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY host_id ORDER BY collected_at DESC) AS rn
      FROM host_metrics_ext
      WHERE host_id = ${hostId}
        AND host_id IS NOT NULL
        AND ${recencyWindow}
    ) ranked WHERE rn = 2
  `;
}

function buildPriorHostCpuCoreSql(hostId: string): SQL {
  return sql`
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY host_id, core_index ORDER BY collected_at DESC) AS rn
      FROM host_cpu_core
      WHERE host_id = ${hostId}
        AND host_id IS NOT NULL
        AND ${recencyWindow}
    ) ranked WHERE rn = 2
  `;
}

function buildPriorHostDiskIoSql(hostId: string): SQL {
  return sql`
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY host_id, device ORDER BY collected_at DESC) AS rn
      FROM host_disk_io
      WHERE host_id = ${hostId}
        AND host_id IS NOT NULL
        AND ${recencyWindow}
    ) ranked WHERE rn = 2
  `;
}

function buildPriorHostNetIfaceSql(hostId: string): SQL {
  return sql`
    SELECT * FROM (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY host_id, iface ORDER BY collected_at DESC) AS rn
      FROM host_net_iface
      WHERE host_id = ${hostId}
        AND host_id IS NOT NULL
        AND ${recencyWindow}
    ) ranked WHERE rn = 2
  `;
}

// =====================================================
// PURE derivation — deriveHostMetricsExt (D-14: rates + bands at read only)
// =====================================================

/** One sample (latest OR prior) of the deep-VM facts for a single host. */
export interface HostMetricsExtSample {
  scalar: LatestHostMetricsExtRow | null;
  cpuCores: LatestHostCpuCoreRow[];
  disks: LatestHostDiskIoRow[];
  netIfaces: LatestHostNetIfaceRow[];
}

/** A read-time derived value with its D-14 band attached. */
export interface BandedValue {
  value: number;
  band: BandSeverity;
}

/** Per-core derived view: busy/steal/iowait % from raw jiffy deltas. */
export interface DerivedCpuCore {
  coreIndex: number | null;
  /** Δbusy/Δtotal × 100, or null when no prior sample exists. */
  busyPct: number | null;
  stealPct: BandedValue | null;
  iowaitPct: BandedValue | null;
}

/** Per-device derived view: Δ≥0 counters (sector = 512 B). */
export interface DerivedDiskIo {
  device: string | null;
  readsCompletedDelta: number | null;
  writesCompletedDelta: number | null;
  readBytesDelta: number | null;
  writeBytesDelta: number | null;
  msDoingIoDelta: number | null;
}

/** Per-iface derived view: Δ≥0 counters. */
export interface DerivedNetIface {
  iface: string | null;
  rxBytesDelta: number | null;
  txBytesDelta: number | null;
  rxErrsDelta: number | null;
  txErrsDelta: number | null;
  rxDropDelta: number | null;
  txDropDelta: number | null;
}

/** Read-time derived deep-VM view (nothing here is ever stored — D-14). */
export interface DerivedHostMetricsExt {
  cpuCores: DerivedCpuCore[];
  disks: DerivedDiskIo[];
  netIfaces: DerivedNetIface[];
  /** RetransSegs Δ ÷ OutSegs Δ, banded via tcp_retransmit_rate. */
  tcpRetransmitRate: BandedValue | null;
  /** oom_kill counter Δ, banded hard-zero via oom_kills. */
  oomKillsDelta: BandedValue | null;
  /** Gauge — banded directly via failed_units. */
  failedUnits: BandedValue | null;
  /** Gauge — |offset| seconds, banded via clock_offset_abs_seconds. */
  clockOffsetAbsSeconds: BandedValue | null;
}

type Counter = bigint | number | null | undefined;

/** clampCounterDelta wrapper tolerant of a missing CURRENT value. */
function clampOpt(prev: Counter, curr: Counter): number | null {
  if (curr === null || curr === undefined) return null;
  return clampCounterDelta(prev, curr);
}

/** Sum a set of jiffy counters (null treated as 0) into a plain number. */
function jiffySum(row: LatestHostCpuCoreRow | undefined, keys: (keyof LatestHostCpuCoreRow)[]) {
  if (!row) return undefined;
  let sum = 0;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "bigint") sum += Number(v);
    else if (typeof v === "number") sum += v;
  }
  return sum;
}

const BUSY_JIFFIES: (keyof LatestHostCpuCoreRow)[] = [
  "user_jiffies",
  "nice_jiffies",
  "system_jiffies",
  "irq_jiffies",
  "softirq_jiffies",
  "steal_jiffies",
  "guest_jiffies",
];
const ALL_JIFFIES: (keyof LatestHostCpuCoreRow)[] = [
  ...BUSY_JIFFIES,
  "idle_jiffies",
  "iowait_jiffies",
];

function banded(value: number | null, band: keyof typeof TELEMETRY_BANDS): BandedValue | null {
  if (value == null || Number.isNaN(value)) return null;
  return { value, band: evaluateBand(value, TELEMETRY_BANDS[band]) };
}

function deriveCpuCore(
  curr: LatestHostCpuCoreRow,
  prev: LatestHostCpuCoreRow | undefined,
): DerivedCpuCore {
  const totalDelta = clampOpt(jiffySum(prev, ALL_JIFFIES), jiffySum(curr, ALL_JIFFIES));
  const busyDelta = clampOpt(jiffySum(prev, BUSY_JIFFIES), jiffySum(curr, BUSY_JIFFIES));
  const stealDelta = clampOpt(prev?.steal_jiffies, curr.steal_jiffies);
  const iowaitDelta = clampOpt(prev?.iowait_jiffies, curr.iowait_jiffies);

  // Δ/Δtotal × 100; a zero/absent total window yields honest null, never NaN.
  const pct = (delta: number | null) =>
    delta == null || totalDelta == null || totalDelta === 0 ? null : (delta / totalDelta) * 100;

  return {
    coreIndex: curr.core_index,
    busyPct: pct(busyDelta),
    stealPct: banded(pct(stealDelta), "cpu_steal_pct"),
    iowaitPct: banded(pct(iowaitDelta), "cpu_iowait_pct"),
  };
}

/** Pair prior child rows by ENTITY key (never array position). */
function byKey<T>(rows: T[], key: (r: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return m;
}

/**
 * PURE read-time evaluator (template: buildChainEvidence). Turns two RAW
 * samples into Δ≥0 rates (every cumulative counter via clampCounterDelta —
 * NEVER a raw subtraction, T-15-08) and attaches Plan-02 bands (D-14). Gauges
 * (failed units, clock offset) band directly off the current sample. A null
 * `previous` yields null for every counter-derived signal (honest no-rate).
 * NO DB imports — unit-tested directly against fixtures.
 */
export function deriveHostMetricsExt(
  current: HostMetricsExtSample,
  previous: HostMetricsExtSample | null,
): DerivedHostMetricsExt {
  const prevCores = byKey(previous?.cpuCores ?? [], (r) => String(r.core_index));
  const prevDisks = byKey(previous?.disks ?? [], (r) => String(r.device));
  const prevIfaces = byKey(previous?.netIfaces ?? [], (r) => String(r.iface));

  const cpuCores = current.cpuCores.map((c) =>
    deriveCpuCore(c, prevCores.get(String(c.core_index))),
  );

  const disks: DerivedDiskIo[] = current.disks.map((d) => {
    const p = prevDisks.get(String(d.device));
    const sectorsRead = clampOpt(p?.sectors_read, d.sectors_read);
    const sectorsWritten = clampOpt(p?.sectors_written, d.sectors_written);
    return {
      device: d.device,
      readsCompletedDelta: clampOpt(p?.reads_completed, d.reads_completed),
      writesCompletedDelta: clampOpt(p?.writes_completed, d.writes_completed),
      // /proc/diskstats sectors are fixed 512-byte units regardless of device.
      readBytesDelta: sectorsRead == null ? null : sectorsRead * 512,
      writeBytesDelta: sectorsWritten == null ? null : sectorsWritten * 512,
      msDoingIoDelta: clampOpt(p?.ms_doing_io, d.ms_doing_io),
    };
  });

  const netIfaces: DerivedNetIface[] = current.netIfaces.map((n) => {
    const p = prevIfaces.get(String(n.iface));
    return {
      iface: n.iface,
      rxBytesDelta: clampOpt(p?.rx_bytes, n.rx_bytes),
      txBytesDelta: clampOpt(p?.tx_bytes, n.tx_bytes),
      rxErrsDelta: clampOpt(p?.rx_errs, n.rx_errs),
      txErrsDelta: clampOpt(p?.tx_errs, n.tx_errs),
      rxDropDelta: clampOpt(p?.rx_drop, n.rx_drop),
      txDropDelta: clampOpt(p?.tx_drop, n.tx_drop),
    };
  });

  const s = current.scalar;
  const ps = previous?.scalar ?? null;

  // TCP retransmit ratio = ΔRetransSegs ÷ ΔOutSegs (both clamped Δ≥0).
  const retransDelta = s ? clampOpt(ps?.tcp_retrans_segs, s.tcp_retrans_segs) : null;
  const outDelta = s ? clampOpt(ps?.tcp_out_segs, s.tcp_out_segs) : null;
  const retransRate =
    retransDelta == null || outDelta == null || outDelta === 0 ? null : retransDelta / outDelta;

  const oomDelta = s ? clampOpt(ps?.oom_kill, s.oom_kill) : null;

  const failedUnitsCount = s?.failed_units_count ?? null;

  const clockRaw = s?.clock_offset_seconds;
  const clockAbs = clockRaw == null ? null : Math.abs(Number(clockRaw));

  return {
    cpuCores,
    disks,
    netIfaces,
    tcpRetransmitRate: banded(retransRate, "tcp_retransmit_rate"),
    oomKillsDelta: banded(oomDelta, "oom_kills"),
    failedUnits: banded(failedUnitsCount, "failed_units"),
    clockOffsetAbsSeconds: banded(clockAbs, "clock_offset_abs_seconds"),
  };
}

// =====================================================
// getHostMetricsExt — latest + prior samples → serializable deep-VM view
// =====================================================

/** Serializable per-host deep-VM view for VmVitals / host detail (Plan 08). */
export interface HostMetricsExtView {
  hostId: string;
  /** Latest scalar collected_at (falls back to newest child stamp). */
  asOf: Date | null;
  /** Read-time D-13 derivation; true when no fact row exists (no-data). */
  stale: boolean;
  hasData: boolean;
  scalar: LatestHostMetricsExtRow | null;
  cpuCores: LatestHostCpuCoreRow[];
  disks: LatestHostDiskIoRow[];
  netIfaces: LatestHostNetIfaceRow[];
  derived: DerivedHostMetricsExt;
}

/**
 * Latest deep-VM metrics for one host: latest-per-entity via DISTINCT ON
 * (AFM-001), prior sample via ROW_NUMBER rank 2 for Δ≥0 counter rates, bands
 * attached at read (D-14). Reads the RW `dbNodemon` client.
 */
export async function getHostMetricsExt(hostId: string): Promise<HostMetricsExtView> {
  // Lazy import keeps the server-only `dbNodemon` client (postgres() pool +
  // requireEnv at module load) out of the no-DB shape test's import graph.
  const { dbNodemon } = await import("@/lib/db/nodemon");

  const [scalarRows, coreRows, diskRows, ifaceRows, pScalarRows, pCoreRows, pDiskRows, pIfaceRows] =
    (await Promise.all([
      dbNodemon.execute(buildLatestHostMetricsExtSql(hostId)),
      dbNodemon.execute(buildLatestHostCpuCoreSql(hostId)),
      dbNodemon.execute(buildLatestHostDiskIoSql(hostId)),
      dbNodemon.execute(buildLatestHostNetIfaceSql(hostId)),
      dbNodemon.execute(buildPriorHostMetricsExtSql(hostId)),
      dbNodemon.execute(buildPriorHostCpuCoreSql(hostId)),
      dbNodemon.execute(buildPriorHostDiskIoSql(hostId)),
      dbNodemon.execute(buildPriorHostNetIfaceSql(hostId)),
    ])) as unknown as [
      LatestHostMetricsExtRow[],
      LatestHostCpuCoreRow[],
      LatestHostDiskIoRow[],
      LatestHostNetIfaceRow[],
      LatestHostMetricsExtRow[],
      LatestHostCpuCoreRow[],
      LatestHostDiskIoRow[],
      LatestHostNetIfaceRow[],
    ];

  const scalar = scalarRows[0] ?? null;
  const current: HostMetricsExtSample = {
    scalar,
    cpuCores: coreRows,
    disks: diskRows,
    netIfaces: ifaceRows,
  };
  const hasPrior =
    pScalarRows.length > 0 || pCoreRows.length > 0 || pDiskRows.length > 0 || pIfaceRows.length > 0;
  const previous: HostMetricsExtSample | null = hasPrior
    ? {
        scalar: pScalarRows[0] ?? null,
        cpuCores: pCoreRows,
        disks: pDiskRows,
        netIfaces: pIfaceRows,
      }
    : null;

  const asOf =
    parseDbTimestampUtc((scalar?.collected_at ?? null) as Date | string | null) ??
    parseDbTimestampUtc(
      (coreRows[0]?.collected_at ??
        diskRows[0]?.collected_at ??
        ifaceRows[0]?.collected_at ??
        null) as Date | string | null,
    );
  const hasData =
    scalar != null || coreRows.length > 0 || diskRows.length > 0 || ifaceRows.length > 0;

  return {
    hostId,
    asOf,
    stale: deriveStale(asOf),
    hasData,
    scalar,
    cpuCores: coreRows,
    disks: diskRows,
    netIfaces: ifaceRows,
    derived: deriveHostMetricsExt(current, previous),
  };
}
