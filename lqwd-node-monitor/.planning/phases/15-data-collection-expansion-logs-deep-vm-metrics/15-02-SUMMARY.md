---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 02
subsystem: read-layer
tags: [telemetry-bands, counter-delta, tdd, pure-module, col-02, col-03]
requires: []
provides:
  - "TELEMETRY_BANDS entries for all COL-02/COL-03 deep-VM + PG signals (snake_case keys, cross-plan contract for Plans 04/05)"
  - "clampCounterDelta(prev, curr, prevReset?, currReset?) — pure Δ≥0 counter-reset clamp (Pitfall 7)"
affects:
  - "15-04 (pg-health.ts reader) — imports clampCounterDelta + pg_* bands"
  - "15-05 (host-metrics-ext.ts reader) — imports clampCounterDelta + cpu/tcp/oom/clock bands"
tech-stack:
  added: []
  patterns:
    - "D-14 RAW-in-DB / bands-at-read extended to Phase-15 signals"
    - "Single shared counter-reset clamp for all cumulative-counter rate math"
key-files:
  created:
    - src/lib/read/counter-delta.ts
    - src/lib/read/counter-delta.test.ts
  modified:
    - src/lib/read/telemetry-bands.ts
    - src/lib/read/telemetry-bands.test.ts
decisions:
  - "Phase-15 band keys are snake_case (cpu_steal_pct, pg_conn_saturation, …) per the plan's cross-plan contract, coexisting with the Phase-11 camelCase keys — Wave-2 readers import by these exact names."
  - "pg_40001_rate_multiple has no warn tier (healthy=warn=10): <10× healthy, above ⇒ critical — the BP-005/AP-12b hard promotion. Boundary 10.0 itself grades healthy per the module's boundary-belongs-to-healthier-band convention (measure-zero in practice)."
  - "Hard-zero bands (oom_kills, ext4_io_errors) encode healthy=0, warn=0 so ANY nonzero value is critical with an unreachable warn tier — no evaluateBand semantics change needed."
  - "clampCounterDelta treats a null↔stamp transition on stats_reset as a reset boundary (epochs not comparable), and absent stamps on both sides as same-epoch."
metrics:
  duration: ~5 min
  completed: 2026-07-14
---

# Phase 15 Plan 02: Read-Time Bands + Counter-Reset Clamp Summary

**One-liner:** Nine new deep-VM + PG severity bands (steal/iowait/retransmit/conn-saturation/40001-multiple/OOM/EXT4/failed-units/clock-skew) plus a pure Δ≥0 `clampCounterDelta` reset clamp, both TDD'd RED→GREEN as the shared substrate for the Wave-2 readers.

## What Was Built

### Task 1 — Deep-VM + PG severity bands (telemetry-bands.ts)
Added nine `TELEMETRY_BANDS` entries, all `higher-worse`, per RESEARCH §COL-02/§COL-03:

| Key | healthy | warn | critical |
|-----|---------|------|----------|
| `cpu_steal_pct` | ≤2 | ≤10 | >10 |
| `cpu_iowait_pct` | ≤5 | ≤20 | >20 |
| `tcp_retransmit_rate` | ≤0.01 | ≤0.05 | >0.05 |
| `pg_conn_saturation` | ≤0.8 | ≤0.95 | >0.95 (AP-12a) |
| `pg_40001_rate_multiple` | ≤10 | — (collapsed) | >10 (AP-12b promotion) |
| `oom_kills` | 0 | — (hard-zero) | any >0 |
| `ext4_io_errors` | 0 | — (hard-zero) | any >0 |
| `failed_units` | 0 | 1 | >1 |
| `clock_offset_abs_seconds` | ≤0.05 | ≤0.5 | >0.5 |

Every band carries a `[CITED: Healthy Range Bands.md …]` / `[ASSUMED]` note. `evaluateBand` semantics and all six existing Phase-11 bands are untouched.

### Task 2 — clampCounterDelta (counter-delta.ts, new)
Pure `clampCounterDelta(prev, curr, prevReset?, currReset?)`:
- normal case → `curr − prev`
- backwards counter (reset) → `curr` (never negative)
- moved `stats_reset` stamp → `curr` even when `curr ≥ prev`
- `prev` null/undefined → `null` (honest no-data)
- accepts `bigint | number`, returns plain number; result always ≥0 or null (property-matrix tested)

## Verification

- `npx vitest run src/lib/read/telemetry-bands.test.ts src/lib/read/counter-delta.test.ts` → 96/96 green.
- Full read-layer suite `npx vitest run src/lib/read` → 222 pass / 17 skipped, no regressions.
- Purity greps: `grep -E "db/nodemon|dbNodemon|postgres"` returns nothing in both modules.
- Acceptance spot-checks: `evaluateBand(12, TELEMETRY_BANDS.pg_40001_rate_multiple)` → "critical"; `evaluateBand(1, TELEMETRY_BANDS.oom_kills)` → "critical"; `clampCounterDelta(100n, 30n)` → 30; `clampCounterDelta(100, 150, "t1", "t2")` → 150; `clampCounterDelta(null, 150)` → null.

## TDD Gate Compliance

RED→GREEN sequence verified in git log for both tasks:
1. `a23af4e` test(15-02) — bands RED (42 failing)
2. `bcaba03` feat(15-02) — bands GREEN (86/86)
3. `325f933` test(15-02) — counter-delta RED (import failure, module absent)
4. `c602aba` feat(15-02) — counter-delta GREEN (96/96 combined)

No refactor commit needed — implementations landed clean.

## Deviations from Plan

**1. [Adaptation] evaluateBand call shape in tests**
- **Found during:** Task 1 RED
- **Issue:** Plan pseudo-code used `evaluateBand("cpu_steal_pct", 1)`, but the actual module signature is `evaluateBand(value, band)`.
- **Fix:** Tests use `evaluateBand(1, TELEMETRY_BANDS.cpu_steal_pct)` — plan explicitly forbids changing `evaluateBand` semantics, so the existing signature wins.
- **Files modified:** src/lib/read/telemetry-bands.test.ts

No other deviations — plan executed as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes; both modules are pure and DB-free (T-15-08 mitigation holds: severity exists only at read time).

## Commits

| Commit | Message |
|--------|---------|
| a23af4e | test(15-02): add failing tests for deep-VM + PG severity bands |
| bcaba03 | feat(15-02): add deep-VM + PG severity bands to TELEMETRY_BANDS |
| 325f933 | test(15-02): add failing tests for clampCounterDelta reset clamp |
| c602aba | feat(15-02): implement pure clampCounterDelta reset clamp |

## Self-Check: PASSED
- src/lib/read/telemetry-bands.ts contains all 9 new bands — FOUND
- src/lib/read/counter-delta.ts exports clampCounterDelta — FOUND
- All 4 commits present on worktree-agent-a9ea625ae5d70aed7 — FOUND
