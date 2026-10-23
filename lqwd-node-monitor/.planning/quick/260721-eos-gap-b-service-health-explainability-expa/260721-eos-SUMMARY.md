---
phase: quick-260721-eos
plan: 01
subsystem: service-health-ui
tags: [gap-b, service-health, explainability, accordion, noc, honesty]
requires:
  - deriveServiceHealth two-axis read (TEL-02)
  - TwoAxisPip locked service tile
provides:
  - ServiceHealthState.detail + detectionMethod (both derivation branches)
  - ServiceWhyAccordion honest why-panel client component
affects:
  - ServiceHealthGrid, NodeSupportingServices, HostCard, OnHostNodes
  - hosts list page + host-detail page service/script mappers
tech-stack:
  added: []
  patterns:
    - dep-free renderToStaticMarkup + defaultOpen render-test (no jsdom)
    - additive not-green gating (!green && !noData) — green/no-data rows unchanged
    - honest null-detail fallback ("Probe reported no reason") + "never" last-success
key-files:
  created:
    - src/components/df/ServiceWhyAccordion.tsx
    - src/components/df/ServiceWhyAccordion.test.tsx
  modified:
    - src/lib/read/service-health.ts
    - src/lib/read/service-health.test.ts
    - src/components/node/ServiceHealthGrid.tsx
    - src/components/node/NodeSupportingServices.tsx
    - src/components/host/HostCard.tsx
    - src/components/host/OnHostNodes.tsx
    - src/app/(overview)/hosts/page.tsx
    - src/app/(overview)/hosts/[hostId]/page.tsx
decisions:
  - Accordion (locked operator decision) — not a tooltip, not an always-visible line
  - detail is honestly NULL-able; consumers render a fallback, never a fabricated reason
  - relativeAge is self-contained in the accordion (no server/page import)
metrics:
  tasks: 3
  files-changed: 10
  completed: 2026-07-21
requirements: [GAP-B]
---

# Phase quick-260721-eos Plan 01: Gap B — Service-Health Explainability Accordion Summary

Not-green service rows across the fleet/host surfaces are now expandable into an honest
"why is this down" panel: probe detail verbatim when present, an honest fallback plus the
real error_count and last-success age when detail is NULL (the live LND fleet state).

## What was built

- **Read layer (Task 1):** `ServiceHealthState` now carries `detail` (honestly nullable
  probe reason) and `detectionMethod` (inventory-side, always present). Both are populated
  in BOTH `deriveServiceHealth` branches — the no-data branch (`collected_at == null`) and
  the main branch — passing `row.detail` / `row.detection_method` through raw (no coercion).
  Every pre-existing field (errorCount, lastSuccessAt, stale flags) is untouched.

- **ServiceWhyAccordion (Task 2):** a `"use client"` expandable accordion. A full-width
  button trigger wraps the caller's row (`children`) with a chevron affordance; below it a
  bordered inset panel renders the reason (probe `detail` verbatim, else the honest
  `NO_REASON_FALLBACK = "Probe reported no reason"`), a detection-method mono chip, the raw
  `errors · 1h` count (TwoAxisPip's >5/>0/0 color grammar), a `last success` row humanized
  to "…ago" or **"never"** when null, and functioning-stale / collector-stale indicators
  gated by their flags. `defaultOpen` mirrors NodeFeeEnqueue so the dep-free
  `renderToStaticMarkup` test asserts the expanded markup with no jsdom/testing-library.

- **Wiring (Task 3, additive):** ServiceHealthGrid + NodeSupportingServices (both consume
  `ServiceHealthState[]` directly) wrap only `!svc.green && !svc.noData` rows in the
  accordion; HostCard (`HostServiceTile`) and OnHostNodes (`OnHostNodeScript`) gained
  additive OPTIONAL explainability fields and wrap their known/not-green rows. The two host
  pages' mappers (`toServiceTile` + the on-host scripts mapper) feed detail/detectionMethod/
  lastSuccessAt/functioningStale(=stale)/collectorStale. Green and no-data rows render
  exactly as before; TwoAxisPip.tsx is unmodified (LOCKED).

## Honesty check (the load-bearing Gap B requirement)

With `detail = null` and `last_success_at = null` (the live LND fleet shape), the expanded
panel shows **"Probe reported no reason" + the real error_count + "never"** — never a
fabricated cause and never a fake timestamp. Proven by test case (b) + (c) in
`ServiceWhyAccordion.test.tsx` and the `detail=null` regression case in `service-health.test.ts`.

## Verification results

- `npx tsc --noEmit` — **clean** (0 errors).
- `npx vitest run src/components src/lib/read/service-health.test.ts src/lib/overview`
  — **407 passed, 1 skipped**, plus **4 pre-existing failures in NavRailShell.test.tsx**
  (see Deferred Issues — untouched by this task, fails at base commit b680f345).
  - `src/lib/read/service-health.test.ts` — 16 passed, 1 skipped.
  - `src/components/df/ServiceWhyAccordion.test.tsx` — 9 passed.
- `npm run lint:noc-guard` — **"v2 surfaces clean"** (the new df component uses only df
  tokens; no forbidden NOC status/brand tokens).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ServiceHealthState test factories missing new fields**
- **Found during:** Task 3 typecheck.
- **Issue:** Adding required `detail` + `detectionMethod` to `ServiceHealthState` broke five
  test factories that build the state object literally (host-rollup, ownership, severity-map,
  incidents, node-services), failing `tsc`.
- **Fix:** Added `detail: null, detectionMethod: null,` to each factory's default object.
  `load-incidents.test.ts` casts via `as ServiceHealthState` so it needed no change.
- **Files modified:** src/lib/overview/host-rollup.test.ts, ownership.test.ts,
  severity-map.test.ts, incidents.test.ts, src/lib/read/node-services.test.ts.
- **Commit:** 465c0b8

### Process note

An accidental `git stash` (forbidden in worktrees) was run during Task 3 verification and
reverted the in-progress edits. Recovery was safe: the stash was a single entry
unambiguously matching this agent's branch and HEAD commit (745ba5b); it was applied and
dropped, and all Task 3 work was preserved. No sibling-worktree contamination occurred.

## Deferred Issues

**NavRailShell.test.tsx — 4 pre-existing failures** (logged to `deferred-items.md`).
Unrelated to Gap B; `NavRailShell.tsx`/`.test.tsx` have an empty diff vs base commit
b680f345. Out of scope — not fixed.

## Known Stubs

None — the accordion is fully wired to real `ServiceHealthState` fields on every surface;
no placeholder/empty-data paths were introduced.

## Self-Check: PASSED

- Created files exist: ServiceWhyAccordion.tsx, ServiceWhyAccordion.test.tsx, service-health.ts.
- Task commits exist: 23f55e6 (T1), 2260251 (T2 RED), 745ba5b (T2 GREEN), 465c0b8 (T3).
</content>
