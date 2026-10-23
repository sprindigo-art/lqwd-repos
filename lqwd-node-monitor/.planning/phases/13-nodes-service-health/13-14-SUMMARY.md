---
phase: 13-nodes-service-health
plan: 14
subsystem: ui
tags: [nextjs, rsc, forwards, pagination, csv-export, drizzle, afm-002]

# Dependency graph
requires:
  - phase: 13-nodes-service-health
    provides: "forwardsPageData OFFSET-paginated reader (13-11), handleCsvExport shared handler (13-11), NodeDetailTabs (13-10)"
provides:
  - "/[pubkey]/forwards RSC sub-route — windowed (24h/7d/30d/90d) + server-side OFFSET-paginated forwarding-history log"
  - "NodeForwardsTable — forwards SummaryStrip + df table with chan→channels?chan interconnection (G2)"
  - "/[pubkey]/forwards/export — NODE-02 CSV export restored under the new static folder"
affects: [node-detail, channels-sub-route, csv-export]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Static sub-route folder shadows the dynamic [tab]/export route → sibling export segment delegates to shared handler (Pitfall 5)"
    - "URL ?window whitelist-mapped via WINDOW_PRESETS membership — the key is the SQL boundary, never a user string into an interval"
    - "Server-side OFFSET pagination surfaced through forwardsPageData; ?page clamped by parsePageParam"

key-files:
  created:
    - "src/components/node/NodeForwardsTable.tsx"
    - "src/components/node/NodeForwardsTable.test.tsx"
    - "src/app/(overview)/[pubkey]/forwards/page.tsx"
    - "src/app/(overview)/[pubkey]/forwards/export/route.ts"
  modified: []

key-decisions:
  - "Node resolved via latestNodeInfo(pubkey) (same reader the export handler uses) rather than the fleet view — leaner, and PERF-01-safe for >30d-stale nodes"
  - "NodeForwardsTable owns its own empty state (SummaryStrip + honest copy) so the page never branches on rows.length"
  - "Window selector links omit ?page so a window change resets to page 1; pager links carry the validated window key"

patterns-established:
  - "Two-gate validation for sub-routes: PUBKEY_RE → notFound() before any read, then node-resolve → notFound() on miss"
  - "AFM-002 in leaf tables: sats only via formatSats; the raw fee column is never read and no inline msat math appears"

requirements-completed: [NODE-04, NODE-02]

# Metrics
duration: ~10min
completed: 2026-07-09
---

# Phase 13 Plan 14: Forwards Sub-Route (windowed + paginated) Summary

**Routed `/[pubkey]/forwards` forwarding-history log — windowed (24h/7d/30d/90d), server-side OFFSET-paginated, each row's chan-in/chan-out linked to `/[pubkey]/channels?chan=`, with NODE-02 CSV export preserved under the new static folder.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-09T21:15:00Z
- **Completed:** 2026-07-09T21:19:00Z
- **Tasks:** 3
- **Files created:** 4

## Accomplishments
- Closed G1: forwarding history lives on its own code-split, deep-linkable RSC sub-route off the heavy single-scroll node page.
- Closed G2: every non-null chan-in / chan-out is a navy-structural `next/link` to the related channel (`/{pubkey}/channels?chan={chanId}`).
- Preserved NODE-02: `/{pubkey}/forwards/export` restored via a thin sibling route delegating to the shared `handleCsvExport(tab="forwards")` gauntlet.
- Every URL param format-validated before any read: PUBKEY_RE → node-resolve gauntlet; `?window` whitelist-mapped via WINDOW_PRESETS; `?page` clamped by parsePageParam.

## Task Commits

Each task was committed atomically:

1. **Task 1: NodeForwardsTable (chan → channels interconnection)** - `136a0c5` (feat)
2. **Task 2: Forwards RSC sub-route (windowed + paginated)** - `ceb4ce2` (feat)
3. **Task 3: Forwards CSV export route (static folder)** - `1ab35d8` (feat)

## Files Created/Modified
- `src/components/node/NodeForwardsTable.tsx` - Server component: forwards SummaryStrip + df table; chan cells link to `/{pubkey}/channels?chan=`; all sats via formatSats (AFM-002); honest empty state.
- `src/components/node/NodeForwardsTable.test.tsx` - renderToStaticMarkup test locking the chan href, null-chan dash, formatSats amt-out, and empty-window copy.
- `src/app/(overview)/[pubkey]/forwards/page.tsx` - force-dynamic RSC: two-gate validation, WINDOW_PRESETS whitelist, forwardsPageData fail-soft read, NavRailShell + NodeDetailTabs active=forwards, window selector, ExportButton, Prev/Next pager.
- `src/app/(overview)/[pubkey]/forwards/export/route.ts` - Thin GET delegating to handleCsvExport with tab pinned to "forwards".

## Decisions Made
- Resolved the node with `latestNodeInfo(pubkey)` (the same reader the shared export handler uses) instead of the heavier fleet view — leaner and PERF-01-safe for >30d-stale nodes.
- `NodeForwardsTable` renders the SummaryStrip in both populated and empty branches so the summary strip (counts/fees) is always honest even for an empty window.
- Window selector links omit `?page` (reset to page 1 on window change); pager links preserve `?window`.

## Deviations from Plan

None - plan executed exactly as written. Zero new package installs (T-13-14-SC satisfied).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Threat Surface
No new trust boundaries beyond the plan's threat register. `?window`/`?page` (T-13-14-01) mitigated by WINDOW_PRESETS membership + parsePageParam clamp; pubkey segment (T-13-14-02) by PUBKEY_RE before any read; forwards CSV export (T-13-14-03) by delegation to the shared handleCsvExport gauntlet.

## Next Phase Readiness
- The G2 `/{pubkey}/channels?chan=` deep-link target is emitted here; the channels sub-route (sibling wave work) consumes the `?chan` query param.
- Forwards is now a first-class Node-Detail surface reachable from NodeDetailTabs on every node page.

## Self-Check: PASSED

All 4 created files present on disk; all 3 task commits (136a0c5, ceb4ce2, 1ab35d8) present in git history.

---
*Phase: 13-nodes-service-health*
*Completed: 2026-07-09*
