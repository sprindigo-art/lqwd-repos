---
phase: 12-ops-center-overview
plan: 01
subsystem: ui
tags: [severity, df-ramp, normalization, vitest, tdd, pure-module]

# Dependency graph
requires:
  - phase: 10-design-system-foundation
    provides: df Severity 5-state ramp (src/components/df/Severity.ts)
  - phase: 11-full-stack-telemetry-ingestion
    provides: telemetry-bands BandSeverity + service-health ServiceHealthState read shapes
provides:
  - "severity-map.ts — the single documented boundary normalizing insight/band/service vocabularies onto the df Severity ramp"
  - "severityFromInsight / severityFromBand / severityFromService normalizers"
  - "worstSeverity worst-child reducer with stale orthogonality (D-08)"
affects: [incidents, vitals, ai-band, overview-page, 12-02, 12-03, 12-04, 12-05, 12-06, 12-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure (input, config) → enum mapper module, mirroring telemetry-bands.ts evaluateBand discipline"
    - "Typed boundary: each mapper input is the literal source union so a raw string cannot leak through (TS-enforced)"

key-files:
  created:
    - src/lib/overview/severity-map.ts
    - src/lib/overview/severity-map.test.ts
  modified: []

key-decisions:
  - "DISCRETIONARY A1: insight `info` → df `watch` (surfaced advisory, not hidden) — documented inline per D-06"
  - "DISCRETIONARY A2: noData AND functioning-stale both collapse to one `stale` bucket — no 6th segment"
  - "worstSeverity filters `stale` before reducing — stale is orthogonal and never promotes a healthy parent (D-08/D-02)"

patterns-established:
  - "All severity in the overview routes through this one pure module — no blind string passthrough (RESEARCH Pitfall 1)"
  - "Membership-guard test asserts every mapper output ∈ the df Severity union"

requirements-completed: [OVW-01, OVW-03, OVW-05]

# Metrics
duration: 10min
completed: 2026-06-30
---

# Phase 12 Plan 01: Severity-Map Normalization Boundary Summary

**Pure `severity-map.ts` collapsing the four upstream severity dialects (insight, telemetry-band, service-health, scorecard) onto the canonical df 5-state `Severity` ramp, with a worst-child reducer that keeps `stale` orthogonal so a no-data child never fakes an outage.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-30T21:08:00Z
- **Completed:** 2026-06-30T21:18:00Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 created

## Accomplishments
- Single documented severity boundary (D-06) — every downstream overview module now has one place to normalize severity, unblocking Wave 2.
- Four named, pure mappers: `severityFromInsight` (warn→warning, info→watch), `severityFromBand` (warn→warning, no watch tier), `severityFromService` (two-axis booleans → ramp with the "up-but-dead" guard), `worstSeverity` (worst-child on critical>warning>watch>healthy).
- `stale` orthogonality enforced: filtered out before the worst-child reduction so a stale child can never promote a healthy parent to critical (D-08/D-02); test asserts `worstSeverity(["healthy","stale"]) === "healthy"`.
- 23 vitest assertions green, including a membership guard proving every mapper output ∈ the df `Severity` union (T-12-MAP-01 mitigation).

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the failing severity-map vitest (RED)** - `b7c55fc` (test)
2. **Task 2: Implement severity-map to green (GREEN)** - `17e9d13` (feat)

_No REFACTOR commit — the GREEN implementation was already clean; no restructuring needed._

## Files Created/Modified
- `src/lib/overview/severity-map.ts` - Pure normalization boundary: four named mappers + the worstSeverity reducer onto the df Severity ramp.
- `src/lib/overview/severity-map.test.ts` - 23 vitest assertions: per-mapper mappings, df-union membership guard, worst-child precedence, stale orthogonality, empty-input default.

## Decisions Made
- **A1 (info → watch):** insight `info` cards are surfaced advisories, so they land on the lowest active rung (`watch`) rather than vanishing into `healthy`. Documented inline.
- **A2 (single stale bucket):** the no-data case and the per-service functioning-stale case both collapse to one `stale` value — no 6th segment, keeping the ramp at five states.
- **stale orthogonal in the reducer:** `worstSeverity` filters `stale` out before reducing; staleness is surfaced via a separate flag, never through the worst-child axis.

## Deviations from Plan

None - plan executed exactly as written. RED failed for the expected reason (unresolved import), GREEN passed all assertions on the first implementation, module is pure (grep for `server-only`/`@/lib/db` returns nothing).

## Issues Encountered
None.

## TDD Gate Compliance
- RED gate present: `b7c55fc` (test) — failed with "Cannot find module" before implementation.
- GREEN gate present: `17e9d13` (feat) after RED — 23/23 assertions pass.
- REFACTOR: not required.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Wave 2 (incidents, vitals, ai-band, page) can now import `severityFromInsight`/`severityFromBand`/`severityFromService`/`worstSeverity` from `@/lib/overview/severity-map` for all severity normalization.
- No blockers.

## Self-Check: PASSED

- FOUND: src/lib/overview/severity-map.ts
- FOUND: src/lib/overview/severity-map.test.ts
- FOUND: .planning/phases/12-ops-center-overview/12-01-SUMMARY.md
- FOUND commit: b7c55fc (RED test)
- FOUND commit: 17e9d13 (GREEN impl)

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*
