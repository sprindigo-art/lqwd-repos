---
phase: 18-hardening-vm-deploy-v1-v2
plan: 04
subsystem: ui
tags: [nextjs, react, tailwind, hydration, accessibility, honest-stale, lint-guard]

# Dependency graph
requires:
  - phase: 18-01
    provides: honest-stale read-model primitives (FreshnessChip / FreshnessStamp / PollAge, deriveStale, freshness-cutoff)
provides:
  - Real-counts-only NavRailShell fleet summary (no fabricated all-clear ramp during live criticals)
  - Honest "no data yet" poll stamp when no fetch epoch exists (no fake "Live · polled 0s ago")
  - loadFleetCounts() all-layer reducer feeding real top-bar counts to incident- and host-detail pages
  - df-faint content sweep (~59 sites) + scripts/df-faint-guard.sh build-time regression guard
  - (overview)/loading.tsx + error.tsx honest in-shell boundaries
  - FreshnessChip now-prop hydration-mismatch fix
affects: [ui-hardening, vm-deploy, accessibility-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "df-faint-ok opt-out marker + grep guard: forbid a sub-contrast token on content text, allow marked decorative glyphs"
    - "Real-counts-required shell: summary renders only when the page supplies real counts (no fabricated baseline)"
    - "suppressHydrationWarning ONLY on the new Date() fallback path (explicit now renders unsuppressed)"

key-files:
  created:
    - src/lib/overview/fleet-counts.ts
    - scripts/df-faint-guard.sh
    - src/app/(overview)/loading.tsx
    - src/app/(overview)/error.tsx
  modified:
    - src/components/df/NavRailShell.tsx
    - src/components/df/FreshnessChip.tsx
    - src/app/(overview)/incidents/[incidentKey]/page.tsx
    - src/app/(overview)/hosts/[hostId]/page.tsx
    - package.json

key-decisions:
  - "Guard forbids text-df-faint on content text; decorative aria-hidden glyphs opt out via a same-line df-faint-ok marker (only 2 SVG icon glyphs kept)"
  - "loadFleetCounts() mirrors the overview all-layer reducer (30-day cutoff, fail-soft, 20s memo) so a downed host with healthy nodes never reads all-ok; total read failure returns undefined and the shell omits the summary honestly"
  - "FreshnessChip suppresses only the relative-age hydration drift on the new Date() fallback; an injected now (tests/deterministic SSR) renders with no suppression"

patterns-established:
  - "df-faint-ok / df-faint-guard: token-legibility guard wired into npm run lint (lint:df-faint)"
  - "Honest in-shell loading/error boundaries keep the NavRailShell rail mounted and never echo raw errors"

requirements-completed: [HARDEN-03, HARDEN-01]

# Metrics
duration: 15min
completed: 2026-07-27
---

# Phase 18 Plan 04: Honest chrome — no fabricated healthy states, legible honest-state text Summary

**Removed the fabricated all-clear fleet ramp + fake "Live" pill from NavRailShell (real counts now required), swept ~59 sub-contrast text-df-faint content sites to text-df-muted behind a new build-time grep guard, added honest (overview) loading/error boundaries, and fixed the FreshnessChip now-prop hydration mismatch.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-27T09:07Z
- **Completed:** 2026-07-27T09:22Z
- **Tasks:** 2 / 2
- **Files modified:** 37 (4 created, 33 modified)

## Accomplishments
- `DEFAULT_COUNTS {ok:26}` deleted — the fleet summary renders ONLY with real counts, so no solid-green "26 ok" ramp can render during live criticals (U2).
- Undefined `pollSinceMs` now renders an honest "no data yet" stamp; the static "Live · polled Ns ago" pill is confined to an explicit `pollAgeSeconds` (the gallery only) (U3).
- New `loadFleetCounts()` all-layer loader feeds real top-bar counts to the incident- and host-detail pages (fail-soft, 30-day cutoff, 20s memo).
- Swept ~59 meaning-bearing `text-df-faint` usages to `text-df-muted`; `scripts/df-faint-guard.sh` now fails the build on `text-df-faint` over content text, with a `df-faint-ok` opt-out for the 2 remaining aria-hidden icon glyphs (U1).
- Added `(overview)/loading.tsx` + `error.tsx` honest in-shell boundaries (rail stays mounted; the error boundary never echoes the raw error and offers a `reset()`).
- Fixed the `FreshnessChip` `now`-prop hydration mismatch (suppress only the `new Date()` fallback drift).

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove fabricated fleet ramp + fake LivePollPill (U2, U3)** — `cc454ef` (fix)
2. **Task 2: df-faint content sweep + grep guard + loading/error + hydration fix (U1)** — `603d23f` (fix)

## Files Created/Modified
- `src/lib/overview/fleet-counts.ts` (created) — all-layer real fleet-counts loader for detail-page top bars (fail-soft, 30-day cutoff, 20s memo, returns undefined on total failure)
- `scripts/df-faint-guard.sh` (created) — grep guard forbidding `text-df-faint` on content text; `df-faint-ok` marker opts out decorative glyphs; wired into `npm run lint`
- `src/app/(overview)/loading.tsx` (created) — honest in-shell Suspense boundary (rail + honest "reading" copy, no fabricated data)
- `src/app/(overview)/error.tsx` (created, "use client") — honest in-shell error boundary (no raw-error echo, `reset()` retry)
- `src/components/df/NavRailShell.tsx` — removed `DEFAULT_COUNTS`; summary renders only with real counts; honest no-data poll stamp; ViewToggle label swept to muted
- `src/components/df/FreshnessChip.tsx` — hydration-safe relative-age (suppress only the fallback), no-data stamp swept to muted
- `src/app/(overview)/incidents/[incidentKey]/page.tsx`, `.../hosts/[hostId]/page.tsx` — pass real `counts={loadFleetCounts()}`
- `package.json` — added `lint:df-faint`, chained into `lint`
- ~28 further components/pages — `text-df-faint` → `text-df-muted` content sweep (FreshnessStamp, QueueTimeline, DetailDrawer, BatchConfirmDialog, ApprovePanel, SeverityHeroCard, HostCard, OnHostNodes, NodesTable, EnqueuePreview, etc.)
- `src/components/df/NavRailShell.test.tsx` — no-fabrication invariants; view-toggle fixtures opt in via `showViewToggle`

## Decisions Made
- **Guard shape:** forbid `text-df-faint` on content text, allow a same-line `df-faint-ok` marker for genuinely decorative aria-hidden glyphs — only 2 SVG icon glyphs (CategoryIcon, ServiceWhyAccordion Chevron) retained it; disclosure triangles and all values/labels went to muted.
- **Detail-page counts:** duplicated (not imported) the overview per-layer severity reducers in `fleet-counts.ts` because `(overview)/page.tsx` does not export them; documented for later consolidation.
- **Hydration:** used the codebase's sanctioned `suppressHydrationWarning` idiom (matching PollAge) rather than forcing every caller to inject `now`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 4 pre-existing NavRailShell view-toggle test failures**
- **Found during:** Task 1 (NavRailShell test update)
- **Issue:** The view-toggle is deliberately default-off, but 4 tests rendered without `showViewToggle` and asserted the toggle present — failing since the shell rework (logged as a deferred item at 18-03 close).
- **Fix:** Fixtures now opt in via `showViewToggle: true`; the honest no-data-stamp test replaces the old "defaults to 0s" assertion.
- **Files modified:** src/components/df/NavRailShell.test.tsx
- **Verification:** `vitest run` — full suite 1486 pass / 57 skip (was 4 failing).
- **Committed in:** cc454ef (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug). **Impact:** cleared a pre-existing red test that would otherwise mask regressions; no scope creep.

## Issues Encountered
- **Pre-existing ESLint failures block `npm run lint` (OUT OF SCOPE):** the base commit (02f0a99) already fails ESLint with 10 errors — react-hooks v6 `react-hooks/purity` (`Date.now()`/`new Date()` read in render), one setState-in-effect, one legacy `ReactDOM.render`, one `no-assign-module-variable`. All live in files this plan did not create or behaviourally modify (e.g. `ServiceHealthGrid.tsx:138`, untouched; verified identical on base). Every file this plan created or modified lints clean, and the new `scripts/df-faint-guard.sh` passes exit 0 standalone (`npm run lint:df-faint`). Logged to `deferred-items.md` for a dedicated follow-up (inject `now` as a prop fleet-wide + migrate legacy `ReactDOM.render`). NOT fixed here per the scope boundary.
- The bulk df-faint sweep was applied via a Python line-filter (skip test files, comment lines, and `df-faint-ok`-marked lines) after two zsh globbing attempts silently no-op'd on parenthesized `(overview)` paths.
- Prettier initially split a JSX-comment `df-faint-ok` marker onto its own line (breaking the same-line guard rule); resolved by making that decorative triangle muted (consistent with its level-1 sibling), leaving only in-`className` expression-comment markers that prettier keeps inline.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Honest chrome shipped: no fabricated healthy states, legible honest-state text, build-time regression guard in place.
- Full test suite green (1486 pass / 57 skip); typecheck clean; df-faint guard green; every touched file lints clean.
- Follow-up recommended (deferred-items.md): a hardening plan to satisfy the pre-existing `react-hooks/purity` errors fleet-wide so `npm run lint` is green end-to-end.

---
*Phase: 18-hardening-vm-deploy-v1-v2*
*Completed: 2026-07-27*

## Self-Check: PASSED

All created files present (fleet-counts.ts, df-faint-guard.sh, loading.tsx, error.tsx, 18-04-SUMMARY.md); both task commits (cc454ef, 603d23f) exist.
