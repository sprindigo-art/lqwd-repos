// =====================================================
// D-14 — versioned READ-TIME threshold bands for host/chain telemetry
// =====================================================
// The collector stores RAW observed values ONLY (Plan 01): no `blocks_behind`,
// no severity, no stale flag is ever persisted. "What is bad" lives HERE and is
// applied at read time, so re-tuning a band NEVER requires re-ingesting history
// (D-14, threat T-11-07: frozen severity on rows). Mirrors the INSIGHT_CONFIG /
// SCORECARD_CONFIG posture — a typed config object consumed by a pure evaluator;
// thresholds live in config, never embedded in logic.
//
// Pure module: NO server runtime / DB imports — test-imported and safe anywhere.
//
// Boundary convention (deterministic): the boundary value belongs to the
// HEALTHIER band. higher-better → `value >= healthy` is healthy; higher-worse →
// `value <= healthy` is healthy. `warn` is the boundary separating warn from
// critical on the same side.
//
// Confidence annotations per band note: [CITED …] cites a library source;
// [ASSUMED] marks judgment-only starting values the operator retunes freely.

export type BandSeverity = "healthy" | "warn" | "critical";

/**
 * Whether a higher raw value is better (peers, disk-free %, verificationprogress,
 * mem-available %) or worse (blocks-behind, CPU % busy). Drives the comparison
 * direction in {@link evaluateBand}.
 */
export type BandDirection = "higher-better" | "higher-worse";

export interface TelemetryBand {
  direction: BandDirection;
  /**
   * Boundary at/above (higher-better) or at/below (higher-worse) which the signal
   * is healthy. The boundary value itself resolves to the healthier band.
   */
  healthy: number;
  /** Boundary separating warn from critical on the unhealthy side. */
  warn: number;
  /** Confidence + source annotation ([CITED …] / [ASSUMED]). */
  note: string;
}

// Signal keys are the read-time names the Plan-04/05 helpers pass to evaluateBand
// when attaching evidence. Re-tuning edits the numbers here — nothing re-ingests.
export const TELEMETRY_BANDS = {
  // Disk space % free. >=20% healthy, 10–20% warn, <10% critical.
  diskPctFree: {
    direction: "higher-better",
    healthy: 20,
    warn: 10,
    note: '[CITED: healthy-range-bands.md "Disk space % free >20%"] boundary belongs to healthier band.',
  },
  // bitcoind blocks behind tip (headers - blocks). 0–1 healthy, 2–6 warn, >6 critical.
  blocksBehind: {
    direction: "higher-worse",
    healthy: 1,
    warn: 6,
    note: "[ASSUMED] 1 block ≈ 10 min; >6 (~1h) behind is critical — operator to confirm.",
  },
  // bitcoind verificationprogress. >=0.9999 healthy, 0.999–0.9999 warn, <0.999 critical.
  // IBD is a separate boolean handled at read time (Plan 04) — this grades the float only.
  verificationProgress: {
    direction: "higher-better",
    healthy: 0.9999,
    warn: 0.999,
    note: "[ASSUMED] standard bitcoind sync floor; <0.999 or IBD is critical at read time.",
  },
  // bitcoind peer count. >=8 healthy, 3–7 warn, <3 critical.
  peers: {
    direction: "higher-better",
    healthy: 8,
    warn: 3,
    note: "[ASSUMED] default maxconnections sanity — operator may tune.",
  },
  // CPU % busy. <=70 healthy, 70–90 warn, >90 critical.
  cpuPctBusy: {
    direction: "higher-worse",
    healthy: 70,
    warn: 90,
    note: "[ASSUMED] generic saturation band — operator may tune.",
  },
  // Memory available %. >=15 healthy, 5–15 warn, <5 critical (OOM risk).
  memAvailablePct: {
    direction: "higher-better",
    healthy: 15,
    warn: 5,
    note: '[CITED: healthy-range-bands.md "OOM kills/month 0"] (related) — <5% available is OOM risk.',
  },

  // ── Phase 15 deep-VM + PG signals (COL-02/COL-03) — RAW in DB, banded here (D-14).
  // Key names are the cross-plan contract the Wave-2 readers (pg-health.ts /
  // host-metrics-ext.ts, Plans 04/05) import by; snake_case matches the plan spec.

  // CPU steal % (read-time % from raw /proc/stat jiffies). <=2 healthy, 2–10 warn,
  // >10 critical — the hypervisor noisy-neighbor signal.
  cpu_steal_pct: {
    direction: "higher-worse",
    healthy: 2,
    warn: 10,
    note: "[ASSUMED] noisy-neighbor steal band; % derived at read time from raw jiffies — operator may tune.",
  },
  // CPU iowait % (read-time % from raw jiffies). <=5 healthy, 5–20 warn, >20 critical.
  cpu_iowait_pct: {
    direction: "higher-worse",
    healthy: 5,
    warn: 20,
    note: "[ASSUMED] IO-pressure band; % derived at read time from raw jiffies — operator may tune.",
  },
  // TCP retransmit ratio = RetransSegs/OutSegs (raw counters clamped via
  // clampCounterDelta at read time). <=0.01 healthy, 0.01–0.05 warn, >0.05 critical.
  tcp_retransmit_rate: {
    direction: "higher-worse",
    healthy: 0.01,
    warn: 0.05,
    note: "[ASSUMED] retrans/out-seg ratio; >5% signals a badly degraded path — operator may tune.",
  },
  // PG connection saturation = active/max ratio. <0.8 healthy (RESEARCH: <80% of
  // max_connections), 0.8–0.95 warn, >0.95 critical (AP-12a exhaustion imminent).
  pg_conn_saturation: {
    direction: "higher-worse",
    healthy: 0.8,
    warn: 0.95,
    note: '[CITED: Healthy Range Bands.md "PG conn <80% of max_connections"; Operational Anti-Patterns.md AP-12a].',
  },
  // 40001 serialization-failure rate multiple = today ÷ baseline (baseline 400–800/day
  // is chronic-benign, BP-005). <10× healthy; ≥10× promotes straight to critical (AP-12b)
  // — no warn tier, the a/b promotion is a hard page. Boundary 10.0 itself grades
  // healthy per the module convention; the promotion is effectively >10×.
  pg_40001_rate_multiple: {
    direction: "higher-worse",
    healthy: 10,
    warn: 10,
    note: "[CITED: Known Benign Patterns.md BP-005; Healthy Range Bands.md 40001 400–800/day baseline, ≥10× = investigate/ap12].",
  },
  // OOM kills — HARD-ZERO band: 0 healthy, ANY >0 critical (warn tier unreachable).
  oom_kills: {
    direction: "higher-worse",
    healthy: 0,
    warn: 0,
    note: '[CITED: Healthy Range Bands.md "OOM kills/month = 0" (hard zero)].',
  },
  // EXT4 / IO errors — HARD-ZERO band: 0 healthy, ANY >0 critical.
  ext4_io_errors: {
    direction: "higher-worse",
    healthy: 0,
    warn: 0,
    note: '[CITED: Healthy Range Bands.md "EXT4/I/O errors/month = 0" (hard zero)].',
  },
  // systemd failed units. 0 healthy, 1 warn, >1 critical.
  failed_units: {
    direction: "higher-worse",
    healthy: 0,
    warn: 1,
    note: '[CITED: Healthy Range Bands.md "systemd Failed to start/month = 0"] — one failed unit warns, more page.',
  },
  // |clock offset| seconds (chronyc tracking; absolute value taken at read time).
  // <=0.05 healthy, 0.05–0.5 warn, >0.5 critical (gossip/HTLC timing risk).
  clock_offset_abs_seconds: {
    direction: "higher-worse",
    healthy: 0.05,
    warn: 0.5,
    note: "[ASSUMED] chrony offset band; >500ms skew endangers gossip/HTLC timing — operator may tune.",
  },
} as const satisfies Record<string, TelemetryBand>;

/**
 * Pure read-time evaluator: map a raw value to healthy/warn/critical for a band.
 * Same (value, band) → same severity (no clock, no DB, no stored state) so a
 * historical row is judged by the CURRENT config every time it is read (D-14).
 */
export function evaluateBand(value: number, band: TelemetryBand): BandSeverity {
  if (band.direction === "higher-better") {
    if (value >= band.healthy) return "healthy";
    if (value >= band.warn) return "warn";
    return "critical";
  }
  // higher-worse: lower values are healthier.
  if (value <= band.healthy) return "healthy";
  if (value <= band.warn) return "warn";
  return "critical";
}

// =====================================================
// D-13 — projected days-to-full is a FOUR-level ramp
// =====================================================
// A storage volume's time-to-full grades on FOUR rungs (critical/warning/watch/
// healthy), not the three the TelemetryBand machinery above can express — that
// machinery has no `watch` tier (Pitfall 2). So days-to-full carries its OWN
// read-time config + evaluator. The three thresholds live HERE, never inlined in a
// component (T-14-07 / D-13 / P11 D-14 / 12-10 lesson: no raw number in view logic).
//
// The returned literals ("critical" | "warning" | "watch" | "healthy") are ALREADY
// members of the df `Severity` ramp, so NO mapper is needed — keeping this evaluator
// in the config module preserves the "no component hardcodes a threshold" invariant.
//
// Fewer days is WORSE, so the boundary-belongs-to-the-healthier-band convention reads
// as: `days < critical` → critical; `< warning` → warning; `< watch` → watch; else
// healthy. A boundary value (7 / 30 / 90) clears UP into the healthier band.

/** D-13 read-time thresholds (in days). Re-tuning edits these numbers — nothing else. */
export const DAYS_TO_FULL_BANDS = { critical: 7, warning: 30, watch: 90 } as const;

/**
 * Grade a projected days-to-full onto the FOUR-level ramp per {@link DAYS_TO_FULL_BANDS}.
 * Pure: same `days` → same severity under the CURRENT config (D-13/D-14). Boundary
 * values clear into the healthier band. The returned literals are df `Severity`
 * members already — no mapper is applied downstream.
 */
export function evaluateDaysToFull(days: number): "critical" | "warning" | "watch" | "healthy" {
  if (days < DAYS_TO_FULL_BANDS.critical) return "critical";
  if (days < DAYS_TO_FULL_BANDS.warning) return "warning";
  if (days < DAYS_TO_FULL_BANDS.watch) return "watch";
  return "healthy";
}
