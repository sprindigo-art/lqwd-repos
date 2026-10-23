import { describe, it, expect } from "vitest";
import {
  TELEMETRY_BANDS,
  evaluateBand,
  DAYS_TO_FULL_BANDS,
  evaluateDaysToFull,
  type TelemetryBand,
} from "@/lib/read/telemetry-bands";

// D-14 — thresholds live in a versioned read-time config, NEVER on stored rows.
// `evaluateBand` is pure: same (value, band) → same severity, no clock, no DB.
// Convention under test: the BOUNDARY value belongs to the HEALTHIER band
// (higher-better → `>=` healthy; higher-worse → `<=` healthy). Each signal tests
// its three regions PLUS the exact edges (boundary determinism).

// [value, expectedSeverity, note]
type Case = [number, "healthy" | "warn" | "critical", string];

const SIGNAL_CASES: Record<keyof typeof TELEMETRY_BANDS, Case[]> = {
  // Disk % free — >20 healthy / 10–20 warn / <10 critical [CITED healthy-range-bands.md]
  diskPctFree: [
    [25, "healthy", "well above 20% free"],
    [20, "healthy", "edge: 20% free is healthy"],
    [19.99, "warn", "just below the healthy edge"],
    [15, "warn", "mid warn band"],
    [10, "warn", "edge: 10% free still warn"],
    [9.99, "critical", "just below warn edge"],
    [2, "critical", "near-full disk"],
  ],
  // bitcoind blocks-behind-tip — 0–1 healthy / 2–6 warn / >6 critical [ASSUMED]
  blocksBehind: [
    [0, "healthy", "at tip"],
    [1, "healthy", "edge: 1 block behind healthy"],
    [2, "warn", "entering warn"],
    [6, "warn", "edge: 6 blocks behind still warn"],
    [7, "critical", "more than ~1h behind"],
  ],
  // verificationprogress — >=0.9999 healthy / 0.999–0.9999 warn / <0.999 critical [ASSUMED]
  verificationProgress: [
    [1, "healthy", "fully synced"],
    [0.9999, "healthy", "edge: at the healthy floor"],
    [0.99989, "warn", "just under healthy"],
    [0.999, "warn", "edge: at the warn floor"],
    [0.9989, "critical", "IBD / far behind"],
  ],
  // bitcoind peers — >=8 healthy / 3–7 warn / <3 critical [ASSUMED]
  peers: [
    [10, "healthy", "well connected"],
    [8, "healthy", "edge: 8 peers healthy"],
    [7, "warn", "below healthy floor"],
    [3, "warn", "edge: 3 peers still warn"],
    [2, "critical", "nearly isolated"],
  ],
  // CPU % busy — <70 healthy / 70–90 warn / >90 critical [ASSUMED]
  cpuPctBusy: [
    [50, "healthy", "idle-ish"],
    [70, "healthy", "edge: 70% busy still healthy"],
    [80, "warn", "elevated"],
    [90, "warn", "edge: 90% busy still warn"],
    [91, "critical", "saturated CPU"],
  ],
  // mem-available % — >15 healthy / 5–15 warn / <5 critical [CITED-related]
  memAvailablePct: [
    [30, "healthy", "plenty free"],
    [15, "healthy", "edge: 15% available healthy"],
    [10, "warn", "tightening"],
    [5, "warn", "edge: 5% available still warn"],
    [4, "critical", "OOM risk"],
  ],
  // ── Phase 15 deep-VM + PG bands (COL-02/COL-03, D-14: RAW in DB, bands here) ──
  // CPU steal % — <=2 healthy / 2–10 warn / >10 critical (noisy-neighbor signal)
  cpu_steal_pct: [
    [1, "healthy", "negligible hypervisor steal"],
    [2, "healthy", "edge: 2% steal still healthy"],
    [5, "warn", "noisy neighbor emerging"],
    [10, "warn", "edge: 10% steal still warn"],
    [30, "critical", "severe noisy-neighbor contention"],
  ],
  // CPU iowait % — <=5 healthy / 5–20 warn / >20 critical
  cpu_iowait_pct: [
    [3, "healthy", "normal IO wait"],
    [5, "healthy", "edge: 5% iowait still healthy"],
    [12, "warn", "elevated IO pressure"],
    [20, "warn", "edge: 20% iowait still warn"],
    [21, "critical", "IO-bound host"],
  ],
  // TCP retransmit ratio (RetransSegs/OutSegs) — <=0.01 healthy / 0.01–0.05 warn / >0.05 critical
  tcp_retransmit_rate: [
    [0.001, "healthy", "clean network path"],
    [0.01, "healthy", "edge: 1% retransmits still healthy"],
    [0.03, "warn", "lossy path"],
    [0.05, "warn", "edge: 5% retransmits still warn"],
    [0.08, "critical", "badly degraded network"],
  ],
  // PG connection saturation (active/max ratio) — <0.8 healthy / 0.8–0.95 warn / >0.95 critical
  pg_conn_saturation: [
    [0.5, "healthy", "plenty of connection headroom"],
    [0.79, "healthy", "just under the 80% RESEARCH threshold"],
    [0.85, "warn", "approaching AP-12a exhaustion"],
    [0.95, "warn", "edge: 95% still warn"],
    [0.97, "critical", "connection exhaustion imminent (AP-12a)"],
  ],
  // 40001 rate multiple (today ÷ baseline) — <10 healthy / ≥10× ⇒ critical (BP-005 / AP-12b)
  pg_40001_rate_multiple: [
    [1, "healthy", "baseline 40001 load (BP-005 chronic-benign)"],
    [9, "healthy", "below the 10× promotion"],
    [10.01, "critical", "just past the 10× AP-12b promotion"],
    [12, "critical", "BP-005 ≥10× promotion to ap12"],
    [30, "critical", "serialization storm"],
  ],
  // OOM kills — hard-zero band: 0 healthy, ANY >0 critical
  oom_kills: [
    [0, "healthy", "hard-zero: no OOM kills"],
    [1, "critical", "any OOM kill is critical"],
    [5, "critical", "repeated OOM kills"],
  ],
  // EXT4/IO errors — hard-zero band: 0 healthy, ANY >0 critical
  ext4_io_errors: [
    [0, "healthy", "hard-zero: no filesystem errors"],
    [1, "critical", "any EXT4/IO error is critical"],
  ],
  // systemd failed units — 0 healthy / 1 warn / >1 critical
  failed_units: [
    [0, "healthy", "no failed units"],
    [1, "warn", "single failed unit"],
    [2, "critical", "multiple failed units"],
  ],
  // |clock offset| seconds — <=0.05 healthy / 0.05–0.5 warn / >0.5 critical
  clock_offset_abs_seconds: [
    [0.01, "healthy", "tight NTP sync"],
    [0.05, "healthy", "edge: 50ms offset still healthy"],
    [0.2, "warn", "drifting clock"],
    [0.5, "warn", "edge: 500ms still warn"],
    [0.6, "critical", "clock skew endangers gossip/HTLC timing"],
  ],
};

describe("evaluateBand — per-signal regions + exact boundaries (D-14)", () => {
  for (const signal of Object.keys(SIGNAL_CASES) as (keyof typeof TELEMETRY_BANDS)[]) {
    const band = TELEMETRY_BANDS[signal];
    describe(signal, () => {
      for (const [value, expected, note] of SIGNAL_CASES[signal]) {
        it(`${value} → ${expected} (${note})`, () => {
          expect(evaluateBand(value, band)).toBe(expected);
        });
      }
    });
  }
});

describe("TELEMETRY_BANDS config shape (D-14 tuning surface)", () => {
  it("exposes every documented signal", () => {
    expect(Object.keys(TELEMETRY_BANDS).sort()).toEqual(
      [
        "blocksBehind",
        "cpuPctBusy",
        "diskPctFree",
        "memAvailablePct",
        "peers",
        "verificationProgress",
        // Phase 15 deep-VM + PG signals (COL-02/COL-03)
        "cpu_steal_pct",
        "cpu_iowait_pct",
        "tcp_retransmit_rate",
        "pg_conn_saturation",
        "pg_40001_rate_multiple",
        "oom_kills",
        "ext4_io_errors",
        "failed_units",
        "clock_offset_abs_seconds",
      ].sort(),
    );
  });

  it("encodes a direction per band (higher-better vs higher-worse)", () => {
    expect(TELEMETRY_BANDS.diskPctFree.direction).toBe("higher-better");
    expect(TELEMETRY_BANDS.peers.direction).toBe("higher-better");
    expect(TELEMETRY_BANDS.verificationProgress.direction).toBe("higher-better");
    expect(TELEMETRY_BANDS.memAvailablePct.direction).toBe("higher-better");
    expect(TELEMETRY_BANDS.blocksBehind.direction).toBe("higher-worse");
    expect(TELEMETRY_BANDS.cpuPctBusy.direction).toBe("higher-worse");
    // Every Phase-15 signal reads higher-worse (steal, iowait, retransmits,
    // saturation, rate-multiple, error/kill counts, |clock offset|).
    for (const key of [
      "cpu_steal_pct",
      "cpu_iowait_pct",
      "tcp_retransmit_rate",
      "pg_conn_saturation",
      "pg_40001_rate_multiple",
      "oom_kills",
      "ext4_io_errors",
      "failed_units",
      "clock_offset_abs_seconds",
    ] as const) {
      expect(TELEMETRY_BANDS[key].direction).toBe("higher-worse");
    }
  });

  it("hard-zero bands: ANY nonzero OOM kill or EXT4 error is critical, never warn", () => {
    expect(evaluateBand(0, TELEMETRY_BANDS.oom_kills)).toBe("healthy");
    expect(evaluateBand(1, TELEMETRY_BANDS.oom_kills)).toBe("critical");
    expect(evaluateBand(0, TELEMETRY_BANDS.ext4_io_errors)).toBe("healthy");
    expect(evaluateBand(1, TELEMETRY_BANDS.ext4_io_errors)).toBe("critical");
  });

  it("40001 ≥10× promotes straight to critical — the AP-12b promotion (BP-005)", () => {
    expect(evaluateBand(12, TELEMETRY_BANDS.pg_40001_rate_multiple)).toBe("critical");
    expect(evaluateBand(1, TELEMETRY_BANDS.pg_40001_rate_multiple)).toBe("healthy");
  });

  it("carries a confidence annotation on every band note", () => {
    for (const band of Object.values(TELEMETRY_BANDS) as TelemetryBand[]) {
      expect(band.note).toMatch(/\[CITED|\[ASSUMED/);
    }
  });

  it("cites healthy-range-bands.md for the disk band", () => {
    expect(TELEMETRY_BANDS.diskPctFree.note).toContain("healthy-range-bands.md");
  });
});

// D-13 — projected days-to-full is a FOUR-level ramp (critical/warning/watch/healthy).
// The 3-level TelemetryBand/evaluateBand machinery has no `watch` tier and cannot
// express this — days-to-full has its own config + evaluator. Same boundary
// convention: the boundary value belongs to the HEALTHIER band (fewer days is worse,
// so `days < threshold` grades into the unhealthier band; `days >= threshold` clears
// into the healthier one). Thresholds live ONLY in DAYS_TO_FULL_BANDS (T-14-07:
// no component may import a raw number).
describe("evaluateDaysToFull — D-13 four-level ramp + exact boundaries", () => {
  // [days, expectedSeverity, note]
  const CASES: Array<[number, "critical" | "warning" | "watch" | "healthy", string]> = [
    [0, "critical", "already full / imminent"],
    [6.9, "critical", "just under the 7-day critical edge"],
    [7, "warning", "edge: 7 days clears critical into warning"],
    [29.9, "warning", "mid warning band"],
    [30, "watch", "edge: 30 days clears warning into watch"],
    [89.9, "watch", "just under the 90-day watch edge"],
    [90, "healthy", "edge: 90 days clears watch into healthy"],
    [365, "healthy", "far from full"],
  ];

  for (const [days, expected, note] of CASES) {
    it(`${days} → ${expected} (${note})`, () => {
      expect(evaluateDaysToFull(days)).toBe(expected);
    });
  }

  it("exposes the three thresholds as read-time config (no raw numbers in logic)", () => {
    expect(DAYS_TO_FULL_BANDS).toEqual({ critical: 7, warning: 30, watch: 90 });
  });

  it("returns literals that are already df Severity members (no mapper needed)", () => {
    // critical/warning/watch/healthy are all valid df `Severity` values — a stale
    // days-to-full is not expressible here (projection is either honest or absent upstream).
    const out = new Set([
      evaluateDaysToFull(1),
      evaluateDaysToFull(10),
      evaluateDaysToFull(60),
      evaluateDaysToFull(400),
    ]);
    expect(out).toEqual(new Set(["critical", "warning", "watch", "healthy"]));
  });
});
