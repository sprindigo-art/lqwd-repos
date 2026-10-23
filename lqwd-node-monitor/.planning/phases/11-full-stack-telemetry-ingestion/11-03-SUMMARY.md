---
phase: 11-full-stack-telemetry-ingestion
plan: 03
subsystem: read-model
tags: [telemetry, units, afm-002, thresholds, fixtures, drizzle, vitest, tdd]

# Dependency graph
requires:
  - phase: 11-01
    provides: nodemon telemetry schema (hosts, service_inventory, host_metrics, host_storage, service_health, chain_telemetry)
provides:
  - "formatBytes + formatPercent (AFM-002 single-source byte/percent formatting)"
  - "TELEMETRY_BANDS versioned threshold config + pure evaluateBand (D-14)"
  - "seeded-fixture helper (fresh/stale/never-reported/up-but-dead/per-service-clock) for the test nodemon DB"
affects: [11-04, 11-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AFM-002 single-source unit formatting extended to binary bytes + percent (no inline math at call sites)"
    - "Read-time threshold config object + pure evaluator (D-14); thresholds never stored on rows"
    - "Seeded-fixture helper with lazy server-only DB import + skipIf gate (no DB at module load)"

key-files:
  created:
    - src/lib/read/telemetry-bands.ts
    - src/lib/read/telemetry-bands.test.ts
    - src/lib/read/telemetry-fixture.ts
  modified:
    - src/lib/format/units.ts
    - src/lib/format/units.test.ts

key-decisions:
  - "Band boundary convention: the boundary value belongs to the HEALTHIER band (>= healthy for higher-better, <= healthy for higher-worse) — deterministic, tested at every edge."
  - "formatPercent clamps into [0,100] and renders '—' for null/undefined (file's null-coalescing posture)."
  - "Fixture lazy-imports dbNodemon inside exported functions so importing the helper never opens a connection or requires NODEMON_QUEUE_URL at module load."

patterns-established:
  - "TELEMETRY_BANDS typed config consumed by pure evaluateBand — mirrors INSIGHT_CONFIG/SCORECARD_CONFIG posture."
  - "BYTES_REFERENCE reference-value table mirrors BTC_REFERENCE for unit-formatter tests."

requirements-completed: [TEL-01, TEL-02, TEL-03]

# Metrics
duration: ~70min
completed: 2026-06-29
---

# Phase 11 Plan 03: Read-Side Telemetry Substrate Summary

**AFM-002 byte/percent formatting, a versioned D-14 threshold-band evaluator, and a deterministic seeded-fixture helper — the shared substrate every Plan-04/05 telemetry read helper depends on.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-06-29T11:39:00Z (approx)
- **Completed:** 2026-06-29T18:48:07Z
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- Extended `units.ts` (AFM-002 single source) with `formatBytes` (auto-scaled binary B→TiB) and `formatPercent` (fraction/already-percent, clamped, null-graceful) — the inline-byte-math grep gate is clean across `src/`.
- Created `telemetry-bands.ts`: typed `TELEMETRY_BANDS` for disk%/blocks-behind/verificationprogress/peers/cpu%/mem-available with per-band direction + `[CITED]`/`[ASSUMED]` annotations, and a pure `evaluateBand` that judges raw values at read time (D-14 — re-tuning never re-ingests).
- Created `telemetry-fixture.ts`: seeds/tears down fresh / stale / never-reported / up-but-dead / per-service-clock scenarios into the test nodemon DB via parameter-bound Drizzle inserts, keyed by test host_id, idempotent, with no DB at module load.

## Task Commits

Each task was committed atomically (TDD tasks: test → feat):

1. **Task 1: Extend units.ts (formatBytes + formatPercent)** — `058010c` (test), `ae1d569` (feat)
2. **Task 2: telemetry-bands.ts threshold evaluator** — `c554550` (test), `7b077a3` (feat)
3. **Task 3: seeded-fixture test helper** — `a9143be` (feat)

**Deferred-items log:** `1fb5126` (docs)

## Files Created/Modified
- `src/lib/format/units.ts` — added `formatBytes`/`formatPercent` + binary constants (AFM-002 single source)
- `src/lib/format/units.test.ts` — added `BYTES_REFERENCE` table + formatBytes/formatPercent cases
- `src/lib/read/telemetry-bands.ts` — `TELEMETRY_BANDS` config + pure `evaluateBand` (D-14)
- `src/lib/read/telemetry-bands.test.ts` — per-signal region + exact-boundary tests, config-shape assertions
- `src/lib/read/telemetry-fixture.ts` — `seedTelemetryFixture`/`cleanupTelemetryFixture` for the five read-side scenarios

## Decisions Made
- **Band boundary convention:** boundary value belongs to the healthier band — uniform, deterministic, tested at every edge. For integer signals (peers, blocks-behind) this lands exactly on the documented prose ranges; for continuous signals the single-point boundary is operationally immaterial and is explicitly documented.
- **formatPercent posture:** clamp to [0,100], render `—` for null/undefined (matches the file's existing null-coalescing posture).
- **Fixture lazy import:** `dbNodemon` is imported inside the exported async functions (mirrors `latest.ts`), so the helper is import-safe with no `NODEMON_QUEUE_URL` and downstream tests gate behind `describe.skipIf(!process.env.NODEMON_QUEUE_URL)`.

## Deviations from Plan

None - plan executed exactly as written.

(One cosmetic adjustment within Task 1 scope: the test doc-comment was reworded to avoid literally containing the `/1024**`/`/1073741824` patterns the acceptance grep gate forbids — the gate is clean as a result. Not a behavior change.)

## Issues Encountered
- **Pre-existing off-DB queue test failures (out of scope).** Running `npm test` shows 4 failing files in `src/lib/queue/` (enqueue/approve/claim/stub-executor) because they reach `requireEnv("NODEMON_QUEUE_URL")` and are NOT gated behind `skipIf` the way `src/lib/db/health.test.ts` is. Confirmed unrelated to Plan 03 (those suites import no telemetry code) and pre-existing in this worktree. Logged to `deferred-items.md`; not fixed per the SCOPE BOUNDARY rule. All Plan-03 tests and the telemetry verification suite pass.

## Verification
- `npx vitest run src/lib/format src/lib/read/telemetry-bands.test.ts` → 68 passed.
- Inline-byte-math grep gate (`/\s*1024\s*\*\*` | `/\s*1073741824` outside `format/units.ts`) → clean.
- `telemetry-bands.ts` purity gate (`server-only` / `@/lib/db`) → clean.
- `npx tsc --noEmit` → telemetry-fixture typechecks clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Read helpers in Plans 04/05 can now consume `evaluateBand` for read-time evidence and `formatBytes`/`formatPercent` for host-vitals rendering.
- The seeded-fixture helper is ready for the Plan-04/05 helper tests; those tests must run with `NODEMON_QUEUE_URL` set (live test nodemon) to exercise the seeded scenarios — otherwise they skip cleanly.

## Self-Check: PASSED

All 6 created/modified files present on disk; all 6 task/docs commits present in git history.

---
*Phase: 11-full-stack-telemetry-ingestion*
*Completed: 2026-06-29*
