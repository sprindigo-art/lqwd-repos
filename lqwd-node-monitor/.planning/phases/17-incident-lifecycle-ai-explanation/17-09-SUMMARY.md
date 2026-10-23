---
phase: 17-incident-lifecycle-ai-explanation
plan: 09
subsystem: ui
tags: [nextjs, rsc, incident-tracking, overview, reconcile, snoozed-critical-banner]

# Dependency graph
requires:
  - phase: 17-02
    provides: reconcileTracking pure state machine
  - phase: 17-05
    provides: incident-tracking read layer (reconcileAndGetView)
  - phase: 17-07
    provides: SnoozedCriticalBanner + tracking controls
  - phase: 17-08
    provides: Incident Detail page (/incidents/[key])
provides:
  - tracking-aware overview attention queue (reconciled view, detail deep-links)
  - fleet-wide snoozed-critical banner on overview AND host detail
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "reconcileAndGetView runs at render OUTSIDE the pure 20s data memo (buildOverviewData stays pure — no nodemon write inside the memo)"
    - "host detail computes snoozed-critical count via pure reconcileTracking (zero-write on host render)"

key-files:
  created: []
  modified:
    - src/app/(overview)/page.tsx
    - src/components/overview/QueueIsland.tsx
    - src/app/(overview)/hosts/[hostId]/page.tsx

key-decisions:
  - "Did NOT fold loadIncidents() into buildOverviewData — loadIncidents lacks the 30-day applyFreshnessCutoff the overview runs before assembly; folding it would reintroduce the Phase-12 STALE flood or double warehouse reads. Overview keeps its cut-aware assembly and reconcile threads onto it."
  - "Queue-card detail link lives in QueueIsland.tsx (the render owner) rather than page.tsx, as a consequence of the above."

patterns-established:
  - "Read-time reconcile is render-scoped and fail-soft: a nodemon outage degrades to the un-reconciled queue, never a blank page"
  - "Snoozed-critical banner is fleet-wide and non-dismissible on every surface that can hide a critical (overview + host)"

requirements-completed: [INC-02]

# Metrics
duration: ~30min (incl. operator visual gate)
completed: 2026-07-21
---

# Phase 17-09: tracking-aware overview + operator gate Summary

**Threaded incident tracking into the live overview queue and host detail — reconciled, already-ordered view with per-card detail deep-links and a fleet-wide non-dismissible snoozed-critical banner — verified end-to-end at the operator visual gate.**

## Performance

- **Duration:** ~30 min (2 autonomous tasks + blocking operator visual gate)
- **Completed:** 2026-07-21
- **Tasks:** 3 (Tasks 1–2 autonomous; Task 3 operator visual gate)
- **Files modified:** 3

## Accomplishments
- Overview render now runs `reconcileAndGetView(incidents, now)` OUTSIDE the pure 20s data memo (fail-soft on nodemon outage); the reconciled, already-ordered `view` (snooze-drop / ack-partition / breakthrough / resolution) flows to `QueueIsland` with no new `.sort`
- Each queue card headline deep-links to `/incidents/[key]`; child rows keep their own deep-links
- `SnoozedCriticalBanner` mounted sticky above the fold on overview AND host detail — a snoozed critical never silently disappears
- Host detail computes the fleet-wide snoozed-critical count via pure `reconcileTracking` over the full `loadIncidents()` set (zero-write on host render)

## Task Commits

1. **Task 1: Tracking-aware overview queue + banner + detail link** — `5c0fba3` (feat)
2. **Task 2: Mount fleet-wide snoozed-critical banner on host detail** — `a7d0d4c` (feat)
3. **Task 3: Operator visual gate** — verified live by the operator (approved).

## Files Created/Modified
- `src/app/(overview)/page.tsx` — reconcile threaded outside the memo; banner mounted
- `src/components/overview/QueueIsland.tsx` — reconciled `view` consumed; per-card `/incidents/[key]` deep-link
- `src/app/(overview)/hosts/[hostId]/page.tsx` — fleet-wide snoozed-critical banner (pure reconcile, zero-write)

## Decisions Made
- **Kept the overview's cut-aware assembly** instead of adopting `loadIncidents()` inside `buildOverviewData`: `loadIncidents` omits the 30-day `applyFreshnessCutoff`, so folding it would reintroduce the Phase-12 STALE flood or double warehouse reads. The reconcile threads onto the existing `GroupedIncident[]`; consequently the detail link lives in `QueueIsland.tsx`.

## Deviations from Plan
Task 1's suggested "adopt `loadIncidents()` in `buildOverviewData`" was intentionally not taken (freshness-cutoff reasoning above). All frontmatter must-haves satisfied: `reconcileAndGetView` outside the memo, banner on both surfaces, `view` passed to the queue, per-card detail link.

## Issues Encountered
- Full `npm test` is not green as a suite due to 25 pre-existing failures unrelated to this plan: `src/lib/queue/*` live-DB `permission denied` integration tests (no write-permissioned nodemon DB locally; documented in STATE.md 12-CLOSE) and `src/components/df/NavRailShell.test.tsx` asserting a `view-toggle` segmented control intentionally dropped in Phase-12 decision D-R7 (test drift; component untouched). All in-scope Phase-17 suites are green (221/221). `lint:noc-guard` clean, `tsc` clean.

## Operator Visual Gate
Approved. Automated checks green in scope; server smoke-tested (`/` 200, `/incidents/[bad]` 404, `/hosts` 200). Operator accepted phase closure.

## Next Phase Readiness
- Phase 17 incident lifecycle + AI explanation complete.
- Follow-up surfaced during review: service-health chips show an X with no "why" — `deriveServiceHealth` drops `service_health.detail`; next slice (Gap B) plumbs `detail` → chip tooltip, with the node-side probe reason (Gap A) as a separate follow-up.

---
*Phase: 17-incident-lifecycle-ai-explanation*
*Completed: 2026-07-21*
