---
phase: 17-incident-lifecycle-ai-explanation
plan: 04
subsystem: ui
tags: [incidents, server-only, drizzle, next-app-router, refactor, vitest]

# Dependency graph
requires:
  - phase: 12-ops-center-overview
    provides: "assembleIncidents cross-layer incident tree + GroupedIncident contract"
  - phase: 14-hosts-infra-monitoring
    provides: "host detail page (/hosts/[hostId]) + its inline assemble pipeline"
provides:
  - "loadIncidents() — the ONE server-only incident-assembly loader (INC-01)"
  - "host detail page deduped onto the shared loader, selecting by .key"
  - "the .key-not-.hostId selection contract pinned by test for all future consumers"
affects: [17-ai-explanation, 17-incident-detail, overview-page-plan-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "single server-only read+assemble loader shared by UI + AI narrate (payload byte-identical, AI-SPEC FM-2)"
    - "vi.hoisted + whole-module vi.mock to unit-test a server-only loader with real pure core (assembleIncidents/rankCards)"

key-files:
  created:
    - src/lib/overview/load-incidents.ts
    - src/lib/overview/load-incidents.test.ts
  modified:
    - src/app/(overview)/hosts/[hostId]/page.tsx

key-decisions:
  - "loadIncidents() is self-contained: it reads its own hosts dimension (getLatestHostMetrics) rather than taking args, so the AI narrate action can call it with zero setup for a byte-identical payload"
  - "host page keeps its own getLatestHostMetrics call for the membership gate + non-incident sections; the loader's internal hosts read is an accepted temporary duplicate until Plan 09 folds the overview onto the loader"
  - "lifted the pipeline verbatim (no 30-day applyFreshnessCutoff) to preserve host-page behavior; cutoff adoption is Plan 09 overview scope, not a host-page behavior change"

patterns-established:
  - "GroupedIncident selection is ALWAYS by .key (host_id / card id / fleet); .hostId does not exist and silently misses"
  - "engine order is law — the loader never sorts; assembleIncidents owns all grouping/ordering"

requirements-completed: [INC-01]

# Metrics
duration: ~12min
completed: 2026-07-20
---

# Phase 17 Plan 04: Shared loadIncidents() Loader Summary

**One server-only `loadIncidents()` now assembles the `GroupedIncident[]` the overview, host detail, and AI narrate action all consume — and the host detail page is deduped onto it, selecting by `.key` (not the `.hostId` footgun).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-20T11:10:00Z
- **Completed:** 2026-07-20T11:14:00Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Extracted the copy-pasted fail-soft read+assemble pipeline into `src/lib/overview/load-incidents.ts` — `import "server-only"`, no `.sort`, engine order preserved.
- Pinned the loader contract with `load-incidents.test.ts`: returns the assembled tree, selects a host by `.key`, a bogus key returns `undefined`, all-clear returns `[]`, and a rejected read degrades fail-soft to `[]` (reads mocked, `assembleIncidents`/`rankCards` real).
- Rewired the host detail page onto `(await loadIncidents()).find((i) => i.key === hostId)`, removing the inline `assembleIncidents(...)` block and its now-dead `loadInsightView`/`rankCards`/`insightView` reads while keeping the fail-soft try/catch and `notFound()`-outside-try control flow intact.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract loadIncidents() shared server loader** - `25142e5` (feat)
2. **Task 2: Rewire host detail page onto loadIncidents** - `4b5c825` (refactor)

## Files Created/Modified
- `src/lib/overview/load-incidents.ts` - server-only `loadIncidents(): Promise<GroupedIncident[]>`; fail-soft reads hosts/chain/fleet/insight/services, ranks cards, delegates to `assembleIncidents` (no re-sort).
- `src/lib/overview/load-incidents.test.ts` - 3 tests locking the assembled return, `.key` selection + bogus-key `undefined`, all-clear empty queue, and fail-soft degrade.
- `src/app/(overview)/hosts/[hostId]/page.tsx` - inline assemble pipeline replaced with the shared loader; dead insight imports removed; membership gate + other sections unchanged.

## Decisions Made
- **Self-contained loader (no args):** `loadIncidents()` reads its own hosts dimension so the AI narrate action gets a byte-identical payload with zero wiring. Rationale: the faithfulness invariant (AI-SPEC FM-2) requires the AI to explain exactly what the UI shows.
- **Verbatim lift, no freshness cutoff:** preserved host-page behavior exactly; the overview's `applyFreshnessCutoff` adoption belongs to Plan 09, not this dedup.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial test used top-level `const` mock fns referenced inside hoisted `vi.mock` factories → "Cannot access before initialization". Resolved by moving the fn handles into a `vi.hoisted(() => ({...}))` block (standard vitest hoisting fix). No source change; test-only.

## Threat Model Compliance
- **T-17-08 (info disclosure):** host detail still membership-gates via `.find((i) => i.key === hostId)` and `notFound()` outside the try — unchanged and preserved.
- **T-17-09 (tampering):** loader is `import "server-only"`, warehouse reads are SELECT-only, engine order preserved (no re-derivation drift).
- **T-17-SC (supply chain):** zero new packages installed.

## Next Phase Readiness
- `loadIncidents()` is ready to back the AI narrate action and the Incident Detail page (same-source payload guaranteed).
- Plan 09 can fold the overview page onto `loadIncidents()` and add the 30-day freshness cutoff into the shared loader (currently host-page-parity, cutoff-free).

## Self-Check: PASSED

- Files verified on disk: `load-incidents.ts`, `load-incidents.test.ts`, `17-04-SUMMARY.md`.
- Commits verified in git log: `25142e5` (Task 1), `4b5c825` (Task 2).

---
*Phase: 17-incident-lifecycle-ai-explanation*
*Completed: 2026-07-20*
