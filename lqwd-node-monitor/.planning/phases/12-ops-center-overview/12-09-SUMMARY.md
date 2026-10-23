---
phase: 12-ops-center-overview
plan: 09
subsystem: ui
tags: [incidents, severity, fee-grouping, deeplink, vitest, tdd]

requires:
  - phase: 12-01
    provides: severity-map.ts (severityFromInsight/worstSeverity — the single severity boundary)
  - phase: 12-03
    provides: incidents.ts assembleIncidents (host-keyed root-cause incident tree)
  - phase: 04
    provides: buildDeepLink (validated relative /{pubkey}/{tab} route builder)
provides:
  - "clampBelowCritical(sev) fee-severity guard on the single severity boundary (fees never critical)"
  - "Per-node fee grouping in assembleIncidents: <=2 counted, /{pubkey}/fees-routed, never-critical summary children"
  - "GroupedIncident optional count/href/feeKind fields (back-compat)"
affects: [12-13, incident-rendering, ai-band, filter]

tech-stack:
  added: []
  patterns:
    - "Fee alerts intercepted before the leaf path and collected per-pubkey in a Map (engine order preserved, no .sort)"
    - "Route built ONLY via buildDeepLink; non-routable pubkey omits href rather than throwing (open-redirect guard)"

key-files:
  created: []
  modified:
    - src/lib/overview/severity-map.ts
    - src/lib/overview/severity-map.test.ts
    - src/lib/overview/incidents.ts
    - src/lib/overview/incidents.test.ts

key-decisions:
  - "Fee severity clamped below critical at the grouped-summary level only — the owning host incident can still go critical from non-fee children"
  - "channel_close_candidate is a fee-signals detector output but is NOT grouped (only fee_raise/fee_lower); it stays a normal per-channel leaf"
  - "makeCard test-factory default signal retargeted to channel_close_candidate so the pre-existing generic-leaf cases keep exercising the non-fee path unchanged"

patterns-established:
  - "clampBelowCritical: critical->warning, all other rungs (incl. stale) passthrough — fees never page red"
  - "Fee summary child key = fee:{raise|lower}:{pubkey|fleet}; count = underlying channel count; href = /{pubkey}/fees"

requirements-completed: [OVW-01]

duration: ~10min
completed: 2026-06-30
---

# Phase 12 Plan 09: Fee-Alert Grouping (Incident Model) Summary

**Per-node fee alerts now collapse to at most two counted, /{pubkey}/fees-routed, never-critical summary children in the incident tree — the per-channel fee-row noise is gone, backed by a `clampBelowCritical` guard on the single severity boundary.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-30T18:18:00Z
- **Completed:** 2026-06-30T18:23:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added `clampBelowCritical(sev)` to `severity-map.ts` — the documented fee-never-critical guard (critical demotes to warning; watch/healthy/warning/stale pass through untouched, so a stale fee fact stays honestly stale).
- Restructured `assembleIncidents` so `fee_raise`/`fee_lower` cards NEVER become per-channel leaves: they are intercepted before the leaf path, collected per node in a first-seen-order Map, and emitted as at most two counted summary children (one raise, one lower).
- Each fee summary carries `count` (underlying channel count), `feeKind`, and an `href` routed only via `buildDeepLink(pubkey, "fees")` → relative `/{pubkey}/fees`; a non-routable pubkey omits `href` rather than throwing.
- Fee summary severity = `clampBelowCritical(worstSeverity(...))`, so an upstream-critical fee card still summarises as `warning`.
- Engine order preserved (zero `.sort`), all non-fee incident behavior (host roll-up D-02, stale orthogonality D-08, unattached float) intact; downstream consumers typecheck clean.

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1 RED: clampBelowCritical assertions** - `301dd3c` (test)
2. **Task 1 GREEN: clampBelowCritical guard** - `e9fa900` (feat)
3. **Task 2 RED: per-node fee-grouping tests** - `4f34d67` (test)
4. **Task 2 GREEN: fee grouping in assembleIncidents** - `cc52151` (feat)

**Plan metadata:** _(final docs commit)_

## Files Created/Modified
- `src/lib/overview/severity-map.ts` - Added `clampBelowCritical` fee-severity guard (never critical, stale passthrough).
- `src/lib/overview/severity-map.test.ts` - +6 clamp assertions (existing 23 untouched).
- `src/lib/overview/incidents.ts` - `FEE_SIGNALS` interception + per-node fee accumulator + up-to-two summary children with count/href/feeKind; `GroupedIncident` gains optional `count`/`href`/`feeKind`.
- `src/lib/overview/incidents.test.ts` - `makeFeeCard` factory + 4 fee-grouping tests; factory default signal retargeted (see deviation).

## Decisions Made
- Fee summary severity is clamped below critical at the summary line only; the host incident it nests under can still be critical from non-fee children (matches LOCKED #4: the *fee line* never pages red, not the whole host).
- `channel_close_candidate` (also a fee-signals detector output) is explicitly excluded from `FEE_SIGNALS` — it remains a normal per-channel leaf.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Retargeted `makeCard` test-factory default signal to a non-fee signal**
- **Found during:** Task 2 (GREEN)
- **Issue:** The pre-existing `incidents.test.ts` `makeCard` factory defaulted `signal` to `"fee_raise"`, and all 6 prior generic-leaf cases relied on that default. Once fee grouping intercepts `fee_raise`, those cases (which assert per-card leaves, host roll-up, unattached float, engine order) broke — their intent was "a generic node alert becomes a leaf," not "a fee card."
- **Fix:** Changed the factory default from `"fee_raise"` to `"channel_close_candidate"` (a valid non-grouped signal). Every existing case body is unchanged; they now exercise the intended non-fee leaf path. Fee grouping is covered explicitly via the new `makeFeeCard` factory.
- **Files modified:** src/lib/overview/incidents.test.ts
- **Verification:** Full overview suite 85/85 green; the 6 prior cases pass verbatim.
- **Committed in:** cc52151 (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal factory-default adjustment to keep the existing cases meaningful under the new grouped-signal semantics. No production-code scope creep; the "do not rewrite existing cases" intent is honored (case bodies untouched).

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The grouped incident shape (`count`/`href`/`feeKind`) is ready for the rendering + click wiring in 12-13.
- No blockers. `tsc --noEmit` clean; no `.sort` in incidents.ts; fee severity clamped below critical; fee href relative-only.

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*

## Self-Check: PASSED
- FOUND: 12-09-SUMMARY.md
- FOUND commits: 301dd3c (test), e9fa900 (feat), 4f34d67 (test), cc52151 (feat)
