---
phase: 12-ops-center-overview
plan: 12
subsystem: ui
tags: [nextjs, react, client-island, server-component, ttl-cache, drizzle, freshness-cutoff]

# Dependency graph
requires:
  - phase: 12-06
    provides: filter.ts (parseOverviewFacets + isomorphic applyFilter) + QueueFilters/AiBandClient islands
  - phase: 12-07
    provides: (overview)/page.tsx v2 Ops Center composition (5 reads → assemble → rollup → band)
  - phase: 12-08
    provides: freshness-cutoff.ts (30-day staleness eliminator)
  - phase: 12-09
    provides: incidents.ts fee-summary grouping + optional count/href/feeKind children
  - phase: 12-10
    provides: service-display.ts (serviceDisplay relabel map)
provides:
  - "Client-side filtering island (QueueIsland) — instant, re-fetch-free layer/severity toggles with URL sync"
  - "Constant-keyed short-TTL (~20s) in-process assembly memo mirroring engine.ts _insightViewCache"
  - "30-day freshness cutoff wired across nodes/hosts/chain/services BEFORE assembly + rollup (queue AND vitals denominators)"
  - "Service key-echo killed — entityLabel via serviceDisplay(), why carries the health reason not a name copy"
affects: [12-13, 12-14, 12-15, node-detail, host-detail]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Server-assemble-once → client-filter island: Server Component builds the full GroupedIncident[] (cached), a 'use client' island filters in-browser over the isomorphic applyFilter and syncs URL via window.history.replaceState (no router.push/refresh, no server round-trip)"
    - "Constant-keyed globalThis TTL memo (NOT unstable_cache, which JSON-serializes and loses Date stamps) collapsing concurrent callers onto one promise, evicting on rejection"
    - "Freshness cutoff applied to every layer array BEFORE assembleIncidents + rollupLayer so dead entities leave the queue AND the vitals denominators together"

key-files:
  created:
    - src/components/overview/QueueIsland.tsx
  modified:
    - src/app/(overview)/page.tsx
    - src/components/overview/QueueFilters.tsx
    - src/components/overview/QueueFilters.test.tsx
    - src/lib/overview/incidents.ts

key-decisions:
  - "Filtering moved from URL <Link> navigation (re-ran all 5 warehouse reads ~8s per toggle) to in-browser client state over the already-loaded incident set — instant and re-fetch-free"
  - "Assembly cached via constant-keyed globalThis TTL memo (~20s), NOT unstable_cache, to preserve the Date stamps the cards/views carry"
  - "30-day cutoff applied to nodes/hosts/chain/services + rankedCards filtered to surviving pubkeys BEFORE assembly + rollup, eliminating dead entities from both the queue and the vitals denominators"
  - "Service child entityLabel set via serviceDisplay().label; why carries the distinct health reason (or left undefined), never a second echo of the raw key"

patterns-established:
  - "Server-assemble-once, client-filter island: pure isomorphic view module reused verbatim in the browser, URL sync via history.replaceState only"
  - "TTL-memo over reads+assembly keyed by a CONSTANT independent of searchParams"

requirements-completed: [OVW-01, OVW-03, OVW-05]

# Metrics
duration: ~2 min (continuation finalization; Tasks 1-2 committed 2026-07-01)
completed: 2026-07-02
---

# Phase 12 Plan 12: Client-Side Filter Island + Assembly Cache + 30-Day Cutoff Wiring Summary

**Instant, re-fetch-free overview filtering via a QueueIsland client island over a constant-keyed ~20s assembly memo, with the 30-day cutoff wired into both the queue and the vitals denominators and the service key-echo killed.**

## Performance

- **Duration:** ~2 min (continuation finalization; Task 1 & 2 code committed 2026-07-01 in the prior execution window)
- **Started:** 2026-07-01 (Tasks 1-2) / 2026-07-02 (checkpoint disposition + close-out)
- **Completed:** 2026-07-02
- **Tasks:** 3 (2 auto + 1 checkpoint:human-verify)
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- Moved filter toggling from URL-navigation (which re-ran all 5 warehouse reads ~8s each click) to in-browser client state — the queue narrows instantly with no server round-trip and the URL stays reload/share-safe via `window.history.replaceState`.
- Wrapped the 5 reads + assembly in a constant-keyed globalThis TTL memo (~20s) mirroring `engine.ts` `_insightViewCache`, collapsing concurrent callers and evicting on rejection — cold/warm loads stop re-running everything.
- Wired `applyFreshnessCutoff` across nodes/hosts/chain/services and filtered ranked cards to surviving pubkeys BEFORE `assembleIncidents`/`rollupLayer`, so long-dead entities (no data in 30 days) vanish from BOTH the attention queue and the Fleet Vitals denominators.
- Killed the service key-echo: the service child's `entityLabel` renders via `serviceDisplay().label` ("Address List Sync") while `why` carries the distinct health reason, so the raw machine key (`addressBalances`, `esplora`, `nodeAuditor`) appears nowhere on screen.

## Task Commits

1. **Task 1: Cache reads+assembly, apply 30-day cutoff, delegate queue to island** — `d95c68c` (feat)
2. **Task 2: QueueIsland client island + onToggle QueueFilters + service relabel** — `5cf9274` (feat)
3. **Task 3: Operator verification (checkpoint:human-verify)** — resolved by operator disposition (see below); no code.

**Plan metadata:** this SUMMARY + STATE.md + ROADMAP.md (docs commit)

## Files Created/Modified
- `src/components/overview/QueueIsland.tsx` (created) — `"use client"` island holding facet state, deriving the view with the isomorphic `applyFilter`, rendering hero + queue + filtered-empty, syncing the URL via `history.replaceState` (no `router.push/replace/refresh`).
- `src/app/(overview)/page.tsx` (modified) — reworked into a cached, freshness-cut server composition; keeps `force-dynamic` + `revalidate=0` + per-read `.catch`; delegates the filtered queue to `<QueueIsland>`; no `"use client"`, no `.sort`.
- `src/components/overview/QueueFilters.tsx` (modified) — added optional `onToggle` (renders `<button>` firing the client toggle, no nav) while keeping the `<Link>` back-compat path; navy-structural chrome + `severityLabel` chip text preserved.
- `src/components/overview/QueueFilters.test.tsx` (modified) — added the onToggle-path assertion alongside the existing `<Link>` cases.
- `src/lib/overview/incidents.ts` (modified) — service child `entityLabel` via `serviceDisplay().label`; `why` = health reason (or undefined), never a key echo.

## Decisions Made
- **Filter on the client, not via URL navigation.** `filter.ts` is already pure/isomorphic, so the island reuses it verbatim; toggling is client state only, URL sync is `history.replaceState` (reload/share-safe) with no server re-fetch.
- **Constant-keyed TTL memo, not `unstable_cache`.** `unstable_cache` JSON-serializes and would drop the `Date` stamps the cards/views carry; the globalThis memo keyed by a constant (independent of searchParams) preserves them.
- **Cutoff before assembly + rollup.** Applying `applyFreshnessCutoff` (and filtering ranked cards to surviving pubkeys) upstream of both `assembleIncidents` and `rollupLayer` guarantees dead entities leave the queue and the denominators together, not just one.

## Deviations from Plan

None - plan executed exactly as written. (No Rule 1-4 auto-fixes; zero package installs, per the T-12-12-SC accept disposition.)

## Issues Encountered

None during Tasks 1-2. During the Task 3 operator verification checkpoint, the operator surfaced a broader set of overview problems (see Known Follow-ups) that were routed to an approved redesign rather than fixed in this plan.

## Checkpoint Disposition (Task 3 — human-verify)

**Operator disposition: ACCEPTED for 12-12's committed scope.** The perf rework (client-side filtering + instant no-refetch toggles), the ~20s assembly cache, the 30-day cutoff wiring across queue + vitals denominators, and the service relabel/key-echo kill are all accepted — build green, automated gates passed (`tsc --noEmit` clean, `next build` succeeds, QueueFilters vitest green, security greps clean: no `router.push/replace/refresh` in the island, URL sync via `history.replaceState`).

During verification the operator identified a broader set of overview problems (card density, service grouping/dedup, layer-filter taxonomy, layout order, nav, top-bar) that led to an **APPROVED REDESIGN** (`.planning/phases/12-ops-center-overview/12-REDESIGN-SPEC.md`, approved 2026-07-01). Those items are NOT defects in 12-12's delivered perf/cutoff/relabel work — they are deliberately assigned to the rewritten redesign plans.

## Known Follow-ups

These are tracked in `.planning/phases/12-ops-center-overview/12-REDESIGN-SPEC.md` (APPROVED) and its plan breakdown — NOT regressions in 12-12's committed scope:

- **Layer-filter taxonomy bug** ("filtering services/hosts shows nothing"; "nodes confused with hosts"). Root cause is in the incident/layer model + `applyFilter` matching only the TOP-LEVEL incident's `layer` (grouped cards carry `layer:"hosts"`), plus service dedup/orphan-attach in `incidents.ts`. Assigned to **rewritten plan 12-13** (Taxonomy & tree-aware filter — dedup + owner-attach + unattributed bucket + tree-aware `applyFilter`). This is explicitly NOT 12-12's perf rework.
- **Card density, service grouping/dedup, one-card-per-owner, condensed cards & rows** — assigned to **rewritten plan 12-14** (Card & row rebuild).
- **Layout section order (vitals-first), NavRailShell operator nav (Inbox/Pending/Queue), honest ticking data-age, remove fake "Live" + Preview toggle** — assigned to **new plan 12-15** (Layout + chrome).

Recording 12-12 as COMPLETE for its own committed scope is bookkeeping honesty: the perf/cutoff/relabel deliverables shipped and passed their gates; the taxonomy + card/layout/chrome redesign is owned by 12-REDESIGN-SPEC.md and plans 12-13/12-14/12-15.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The Phase-12 data engine (severity-map, incidents assembly, fee-grouping, 30-day cutoff, assembly cache, client-filter mechanism) is intact and reusable — the redesign is presentation + taxonomy, not a re-derivation of data (12-REDESIGN-SPEC D-R9).
- Ready for 12-13 (data: taxonomy & tree-aware filter) → 12-14 (UI: card & row rebuild) → 12-15 (UI: layout + chrome).

## Threat Flags

None - no new security surface introduced. The island is view + filter + URL only (no action affordance, no command path); the advisory-only invariant (T-12-12-04) holds. Zero package installs (T-12-12-SC).

---
*Phase: 12-ops-center-overview*
*Completed: 2026-07-02*

## Self-Check: PASSED

- Files verified on disk: QueueIsland.tsx, page.tsx, QueueFilters.tsx, incidents.ts, 12-12-SUMMARY.md — all FOUND.
- Commits verified in git log: d95c68c (FOUND), 5cf9274 (FOUND).
