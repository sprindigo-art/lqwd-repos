---
phase: 12-ops-center-overview
plan: 04
subsystem: ui
tags: [vitals, proportional-rollup, df-ramp, vitest, tdd, pure-module]

# Dependency graph
requires:
  - phase: 12-ops-center-overview
    plan: 01
    provides: worstSeverity reducer (src/lib/overview/severity-map.ts) + df Severity ramp
provides:
  - "vitals.ts — rollupLayer producing strictly count-proportional per-state tallies (count/total) per fleet layer"
  - "LayerVitals shape (layer, counts: Record<Severity, number>, total, worst) for the FleetVitals bar"
affects: [fleet-vitals, overview-page, 12-05, 12-06, 12-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure Record<Severity, number> accumulator over an already-reduced per-entity severity array (mirrors facetCounts)"
    - "Single-count contract: multi-signal entity reduced to one rung by the caller BEFORE counting, so total = entity count (Pitfall 4)"

key-files:
  created:
    - src/lib/overview/vitals.ts
    - src/lib/overview/vitals.test.ts
  modified: []

key-decisions:
  - "Segment width is literal count/total — no severity weighting (D-07); test asserts 1-of-4 critical === 0.25"
  - "Denominator = ALL entities (healthy included); stale gets its own segment, never folded into healthy (D-08)"
  - "rollupLayer accepts only already-reduced per-entity severities — it never sees raw multi-signal rows, so one entity cannot double-count across its signals (Pitfall 4)"

patterns-established:
  - "worst = worstSeverity(severities) reuses Plan 01's stale-orthogonal reducer — no second worst-child implementation"

requirements-completed: [OVW-03]

# Metrics
duration: 6min
completed: 2026-06-30
---

# Phase 12 Plan 04: Fleet-Vitals Proportional Rollup Summary

**Pure `vitals.ts` whose `rollupLayer` tallies a layer's already-reduced per-entity df `Severity` values into strictly count-proportional per-state counts (`count / total`, healthy in the denominator, stale its own segment) — the math behind the 5 FleetVitals health bars (OVW-03 / D-07).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-30T21:46:00Z
- **Completed:** 2026-06-30T21:52:00Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 created

## Accomplishments
- `rollupLayer(layer, severities)` returns `LayerVitals` — a `Record<Severity, number>` accumulator (all 5 df states keyed at 0), `total = severities.length`, and `worst = worstSeverity(...)`.
- Proportionality is literal: the test asserts `counts.critical / total === 0.25` for 1-of-4, proving each bar segment is `count / total` with no severity weighting (D-07).
- Healthy stays in the denominator (an all-healthy layer reports `total === N`, proportion healthy 1.0) and `stale` carries its own bucket, never folded into healthy (D-08).
- Single-count contract documented in the header (Pitfall 4): the caller reduces a multi-signal entity (host cpu+mem+disk) to one rung before passing it in, so each entity contributes exactly 1; the module never accepts raw multi-signal rows.
- 7 vitest assertions green; full `src/lib/overview` suite green at 43/43 before merge. Module is pure (no `server-only` / `@/lib/db`).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the failing vitals vitest (RED)** - `002b453` (test)
2. **Task 2: Implement proportional rollup to green (GREEN)** - `f4aa4de` (feat)

_No REFACTOR commit — the GREEN implementation was already clean; no restructuring needed._

## Files Created/Modified
- `src/lib/overview/vitals.ts` - Pure proportional rollup: `rollupLayer` + `LayerVitals`, reusing Plan 01's `worstSeverity` for the worst rung.
- `src/lib/overview/vitals.test.ts` - 7 vitest assertions: count/total proportionality (0.25), healthy-in-denominator, stale-own-bucket, worst (stale orthogonal), empty-layer guard, no input mutation.

## Decisions Made
- **Literal proportion, no weighting (D-07):** a bar segment is `count / total` and nothing else; the test pins 1-of-4 critical to exactly 0.25 so the width math cannot drift into severity weighting.
- **Healthy in denominator + stale own segment (D-08):** `total = severities.length` counts healthy entities, and stale increments only `counts.stale` — a no-data entity reads as "no fresh fact", never as healthy.
- **Single-count contract (Pitfall 4):** the module accepts only one reduced severity per entity; multi-signal reduction is the caller's job via `worstSeverity`, keeping each entity's contribution to `total` exactly 1.

## Deviations from Plan

None - plan executed exactly as written. RED failed for the expected reason (unresolved import), GREEN passed all 7 assertions on the first implementation, module is pure (grep for `server-only`/`@/lib/db` returns nothing).

## Issues Encountered
None.

## TDD Gate Compliance
- RED gate present: `002b453` (test) — failed with "Cannot find module" before implementation.
- GREEN gate present: `f4aa4de` (feat) after RED — 7/7 assertions pass; full overview suite 43/43.
- REFACTOR: not required.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The FleetVitals bar (Plan 05/06) can import `rollupLayer`/`LayerVitals` from `@/lib/overview/vitals`; the caller must reduce each multi-signal entity to one rung via `worstSeverity` before passing severities in.
- No blockers.

## Self-Check: PASSED

- FOUND: src/lib/overview/vitals.ts
- FOUND: src/lib/overview/vitals.test.ts
- FOUND: .planning/phases/12-ops-center-overview/12-04-SUMMARY.md
- FOUND commit: 002b453 (RED test)
- FOUND commit: f4aa4de (GREEN impl)

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*
