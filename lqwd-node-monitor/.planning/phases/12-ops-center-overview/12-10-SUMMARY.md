---
phase: 12-ops-center-overview
plan: 10
subsystem: overview
tags: [service-display, relabel, pure-module, tdd, backlog-9]
requires:
  - "src/lib/read/service-health.ts (ServiceHealthState.serviceName — the raw key relabeled)"
provides:
  - "serviceDisplay(name) → { label, description } — presentation-only relabel of raw service keys"
  - "SERVICE_DISPLAY seed map (addressBalances → 'Address List Sync' + 6 known keys)"
affects:
  - "12-12 / 12-13 service rows (hero + QueueIsland) will call serviceDisplay(name).label at render"
tech_stack_added: []
patterns:
  - "Pure module (no DB/server import) locked by vitest before any consumer — mirrors severity-map.ts house style"
  - "camelCase → Title Case humanized fallback for unknown keys; never throws"
key_files_created:
  - "src/lib/overview/service-display.ts"
  - "src/lib/overview/service-display.test.ts"
key_files_modified: []
decisions:
  - "Relabel-only: the map carries ONLY { label, description }; health severity keeps flowing from the two-axis interval-based ServiceHealthState (T-12-10-01) — a label never re-grades or recolors a service."
  - "Unknown keys degrade to a humanized Title-Case label with an EMPTY description (neutral, never a fabricated claim) and never throw."
metrics:
  duration: 1m
  completed: 2026-07-01
  tasks: 1
  files: 2
---

# Phase 12 Plan 10: Service Display-Name Map Summary

Presentation-only `serviceDisplay(name) → { label, description }` map that relabels raw machine service keys (`addressBalances` → "Address List Sync") for operators, with a humanized camelCase fallback for unknown keys — zero change to health logic or the data model.

## What Was Built

- **`src/lib/overview/service-display.ts`** — pure module (no DB/server import). Exports `SERVICE_DISPLAY` (raw key → `{ label, description }`) seeded operator-verbatim for `addressBalances → "Address List Sync"` plus sensible labels for the six other observed keys (`aiLiquidityManager`, `channelAcceptor`, `internalRebalancer`, `nodeAuditor`, `esplora`, `bitcoind`). `serviceDisplay(name)` returns the seeded entry for a known key, else a humanized Title-Case label (`someNewService` → "Some New Service") with an empty description. Total and never-throwing on empty/blank/non-camel input.
- **`src/lib/overview/service-display.test.ts`** — 8 assertions: the seeded label, other-key labels present, `{ label, description }` shape (no health fields), known-key resolution, unknown-key humanization, single-word humanization, digit/acronym splitting, and the never-throws contract on empty/whitespace/snake_case input.

TDD RED → GREEN: failing test committed first (`b4645e5`), implementation to green second (`d03320c`). No refactor commit — the implementation was clean on first green.

## Verification

- `npx vitest run src/lib/overview/service-display` → 8/8 pass.
- `CI=true npx tsc --noEmit -p tsconfig.json` → exit 0.
- `grep -cE "running|functioning|noData|expected_interval" src/lib/overview/service-display.ts` → **0** (relabel only — no health logic).
- `grep -cE "server-only|@/lib/db" src/lib/overview/service-display.ts` → **0** (pure).
- `serviceDisplay` + `SERVICE_DISPLAY` exported (grep confirms); `addressBalances` → `"Address List Sync"`.

## Deviations from Plan

None — plan executed exactly as written. One in-scope wording adjustment: the module header comment was reworded to describe the two-axis health state without using the literal tokens `running`/`functioning`/`noData`/`expected_interval`, so the acceptance grep guard (which forbids those tokens anywhere in the file, including comments) returns 0 while the meaning is preserved.

## TDD Gate Compliance

- RED gate: `test(12-10): add failing test for service display-name map` (`b4645e5`) — verified failing (module not found) before implementation.
- GREEN gate: `feat(12-10): implement service display-name map (relabel only)` (`d03320c`).
- REFACTOR: none required.

## Threat Surface

T-12-10-01 (information disclosure — a relabel implying a healthier state) is mitigated by construction: `ServiceDisplayEntry` carries only `label` + `description`, the module imports no health value and computes none, and the `{ label, description }`-only shape is pinned by test. No new threat surface introduced.

## Known Stubs

None. The map is complete and self-contained; consumers (12-12/12-13) will call `serviceDisplay(name).label` at render without any further data wiring.

## Self-Check: PASSED

- FOUND: src/lib/overview/service-display.ts
- FOUND: src/lib/overview/service-display.test.ts
- FOUND commit b4645e5 (RED test)
- FOUND commit d03320c (GREEN implementation)
