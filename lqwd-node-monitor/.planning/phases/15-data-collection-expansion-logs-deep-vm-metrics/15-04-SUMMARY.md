---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 04
subsystem: read-layer
tags: [col-03, deep-vm-metrics, distinct-on, counter-delta, telemetry-bands, tdd]
requires: [15-01, 15-02]
provides:
  - "getHostMetricsExt(hostId) — serializable deep-VM view (scalar + per-core/-device/-iface children + derived rates/bands) for VmVitals / host detail (Plan 08)"
  - "deriveHostMetricsExt(current, previous) — PURE evaluator: jiffy-delta busy/steal/iowait %, Δ≥0 disk/net counter deltas, tcp retransmit ratio, gauge bands"
  - "buildLatestHostMetricsExtSql + buildLatestHostCpuCoreSql/DiskIoSql/NetIfaceSql — AFM-001 DISTINCT-ON latest builders"
affects: [15-08]
tech-stack:
  added: []
  patterns:
    - "ROW_NUMBER rn=2 prior-sample builders (PARTITION BY entity key, ORDER BY collected_at DESC) as the counter-Δ companion to DISTINCT-ON latest"
    - "prior child rows paired by entity key via Map (core_index/device/iface), never array position"
key-files:
  created:
    - src/lib/read/host-metrics-ext.ts
    - src/lib/read/host-metrics-ext.test.ts
  modified: []
decisions:
  - "Prior samples fetched via ROW_NUMBER() OVER (PARTITION BY entity key ORDER BY collected_at DESC) WHERE rn = 2 — window ranking, not MAX() (AFM-001-safe), one query per table (8 total per host)"
  - "busy% = Δ(user+nice+system+irq+softirq+steal+guest) ÷ Δ(all jiffies incl. idle+iowait); each summed side clamped via clampCounterDelta before dividing; zero/absent Δtotal → null (never NaN)"
  - "oom_kill counter Δ is banded via the hard-zero oom_kills band (any Δ>0 ⇒ critical) — the band exists precisely for this counter even though the plan named only the five explicit bands"
  - "disk sector deltas ×512 → readBytesDelta/writeBytesDelta (fixed /proc/diskstats sector size per RESEARCH §COL-03)"
metrics:
  duration: ~6m
  completed: 2026-07-14
---

# Phase 15 Plan 04: COL-03 Deep-VM Read Layer (host-metrics-ext) Summary

**One-liner:** DISTINCT-ON deep-VM reader over `host_metrics_ext` + three child facts with a pure two-sample evaluator turning raw jiffies/counters into Δ≥0 rates and read-time bands via `clampCounterDelta` + Plan-02 `TELEMETRY_BANDS`.

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | Latest-per-host scalar + child DISTINCT-ON builders | f09fc9b (RED), ff54a1f (GREEN) | src/lib/read/host-metrics-ext.ts, .test.ts |
| 2 | getHostMetricsExt assembly — grouping, counter→rate, bands | d33d951 (RED), 5808046 (GREEN) | src/lib/read/host-metrics-ext.ts, .test.ts |

## What Was Built

- **Builders (Task 1):** `buildLatestHostMetricsExtSql` (DISTINCT ON (host_id)), plus `buildLatestHostCpuCoreSql` / `buildLatestHostDiskIoSql` / `buildLatestHostNetIfaceSql` keyed `(host_id, core_index|device|iface)` with the dimension key inside DISTINCT ON and before `collected_at` in ORDER BY (Pitfall 4 — N children survive). No `MAX(` anywhere; `hostId` always parameter-bound (T-15-01). Internal ROW_NUMBER rn=2 builders fetch the prior sample per entity for Δ derivation.
- **Pure evaluator (Task 2):** `deriveHostMetricsExt(current, previous)` — per-core busy/steal/iowait % from clamped jiffy-sum deltas (banded `cpu_steal_pct`/`cpu_iowait_pct`); per-device reads/writes/sectors×512/ms-doing-IO deltas; per-iface rx/tx bytes/errs/drop deltas; scalar tcp retransmit ratio (ΔRetrans÷ΔOut, banded `tcp_retransmit_rate`); oom Δ banded hard-zero; gauges `failed_units` and |clock offset| banded directly. Every cumulative counter goes through `clampCounterDelta` (Δ≥0, T-15-08). Null prior → null rates (honest no-data); prior children matched by entity key via Map, never index.
- **Getter (Task 2):** `getHostMetricsExt(hostId)` — 8 parallel parameter-bound queries via lazy `dbNodemon`, returns `{ hostId, asOf, stale (deriveStale/D-13), hasData, scalar, cpuCores, disks, netIfaces, derived }`.

## Verification

- `npx vitest run src/lib/read/host-metrics-ext.test.ts` — 29/29 green (19 builder-shape, 10 evaluator-fixture).
- Full read-layer suite `npx vitest run src/lib/read` — 251 pass / 17 skipped, no regressions.
- `npx tsc --noEmit` — zero errors mentioning host-metrics-ext.
- Purity grep: `dbNodemon` matches only inside `getHostMetricsExt` (+docs), never the pure evaluator.
- Live-DB note: migration 0003 not yet applied (operator gate from 15-01) — all tests are no-DB fixture/shape tests by design; no seeded suite added.

## TDD Gate Compliance

RED→GREEN verified in git log for both tasks:
1. `f09fc9b` test(15-04) — builder shape tests RED (module absent)
2. `ff54a1f` feat(15-04) — builders GREEN (19/19)
3. `d33d951` test(15-04) — deriveHostMetricsExt RED (10 failing)
4. `5808046` feat(15-04) — evaluator + getter GREEN (29/29)

No refactor commit needed.

## Deviations from Plan

**1. [Adaptation] Prior-sample builders added (ROW_NUMBER rn=2)**
- **Found during:** Task 2 design
- **Issue:** The plan's four DISTINCT-ON builders return only the latest row, but `deriveHostMetricsExt` requires "the latest + prior sample" for counter Δ.
- **Fix:** Four internal `buildPrior*Sql` builders using `ROW_NUMBER() OVER (PARTITION BY <entity key> ORDER BY collected_at DESC) ... WHERE rn = 2` — window ranking, parameter-bound, no `MAX(`.
- **Files modified:** src/lib/read/host-metrics-ext.ts
- **Commit:** 5808046

**2. [Rule 1 - Bug] Test fixture arithmetic error (iowait case)**
- **Found during:** Task 2 GREEN
- **Issue:** My iowait fixture computed Δtotal = 750 while the comment claimed 1000 (expected 30%, actual 40%) — the implementation was correct.
- **Fix:** Fixture corrected (idle 750 → 1000) so Δtotal = 1000.
- **Files modified:** src/lib/read/host-metrics-ext.test.ts
- **Commit:** 5808046

**3. [Note for orchestrator] REQUIREMENTS.md not touched** — COL-03 completion marking deferred to the orchestrator (shared file; parallel Wave-2 agents active).

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. T-15-01 mitigated (all hostId params bound, asserted by injection test); T-15-08 mitigated (every counter Δ through clampCounterDelta, asserted by reset fixtures).

## Self-Check: PASSED

- FOUND: src/lib/read/host-metrics-ext.ts (exports getHostMetricsExt, buildLatestHostMetricsExtSql, deriveHostMetricsExt)
- FOUND: src/lib/read/host-metrics-ext.test.ts (29 tests)
- FOUND commits: f09fc9b, ff54a1f, d33d951, 5808046
