---
phase: 14-hosts-infra-monitoring
plan: 02
subsystem: read-layer
tags: [host-metrics, host-storage, history, storage-projection, hos-02, drizzle, pure-module]
requires:
  - phase: 11-full-stack-telemetry
    provides: "host_metrics / host_storage append-history fact tables + dbNodemon client"
  - phase: 14-hosts-infra-monitoring plan 01 (shipped earlier)
    provides: "storage-growth.ts computeStorageGrowth + StorageGrowthSample/StorageProjectionStatus"
provides:
  - "Bounded, param-bound time-window history reads over host_metrics / host_storage (24h default)"
  - "getHostStorageHistory: per-mount StorageGrowthSample[] map — computeStorageGrowth's first production feed"
  - "storage-projection.ts pure module: D-15 humanizeDaysToFull + D-14 projectionStatusCopy + formatPctPerDay"
affects:
  - 14-04 (Host Detail B3 vitals sparklines / B5 storage volumes consume these reads + copy)
  - 14-05/14-06 (any host-card growth surfacing)
tech-stack:
  added: []
  patterns:
    - "History read = plain bounded scan (make_interval, ORDER BY collected_at ASC) — DISTINCT ON reserved for latest reads"
    - "Copywriting-contract strings pinned verbatim in a pure module's tests"
key-files:
  created:
    - src/lib/read/host-history.ts
    - src/lib/read/host-history.test.ts
    - src/lib/read/storage-projection.ts
    - src/lib/read/storage-projection.test.ts
  modified: []
decisions:
  - "Sub-day projection copy pinned to '<1 day to full' (plan offered a choice; never '~0 days')"
  - "Singular grammar pinned: '~1 week to full' / '~1 day to full'"
  - "stale copy without a known ageMs omits the parenthetical rather than faking an age"
  - "History rows missing timestamp/mount/byte columns are dropped, not zero-filled (honesty over padding)"
metrics:
  duration: ~5 min
  completed: 2026-07-13
  tasks: 2/2
  tests: 37 passed, 2 skipped (live-DB, no NODEMON_QUEUE_URL)
---

# Phase 14 Plan 02: Host History Reads + Storage Projection Copy Summary

Bounded param-bound 24h history reads over host_metrics/host_storage plus the pure D-15/D-14 storage-projection copy module, closing RESEARCH Gap 1 for HOST-02 sparklines and time-to-full.

## What Was Built

- **`src/lib/read/host-history.ts`** — `buildHostMetricsHistorySql` / `buildHostStorageHistorySql` emit plain bounded scans (`WHERE host_id = $1 AND collected_at > now() - make_interval(secs => $2) ORDER BY collected_at ASC`). No DISTINCT ON, no `MAX(` — history is a series, not a latest read (AFM-001 landmine kept out by construction and by test). `getHostMetricsHistory` returns coerced `{collectedAt: Date, cpuPct/memTotalKb/memAvailableKb: number|null}` points; `getHostStorageHistory` returns `Map<mount, StorageGrowthSample[]>` ascending — directly feedable to `computeStorageGrowth`. `dbNodemon` is lazy-imported so the no-DB shape test's import graph never touches the postgres pool.
- **`src/lib/read/storage-projection.ts`** — pure module (first-line pure-module comment, imports only types from `@/lib/read/storage-growth`). `humanizeDaysToFull` implements the locked D-15 bands; `projectionStatusCopy` maps every non-ok `StorageProjectionStatus` to distinct verbatim Copywriting Contract copy; `formatPctPerDay` renders the signed rate (`+0.4%/day`).

## Task Commits

| Task | Phase | Commit | Message |
| ---- | ----- | ------ | ------- |
| 1 | RED | fb8b03c | test(14-02): add failing shape test for bounded host history reads |
| 1 | GREEN | 69ae04f | feat(14-02): implement bounded host_metrics/host_storage history reads |
| 2 | RED | 817f6ff | test(14-02): add failing test pinning D-15 humanize bands and D-14 status copy |
| 2 | GREEN | 8d74963 | feat(14-02): implement D-15 humanizer + D-14 honest projection status copy |

## Verification

- `npx vitest run src/lib/read/host-history.test.ts src/lib/read/storage-projection.test.ts src/lib/read/storage-growth.test.ts` — 37 passed, 2 skipped (live-DB describe blocks skip cleanly without `NODEMON_QUEUE_URL`); no regression to the shipped storage-growth module.
- `npx tsc --noEmit` — clean.
- All plan acceptance greps pass: lazy import ≥1, `parseDbTimestampUtc` ≥1, zero top-level db imports; pure-module comment present; all four verbatim copy strings present; zero `next`/`@/lib/db` imports in storage-projection.

## Threat Model Compliance

- T-14-03 (SQLi): both builders bind hostId AND the window via drizzle `sql` params; injection assertion pinned in the shape test (evil hostId appears in params, never in rendered SQL).
- T-14-04 (info disclosure): SELECT-only helpers over nodemon telemetry tables; no DB names in exported copy strings.
- T-14-05 (DoS): window parameter is mandatory in both builders — an unbounded scan is not expressible through this module.

## TDD Gate Compliance

RED → GREEN sequence verified in git log for both tasks (test commit precedes feat commit each time). No refactor commits needed.

## Deviations from Plan

**1. [Rule 3 - Blocking] Worktree had no node_modules**
- **Found during:** Task 1 setup (vitest unavailable in the fresh worktree)
- **Fix:** symlinked the main repo's `node_modules` into the worktree (`node_modules` is gitignored; zero packages installed)
- **Files modified:** none tracked
- **Commit:** n/a (untracked symlink)

Otherwise executed exactly as written. Choice points the plan explicitly delegated ("choose and pin"): sub-day copy pinned to `<1 day to full`; singular week/day grammar pinned.

## Requirements

HOST-02 is *partially* advanced (data layer + copy). Not marked complete — the requirement spans the remaining Host Detail UI plans in this phase; REQUIREMENTS.md left untouched for the orchestrator.

## Known Stubs

None — both modules are fully wired and production-callable; `computeStorageGrowth` now has a real data source. (The shipped `<VmVitals charts={[]} />` stub in Node Detail is pre-existing and is wired by a later plan in this phase, per the plan's scope.)

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- src/lib/read/host-history.ts — FOUND
- src/lib/read/host-history.test.ts — FOUND
- src/lib/read/storage-projection.ts — FOUND
- src/lib/read/storage-projection.test.ts — FOUND
- Commits fb8b03c, 69ae04f, 817f6ff, 8d74963 — FOUND
