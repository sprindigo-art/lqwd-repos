---
phase: 03-per-node-console-pending-monitor
plan: 11
subsystem: api
tags: [drizzle, postgres, sql, vitest, tdd, sparklines, time-series]

# Dependency graph
requires:
  - phase: 03-per-node-console-pending-monitor
    provides: "forwards.ts/closes.ts builder + lazy-executor pattern, config.ts WINDOW_PRESETS (D-06), warehouse-routing client"
provides:
  - "buildForwardsDailySql / buildClosesDailySql — parameter-bound, windowed, GROUP-BY-day SQL builders"
  - "forwardsDailySeries / closesDailySeries executors returning TrendPoint[] (lazy dbRouting import)"
  - "TrendPoint { day: string; n: number; feesSat?: number } type for sparkline components"
affects: [03-14 evidence-panel components, 03-15 console wiring]

# Tech tracking
tech-stack:
  added: []
  patterns: ["daily-bucket trend series: to_timestamp(timestamp_ns / 1e9)::date for ns-epoch tables, timestamp::date + make_interval for wall-time tables, GROUP BY 1 ORDER BY 1 ASC"]

key-files:
  created:
    - src/lib/console/trends.ts
    - src/lib/console/trends.test.ts
  modified: []

key-decisions:
  - "closesDailySeries defaults to 30 days (scorecard force-close dimension window); forwards series maps WindowKey via WINDOW_PRESETS (D-06)"
  - "Day bucket stays the verbatim Postgres date string — no timezone math in the executor"
  - "Latest-state dimensions (liquidity, channel health, peer, restart) get no series — no sanctioned history reader; their evidence panels carry the mono line alone"

patterns-established:
  - "Trend series modules: same builder/lazy-executor discipline as forwards.ts — exported SQL builders shape-tested via PgDialect without a DB, executors lazy-import the warehouse client"

requirements-completed: [NODE-01]

# Metrics
duration: 2min
completed: 2026-06-11
---

# Phase 03 Plan 11: Trend-Series Read Layer Summary

**Daily-bucketed TrendPoint series for the evidence-panel sparklines — forwards count/fees (ns-epoch windowed) and closes count (make_interval windowed), parameter-bound and shape-tested with 12 no-DB assertions**

## Performance

- **Duration:** 2 min
- **Started:** 2026-06-11T16:20:35Z
- **Completed:** 2026-06-11T16:22:47Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- `buildForwardsDailySql`: day bucket via `to_timestamp(timestamp_ns / 1e9)::date`, the 1e9 ns window predicate with ::int casts (42725 rationale carried over), AFM-002 `SUM(fee_msat)/1000.0` (raw `fee` column proven absent by `\bfee\b` regex test), `GROUP BY 1 ORDER BY 1 ASC`
- `buildClosesDailySql`: `timestamp::date` bucket on `lnd_node_closed_channels` via `local_pubkey` + `make_interval(days => $bound)`, same GROUP/ORDER discipline
- `forwardsDailySeries` (WindowKey → bound integer via WINDOW_PRESETS) and `closesDailySeries` (fixed 30d default) executors: lazy `await import("@/lib/db/warehouse-routing")`, Number() coercion, verbatim day strings, empty window → empty array
- 12 shape tests green covering: 1e9 factor, bound params (pubkey/days/86400 in params array, never in SQL text), GROUP BY in both builders, AFM-002 form, ORDER BY ascending, make_interval, SQLi binding, windowed-scan guarantee (T-03-22/T-03-23 mitigations verified)

## Task Commits

Each task was committed atomically (TDD — two commits):

1. **Task 1 RED: failing shape tests** - `729529b` (test)
2. **Task 1 GREEN: builders + executors** - `5604f37` (feat)

## Files Created/Modified
- `src/lib/console/trends.ts` - TrendPoint type, two daily-bucket SQL builders, two lazy-import executors (display-only sparkline data, no grading)
- `src/lib/console/trends.test.ts` - PgDialect no-DB shape tests (12 assertions)

## Decisions Made
- Kept the local `SECONDS_PER_DAY = 86400` constant with explicit `::int` casts (Postgres 42725 "operator is not unique" — found live in 03-07), matching forwards.ts verbatim
- `feesSat` coerces `fees_sat ?? 0` — a day bucket with rows always has fees data, so 0-default is safe and keeps TrendPoint numeric

## Deviations from Plan

None - plan executed exactly as written.

## TDD Gate Compliance
- RED gate: `729529b` (test commit, confirmed failing — module missing)
- GREEN gate: `5604f37` (feat commit, 12/12 passing)
- REFACTOR: skipped — implementation mirrors established forwards.ts/closes.ts patterns; nothing to clean up

## Verification Results
- `npx vitest run src/lib/console/trends.test.ts` — 12 passed
- `npx tsc --noEmit` — exit 0
- `npm test` — 264 passed, 16 skipped, 0 failed (27 files passed, 3 skipped)
- `grep -c "await import" src/lib/console/trends.ts` — 2 (≥ 1 required)

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TrendPoint series ready for 03-14's Sparkline/EvidencePanel components and 03-15's wiring
- Latest-state dimensions intentionally have no series — evidence panels for those dimensions render the mono line alone per sketch 003 findings

## Self-Check: PASSED
- FOUND: src/lib/console/trends.ts
- FOUND: src/lib/console/trends.test.ts
- FOUND: commit 729529b (RED)
- FOUND: commit 5604f37 (GREEN)

---
*Phase: 03-per-node-console-pending-monitor*
*Completed: 2026-06-11*
