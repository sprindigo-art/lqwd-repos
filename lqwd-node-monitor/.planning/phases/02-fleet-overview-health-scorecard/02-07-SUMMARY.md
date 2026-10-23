---
phase: 02-fleet-overview-health-scorecard
plan: 07
subsystem: ui
tags: [nextjs, rsc, app-router, intercepting-routes, tailwind-v4, scorecard, triage-console]

# Dependency graph
requires:
  - phase: 02-fleet-overview-health-scorecard (plan 02-05)
    provides: scorecard presentational components (GradeBadge, BackendBadge, CriticalChip, FreshnessStamp, OutlierMarker, DimensionRow) + globals.css theme tokens
  - phase: 02-fleet-overview-health-scorecard (plan 02-06)
    provides: loadFleetView() FleetView aggregate (D-09 sort, D-13 restart-excluded staleness floor, Canada golden suite)
provides:
  - Fleet triage console at / (FLEET-01) — criticals-first row list with dot/backend/alias/grade/%/reason/chips/freshness/outlier
  - Per-node 10-dimension scorecard at /{pubkey} (FLEET-02/03) with peer-relative reads and LDK no-peer-baseline
  - Scorecard-as-modal via Next.js intercepting route (@modal/(.)[pubkey]) with full-page fallback for deep links
  - Shared ScorecardPanel component consumed by both the modal and the full page
  - Phase-1 (status) page removed — bare lnd_node_info select no longer routable
affects: [phase-03 actions UI, ui-polish follow-up, any future fleet views]

# Tech tracking
tech-stack:
  added: [vendored shadcn dialog primitive (src/components/ui/dialog.tsx)]
  patterns:
    - "Intercepting route (@modal slot + (.)[pubkey]) for modal-over-list with deep-linkable full page"
    - "Shared ScorecardPanel rendered by both modal and full-page routes — single source for scorecard layout"
    - "Console theme: grid row-list (not shadcn Table) + mono micro-labels for dense operator triage"
    - "Pages render pre-computed FleetView verbatim — no color/grade re-derivation in JSX (T-02-07)"

key-files:
  created:
    - src/app/(overview)/page.tsx
    - src/app/(overview)/[pubkey]/page.tsx
    - src/app/(overview)/layout.tsx
    - src/app/(overview)/@modal/(.)[pubkey]/page.tsx
    - src/app/(overview)/@modal/default.tsx
    - src/components/scorecard/ScorecardPanel.tsx
    - src/components/scorecard/ScorecardModal.tsx
    - src/components/ui/dialog.tsx
  modified:
    - src/app/globals.css
    - src/components/scorecard/DimensionRow.tsx
    - src/components/scorecard/GradeBadge.tsx
    - src/components/scorecard/BackendBadge.tsx
    - src/components/scorecard/CriticalChip.tsx
    - src/components/scorecard/FreshnessStamp.tsx
    - src/components/scorecard/OutlierMarker.tsx
    - src/lib/scorecard/types.ts
    - src/lib/scorecard/grade.ts
  deleted:
    - src/app/(status)/page.tsx

key-decisions:
  - "Scorecard opens as a modal over the fleet list (intercepting route) while /{pubkey} stays a deep-linkable full page"
  - "Fleet rows render as a CSS grid row-list instead of shadcn Table — denser triage scanning, sticky leading cells under overflow"
  - "D-13 restart-exclusion ratified by operator approval: restart timestamp visible in the freshness breakdown, excluded from the staleness floor"
  - "Remaining visual polish deferred to .planning/todos/pending/ui-polish-fleet-console.md for a later /gsd-ui-review pass"

patterns-established:
  - "Modal + full-page dual rendering: @modal/(.)[pubkey] intercepts list-context clicks; direct navigation gets the standalone page"
  - "ScorecardPanel as the shared scorecard body — route files stay thin (validate, load, pick node, render)"
  - "Mono micro-label type scale (uppercase tracking-wider mono captions) extends the 02-05 token set for console chrome"

requirements-completed: [FLEET-01, FLEET-02, FLEET-03]

# Metrics
duration: ~30min execution + multi-session checkpoint round-trips
completed: 2026-06-09
---

# Phase 02 Plan 07: Operator UI — Fleet Overview + Per-Node Scorecard Summary

**Fleet triage console at / and per-node 10-dimension scorecard (full page + intercepting-route modal), replacing the Phase-1 status page — checkpoint approved with notes after a frontend-design redesign round.**

## Performance

- **Duration:** ~30 min of execution commits (20:10–20:41 PDT) plus human-verify checkpoint round-trips across sessions
- **Started:** 2026-06-09T20:10:37-07:00 (first commit)
- **Completed:** 2026-06-09T20:41:54-07:00 (last code commit; operator approval followed)
- **Tasks:** 3/3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 18 (857 insertions, 258 deletions)

## Accomplishments

- **FLEET-01:** / is now the curated triage console — one row per node with status dot, LND/LDK backend badge, alias + mono short pubkey, letter grade + %, reason subtext, conditional critical chips, stale markers, outlier markers, and freshness stamp, in the server-side D-09 order (criticals first, then worst grade). The Phase-1 (status) page and its bare `lnd_node_info` select are deleted.
- **FLEET-02/03:** /{pubkey} renders all 10 dimensions — 7 graded with dot/grade/%/raw value, peer marked partial, 3 greyed "no data — needs log ingestion" — with peer-relative reads and the LDK cohort's "No peer baseline yet" state. Pubkey regex-validated (`/^[0-9a-f]{66}$/`) before any data access (ASVS V5, T-02-04).
- **Redesign round (post-rejection):** deepened console theme in globals.css, restyled the scorecard as console tiles, extracted a shared `ScorecardPanel`, vendored the shadcn dialog primitive, and converted the scorecard into a modal via a Next.js intercepting route (`@modal/(.)[pubkey]`) while keeping the full page for deep links.
- **D-13 ratified:** restart's legitimately old timestamp is visible in the per-dimension freshness breakdown while remaining excluded from the headline staleness floor — explicitly signed off by the operator.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fleet overview at / + remove (status) page** — `6f65c58` (feat)
2. **Task 2: Per-node 10-dimension scorecard at /{pubkey}** — `9275e41` (feat)
3. **Task 3 (checkpoint redesign round, operator-directed):**
   - `23dd010` (feat) — deepen console theme, vendor dialog primitive
   - `df8013c` (refactor) — console tiles + shared ScorecardPanel extraction
   - `f3ef724` (feat) — scorecard opens as modal via intercepting route
   - `3ba148f` (feat) — fleet overview redesigned as triage console

## Files Created/Modified

- `src/app/(overview)/page.tsx` — FLEET-01 triage console RSC (force-dynamic), renders loadFleetView() verbatim, empty/error states per UI-SPEC copywriting contract
- `src/app/(overview)/[pubkey]/page.tsx` — FLEET-02/03 full-page scorecard; pubkey regex → notFound() before any query
- `src/app/(overview)/layout.tsx` — overview layout hosting the `@modal` parallel slot
- `src/app/(overview)/@modal/(.)[pubkey]/page.tsx` + `@modal/default.tsx` — intercepting route rendering the scorecard as a modal over the fleet list
- `src/components/scorecard/ScorecardPanel.tsx` — shared scorecard body (header + 10-dimension tile grid) used by both modal and full page
- `src/components/scorecard/ScorecardModal.tsx` — client dialog shell (router-back on dismiss)
- `src/components/ui/dialog.tsx` — vendored shadcn dialog primitive
- `src/app/globals.css` — console theme deepening + mono micro-label type-scale extension
- `src/components/scorecard/*.tsx` (02-05 components) — restyled for the console aesthetic (tiles, badges, chips)
- `src/lib/scorecard/types.ts`, `src/lib/scorecard/grade.ts` — minor type/extras surface additions supporting the page-level rawDisplay formatting
- `src/app/(status)/page.tsx` — **deleted** (intentional; route superseded by (overview), bare warehouse select removed)

## Decisions Made

- Scorecard presented as a modal from the fleet list (intercepting route) with /{pubkey} retained as a deep-linkable full page — operator-directed during the checkpoint redesign round.
- Fleet rows rendered as a CSS grid row-list instead of the planned shadcn Table — better density and sticky leading-cell behavior for triage scanning.
- D-13 restart-exclusion confirmed as the intended contract: visible in the freshness breakdown, excluded from the staleness floor.

## Checkpoint History (Task 3, human-verify)

1. **Initial rejection:** operator walked the 8-step script and rejected the first rendering — visual quality was below the bar for an operator console.
2. **Redesign round:** executed with the frontend-design skill — console theme deepening (`23dd010`), scorecard tiles + shared ScorecardPanel (`df8013c`), modal conversion via intercepting route (`f3ef724`), fleet view redesigned as a triage console (`3ba148f`). Verification re-run green: `tsc`, `npm run build`, vitest 131 passed / 14 skipped, 404s on invalid pubkeys confirmed, modal + deep links smoke-checked live.
3. **Approved with notes:** operator verdict — "still needs a lot of improvement but it's better than it was" — approved to unblock the phase. Remaining visual polish is tracked as a follow-up todo (`.planning/todos/pending/ui-polish-fleet-console.md` in the main checkout) for a later /gsd-ui-review pass. This approval **ratifies the D-13 restart-exclusion deviation** per the checkpoint's sign-off clause.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extras passthrough added to the scorecard view types**
- **Found during:** Task 2 (per-node scorecard)
- **Issue:** The page needed per-dimension extras (e.g., `earnings7dSat` for the revenue tooltip via formatSats) but the 02-06 view type didn't pass them through to the rendering layer
- **Fix:** Extended `src/lib/scorecard/types.ts` / `grade.ts` to pass extras through to ScorecardView so rawDisplay strings could be built in the page per AFM-002 (formatter-only)
- **Files modified:** src/lib/scorecard/types.ts, src/lib/scorecard/grade.ts
- **Verification:** tsc + build green; golden suite still passing
- **Committed in:** 9275e41 (Task 2 commit)

### User-Directed Deviations (checkpoint redesign round)

**2. Scope expansion into 02-05 components and globals.css**
- The checkpoint rejection led to operator-directed restyling of the 02-05 presentational components (GradeBadge, BackendBadge, CriticalChip, FreshnessStamp, OutlierMarker, DimensionRow) and globals.css theme deepening — files owned by plan 02-05, modified here at the operator's direction. Behavior contracts (props, D-07 color discipline) unchanged; styling only.

**3. Grid row-list replacing shadcn Table**
- The plan specified a shadcn Table for the fleet overview; the redesign replaced it with a CSS grid row-list for triage density. All row-content requirements (dot, badges, grade, chips, freshness, D-09 order, empty/error copy) preserved.

**4. Mono micro-label type-scale extension**
- Added an uppercase tracking-wide mono caption scale to globals.css beyond the 02-05 token set, to support the console chrome.

**5. D-13 restart-exclusion — RATIFIED**
- Carried from 02-06: restart's old timestamp excluded from the staleness floor but visible in the per-dimension breakdown. Explicitly ratified by the operator's checkpoint approval.

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking), 3 user-directed (redesign round), 1 ratified (D-13)
**Impact on plan:** Auto-fix was required for AFM-002 formatting; redesign deviations are styling/presentation only — all must_haves, security mitigations (T-02-04/02/05/07), and display contracts (D-05–D-13) intact. No data-layer changes.

## Issues Encountered

- First checkpoint rendering rejected on visual quality — resolved via the frontend-design redesign round (see Checkpoint History). No functional defects found during verification.

## Known Debt

- **UI polish:** the operator approved with notes; remaining visual refinement is deferred to `.planning/todos/pending/ui-polish-fleet-console.md` (main checkout) for a dedicated /gsd-ui-review pass. This is presentation-only debt — no stubs, no missing data wiring; every panel renders live FleetView data.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 02's operator-facing deliverable is live: / triage console + /{pubkey} scorecards over loadFleetView(), all FLEET requirements complete.
- ScorecardPanel and the intercepting-route modal pattern are reusable for Phase-3 action surfaces (recommendation cards, intent review).
- Outstanding: ui-polish-fleet-console todo for a later design pass; no blockers.

## Self-Check: PASSED

- All key files verified present in the worktree (pages, modal route, ScorecardPanel, dialog primitive); `src/app/(status)/page.tsx` confirmed deleted
- All 6 task commits verified on branch: 6f65c58, 9275e41, 23dd010, df8013c, f3ef724, 3ba148f
- Verification green at checkpoint resolution: tsc, `npm run build`, vitest 131 passed / 14 skipped, invalid-pubkey 404s, modal + deep links smoke-checked live
- No stubs: every panel renders live FleetView data; remaining work is presentation-only polish (tracked todo)

---
*Phase: 02-fleet-overview-health-scorecard*
*Completed: 2026-06-09*
