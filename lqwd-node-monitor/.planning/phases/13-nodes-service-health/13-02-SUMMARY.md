---
phase: 13-nodes-service-health
plan: 02
subsystem: overview
tags: [NODE-03, filter, pure-view, tdd]
requires:
  - "src/lib/read/nodes.ts (Backend type)"
  - "src/components/df/Severity.ts (Severity ramp)"
provides:
  - "parseNodeFacets — whitelist-widen codec for ?type/?status/?stale"
  - "applyNodeFilters — pure non-mutating, non-sorting Nodes-list view filter"
affects:
  - "Plan 04 Nodes-list route (src/app/(overview)/nodes/page.tsx) will consume this"
tech-stack:
  added: []
  patterns:
    - "Whitelist-widen-on-invalid facet codec (mirrors overview/filter.ts)"
    - "Pure view filter: .filter only, zero .sort, no input mutation"
    - "Type-only imports keep the module DB/server-free (fixture-testable)"
key-files:
  created:
    - "src/lib/overview/node-filter.ts"
    - "src/lib/overview/node-filter.test.ts"
  modified: []
decisions:
  - "status→severity map: at-risk={critical,warning}, healthy={healthy,watch}, offline={stale} — every ramp state maps to exactly one status bucket; severity is READ from the loaded row, never re-derived"
  - "Input row is a minimal structural NodeFilterRow{backend,severity,stale} (subset of ScorecardView) so the pure filter is generic over T and needs no full scorecard fixture"
  - "stale toggle is truthy for the '1'/'true' tokens only; any other value widens to false"
metrics:
  duration: ~6m
  completed: 2026-07-08
---

# Phase 13 Plan 02: Nodes-list filter/sort view layer Summary

Pure, no-DB `parseNodeFacets` + `applyNodeFilters` view layer for NODE-03 — a whitelist-widen
facet codec (type · status · stale) plus a non-mutating, non-sorting filter over the already-loaded
fleet set, locked by a 9-assertion vitest before the Plan 04 route consumes it.

## What Was Built

- **`parseNodeFacets(searchParams)`** — reads `?type`/`?status`/`?stale`, whitelists each against a
  closed vocabulary, and silently WIDENS any invalid token to the permissive default (`all`/`all`/
  `false`). Never throws (V5, mirrors `overview/filter.ts`). `stale` is on only for `1`/`true`.
- **`applyNodeFilters(nodes, facets)`** — a pure view: `.filter` only (zero `.sort`, no input
  mutation), AND-combining the three facets. `type` keys off the node `Backend`; `status` maps
  through the loaded row's df `severity` (`at-risk`={critical,warning}, `healthy`={healthy,watch},
  `offline`={stale}); `stale` reads the row's stale flag. Zero matches on a non-empty set → `[]`
  (honest empty state). Generic over `T extends NodeFilterRow`.
- Both imports are `import type` (Backend, Severity) — erased at runtime, so the module carries no
  DB/server dependency and drives from fixtures without a pool.

## How It Maps to the Analog

Mirrors `src/lib/overview/filter.ts` (`parseOverviewFacets`/`applyFilter`): same closed-vocab
whitelist-widen contract and same "engine order is LAW — no .sort, no mutation" filter discipline,
over the Nodes-specific type/status/stale vocabulary instead of the overview layer/sev vocabulary.

## Verification

- `npx vitest run src/lib/overview/node-filter` — **9 passed / 9** (RED→GREEN).
- Source assertions: `grep '\.sort(' node-filter.ts` → none; imports are `import type` only (no
  server/DB runtime import).
- Behavior proven: invalid facet token widens rather than throwing; type/status/stale narrow and
  combine (AND); honest `[]` on zero matches; input array not mutated.

## Deviations from Plan

None — plan executed exactly as written. The `status→severity` bucket mapping (an intentional design
choice the plan left to the implementer via "map status through the row severity flags") is
documented under Decisions above.

## TDD Gate Compliance

- RED: `test(13-02): add failing test …` (1b7dc7a) — suite failed on the missing module import.
- GREEN: `feat(13-02): implement parseNodeFacets + applyNodeFilters …` (32932ad) — 9/9 pass.
- REFACTOR: not needed (implementation was minimal and clean on first pass).

## Known Stubs

None — this is a complete, self-contained pure module. No placeholder values, no unwired data.

## Self-Check: PASSED

- FOUND: src/lib/overview/node-filter.ts
- FOUND: src/lib/overview/node-filter.test.ts
- FOUND commit: 1b7dc7a (test/RED)
- FOUND commit: 32932ad (feat/GREEN)
