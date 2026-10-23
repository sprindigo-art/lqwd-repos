---
phase: 12-ops-center-overview
plan: 08
subsystem: overview
tags: [freshness, staleness, cutoff, pure-module, tdd, OVW-01, OVW-03]
requires:
  - "src/components/df/Severity (df Severity type — not imported here; consumer context)"
provides:
  - "applyFreshnessCutoff<T> — generic 30-day staleness eliminator (pure)"
  - "STALENESS_CUTOFF_DAYS (30) + STALENESS_CUTOFF_MS constants"
affects:
  - "12-12 page wiring — applies cutoff to every layer array before incidents.ts assembly + vitals.ts rollup"
tech-stack:
  added: []
  patterns:
    - "Pure module (no DB/server import, no .sort, no mutation) mirroring vitals.ts house style"
    - "TDD RED→GREEN with vitest; @/ alias"
    - "Inclusive age boundary (<=) so the liveness window can only widen, never silently tighten"
key-files:
  created:
    - "src/lib/overview/freshness-cutoff.ts"
    - "src/lib/overview/freshness-cutoff.test.ts"
  modified: []
decisions:
  - "LOCKED #8: a null stamp (never reported) is ELIMINATED, not shown as no-data — it has no data in the last 30 days, so it is 'gone'. The honest no-data path (D-08) still covers entities WITHIN the window."
  - "Two distinct clocks kept separate: the ~15min collector deriveStale window answers 'is this fact fresh to show?'; this 30-day window answers 'is this entity alive enough to monitor at all?'. Never conflated."
  - "Boundary inclusive (<=) — an entity at exactly 30 days survives (threat T-12-08-01: a live-but-quiet entity must never be wrongly eliminated)."
metrics:
  duration: ~8 min
  completed: 2026-06-30
  tasks: 1
  files: 2
---

# Phase 12 Plan 08: 30-Day Freshness-Cutoff Eliminator Summary

A single pure, tested generic eliminator (`applyFreshnessCutoff`) implementing the LOCKED backlog-#8 rule — any entity with a null stamp or a stamp older than 30 days is treated as gone and dropped before incident assembly and vitals rollup — the deliberate fix for the 1000+ STALE flood from long-dead nodes.

## What Was Built

- **`src/lib/overview/freshness-cutoff.ts`** — pure module (mirrors `vitals.ts` banner/purity: no `@/lib/db`/`server-only` import, no `.sort`, no input mutation). Exports:
  - `STALENESS_CUTOFF_DAYS = 30`
  - `STALENESS_CUTOFF_MS = STALENESS_CUTOFF_DAYS * 24 * 60 * 60 * 1000`
  - `applyFreshnessCutoff<T>(items, stampOf, nowMs = Date.now(), maxAgeMs = STALENESS_CUTOFF_MS): T[]` — keeps an item only when `stampOf(item)` is a non-null `Date` and `nowMs - stamp.getTime() <= maxAgeMs`. Null stamps dropped. Returns a new array via `.filter` (survivor order preserved).
- **`src/lib/overview/freshness-cutoff.test.ts`** — 11 vitest assertions: constants lock, null-drop, 31d-drop, 29d-survive, boundary-inclusive (age == window survives), default-window, mixed null/fresh/stale survivors in order, no-mutation + new-array reference, order-preserved, empty input.

## How It Works

The 12-12 page wiring will pass each layer's stamp accessor as `stampOf` (e.g. `ScorecardView.asOf`, `HostMetricsView.collectedAt`, `ChainTelemetryView.collectedAt`, `ServiceHealthState.collectedAt`, insight `evidence.asOf → new Date()`) and run every layer array through the cutoff BEFORE `assembleIncidents` and `rollupLayer`, so a dead entity leaves both the attention queue and the vitals denominators in one pass.

## Verification

- `npx vitest run src/lib/overview/freshness-cutoff` → 11/11 pass.
- `CI=true npx tsc --noEmit -p tsconfig.json` → exit 0.
- `grep -c "\.sort(" freshness-cutoff.ts` → 0; `grep -cE "server-only|@/lib/db"` → 0; both exports grep-confirmed.
- TDD gate: RED commit `c70d558` (failing unresolved-import test) precedes GREEN commit `cf53c8f`.

## Deviations from Plan

None - plan executed exactly as written. No REFACTOR commit needed (implementation was clean on first GREEN).

## TDD Gate Compliance

- RED gate: `test(12-08): add failing test...` — `c70d558` (test failed with unresolved import, no implementation present).
- GREEN gate: `feat(12-08): implement 30-day freshness-cutoff eliminator...` — `cf53c8f` (11/11 green).
- REFACTOR: not required.

## Known Stubs

None. This is a complete, self-contained pure module. The 12-12 consumer wiring is explicitly out of this plan's scope (tracked as a `key_links` handoff, not a stub).

## Self-Check: PASSED

- FOUND: src/lib/overview/freshness-cutoff.ts
- FOUND: src/lib/overview/freshness-cutoff.test.ts
- FOUND commit: c70d558 (RED)
- FOUND commit: cf53c8f (GREEN)
