---
phase: 12-ops-center-overview
plan: 11
subsystem: ui
tags: [chrome, layout, next-app-router, route-group, info-leak, shadcn]

# Dependency graph
requires:
  - phase: 12-ops-center-overview
    provides: "12-07 overview page assembled on NavRailShell (the v2 OverviewShell chrome for /)"
provides:
  - "ConsoleMasthead — reusable Server-Component masthead (LQWD wordmark + Node Operations + MastheadNav), no routing_vm literal"
  - "Reduced shared (overview)/layout.tsx — container + @modal slot only, no stacked masthead"
  - "v1 sibling pages (inbox/pending/queue/[pubkey]/[tab]) self-mount ConsoleMasthead so they keep their chrome"
affects: [12-12, 12-13, 12-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-page chrome mounting: a shared route-group layout carries ONLY the container + slots; masthead is a component each v1 page mounts, so the v2 overview can render its own single chrome (NavRailShell) without a stacked header"

key-files:
  created:
    - src/components/chrome/ConsoleMasthead.tsx
  modified:
    - src/app/(overview)/layout.tsx
    - src/app/(overview)/inbox/page.tsx
    - src/app/(overview)/pending/page.tsx
    - src/app/(overview)/queue/page.tsx
    - src/app/(overview)/[pubkey]/[tab]/page.tsx

key-decisions:
  - "routing_vm warehouse DB-name literal deleted entirely from chrome (T-12-11-01 / CLAUDE.md forbids exposing connection details) — not reintroduced in ConsoleMasthead; grep gate asserts zero occurrences"
  - "(overview)/[pubkey]/page.tsx is a pure redirect (notFound/redirect to /{pubkey}/scorecard, renders no document) — ConsoleMasthead deliberately NOT mounted there per the plan's redirect-skip rule; the visible chrome lands on the [tab] page it redirects to"
  - "Overview / keeps ONLY NavRailShell — page.tsx does not import ConsoleMasthead"

patterns-established:
  - "Shared route-group layout = container + slots only; chrome that a subset of children need is a mountable component, not a layout-wide header"

requirements-completed: [OVW-01]

# Metrics
duration: 6min
completed: 2026-06-30
---

# Phase 12 Plan 11: Reconcile Masthead Double-Chrome + Remove routing_vm Leak Summary

**Extracted the shared masthead into a reusable `ConsoleMasthead` component, stripped it (and the `routing_vm` DB-name literal) from `(overview)/layout.tsx`, and remounted it on the v1 sibling pages — so `/` now renders exactly one chrome (NavRailShell) while inbox/pending/queue/node pages keep their masthead.**

## Performance

- **Duration:** ~6 min (execution) + operator verification window
- **Completed:** 2026-06-30
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments
- One honest chrome per surface: `/` shows only the NavRailShell rail + top bar (no stacked LQWD/"Node Operations" masthead above it).
- `routing_vm` warehouse DB-name info-leak removed everywhere in the chrome (backlog #7 / T-12-11-01) — `grep -rn routing_vm src/app src/components` returns zero.
- v1 sibling surfaces (inbox, pending, queue, node `[pubkey]/[tab]`) retain their wordmark + nav via `<ConsoleMasthead />`, visually unbroken; the `@modal` intercept slot is untouched and still opens the quick-look overlay.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract ConsoleMasthead, strip shared layout, remove routing_vm leak** - `d6445a3` (refactor)
2. **Task 2: Mount ConsoleMasthead in the v1 sibling pages** - `8d4d8a7` (feat)
3. **Task 3: Operator visual verification (human-verify checkpoint)** - APPROVED, no code (see below)

**Plan metadata:** committed with this SUMMARY (docs: complete plan)

## Operator Verification (Task 3 — checkpoint:human-verify, blocking)

The blocking visual gate was presented and the operator responded **APPROVED** (verbatim). Confirmed live:
- Exactly ONE chrome on `/` (NavRailShell), no masthead stacked above it, no `routing_vm` text.
- `/inbox`, `/pending`, `/queue`, and node pages retain the LQWD wordmark + "Node Operations" + FLEET/INBOX/PENDING nav, visually unbroken.
- Node modal (intercepted `(.)[pubkey]`) still opens from `/` — layout `{modal}` slot intact.

## Files Created/Modified
- `src/components/chrome/ConsoleMasthead.tsx` - Extracted masthead (wordmark + "Node Operations" + `<MastheadNav />`), Server Component, no `routing_vm` literal.
- `src/app/(overview)/layout.tsx` - Reduced to the `min-h-screen` wrapper + `max-w-6xl` container around `{children}` + `{modal}` slot; `<header>`/`MastheadNav`/`routing_vm` removed.
- `src/app/(overview)/inbox/page.tsx` - Mounts `<ConsoleMasthead />` at the top of its tree.
- `src/app/(overview)/pending/page.tsx` - Mounts `<ConsoleMasthead />`.
- `src/app/(overview)/queue/page.tsx` - Mounts `<ConsoleMasthead />`.
- `src/app/(overview)/[pubkey]/[tab]/page.tsx` - Mounts `<ConsoleMasthead />` (the node scorecard/tab surface).

## Decisions Made
- Deleted the `routing_vm` literal outright rather than masking it — CLAUDE.md forbids exposing connection details; ConsoleMasthead never reintroduces it.
- Kept `(overview)/page.tsx` (overview `/`) free of ConsoleMasthead — NavRailShell is its single chrome by design.

## Deviations from Plan

The plan listed five v1 pages to mount ConsoleMasthead; four were mounted. `(overview)/[pubkey]/page.tsx` was **deliberately skipped** — it is a pure redirect (regex-validate pubkey → `notFound()` or `redirect('/{pubkey}/scorecard')`) that renders no document, so it has no chrome to carry. This is exactly the redirect-only skip the plan's action text sanctioned ("If a page returns a fragment/redirect with no visible shell … skip mounting there and note it in the summary"). The visible masthead lands on the `[tab]` page the redirect resolves to. Not a defect; no scope change.

**Total deviations:** 1 (sanctioned redirect-only skip, documented per plan instruction).
**Impact on plan:** None — all three must-have truths hold (one chrome on `/`, siblings retain masthead, zero `routing_vm`).

## Operator Follow-up (routed to 12-14, NOT a 12-11 defect)

During the visual gate the operator raised a **separate** observation: the overview `/` (NavRailShell) has **no navigation links** to `/inbox`, `/pending`, or `/queue`. This is out of 12-11's scope — 12-11's charter was chrome de-duplication + `routing_vm` removal, both of which are correct and verified. The missing cross-surface navigation has been **deliberately routed to plan 12-14** (which edits NavRailShell). Recorded here so the trail is unambiguous: **operator follow-up routed to 12-14 — not a 12-11 defect.**

## Issues Encountered
None — continuation finalization; both auto tasks were already committed and verified, the checkpoint was approved.

## Next Phase Readiness
- 12-11 closed. ConsoleMasthead + reduced layout are available to 12-12/12-13/12-14.
- 12-14 owns the NavRailShell navigation-link gap surfaced during this gate.

## Self-Check: PASSED

- FOUND: src/components/chrome/ConsoleMasthead.tsx
- FOUND: .planning/phases/12-ops-center-overview/12-11-SUMMARY.md
- FOUND commit: d6445a3
- FOUND commit: 8d4d8a7

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*
