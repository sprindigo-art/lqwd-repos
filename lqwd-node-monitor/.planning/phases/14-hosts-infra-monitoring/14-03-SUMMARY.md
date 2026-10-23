---
phase: 14-hosts-infra-monitoring
plan: 03
subsystem: overview-severity
tags: [host-rollup, days-to-full, telemetry-bands, worst-of, driver-line, pure-module, tdd]
requires:
  - phase: 14-hosts-infra-monitoring plan 02 (wave 1)
    provides: "storage-projection.ts humanizeDaysToFull + StorageGrowth feed"
  - phase: 12 (LOCKED)
    provides: "severity-map worstSeverity/severityFromBand/severityFromService; incidents.ts gradeChain conventions"
provides:
  - "DAYS_TO_FULL_BANDS + evaluateDaysToFull: D-13 four-level days-to-full ramp (additive to telemetry-bands.ts)"
  - "buildHostRollup: view-side worst-of host severity + D-05 driver line (pure module, never wired into the incident tree)"
affects:
  - 14-05/14-06 (HostCard worst-of chrome + driver line consume buildHostRollup)
  - 14-04 (Host Detail StorageVolumes days-to-full severity via evaluateDaysToFull)
tech-stack:
  added: []
  patterns:
    - "Four-level severity ramp lives in its OWN config+evaluator — the 3-level TelemetryBand machinery has no watch tier (Pitfall 2)"
    - "Contributor grading composes ONLY sanctioned mappers; Phase-12 locked modules mirrored, never imported/edited"
    - "Disk-FREE band receives 100 − usedPct (inversion pinned in a fixture)"
key-files:
  created:
    - src/lib/overview/host-rollup.ts
    - src/lib/overview/host-rollup.test.ts
  modified:
    - src/lib/read/telemetry-bands.ts
    - src/lib/read/telemetry-bands.test.ts
decisions:
  - "Resource driver phrases pinned: 'CPU saturated' / 'memory low' / 'disk space low' (plan left resources unpinned; storage/infra/nodes phrases were spec-pinned)"
  - "Chain-driven infra phrase pinned: 'bitcoind <N> blocks behind' / 'bitcoind still syncing' / 'bitcoind low peer count' (worst present band)"
  - "Node severity word uses the raw df Severity literal ('2 nodes critical', '1 node critical') per the Copywriting Contract"
metrics:
  duration: ~7 min
  completed: 2026-07-13
  tasks: 2/2
  tests: 56 passed (telemetry-bands 46 + host-rollup 10); overview suite 203 passed
---

# Phase 14 Plan 03: Days-to-Full Bands + Host Worst-of Rollup Summary

Closes RESEARCH Gaps 2 and 3: the D-13 four-level days-to-full evaluator (additive to `telemetry-bands.ts`) and a new view-side `host-rollup.ts` that folds infra/nodes/resources/storage into one worst-of severity plus the D-05 driver line — both fully test-pinned, with every Phase-12 locked module mirrored but untouched.

## What Was Built

- **`src/lib/read/telemetry-bands.ts` (additive)** — `DAYS_TO_FULL_BANDS = { critical: 7, warning: 30, watch: 90 }` read-time config + `evaluateDaysToFull(days)` returning `"critical" | "warning" | "watch" | "healthy"`. It does NOT route through the 3-level `TelemetryBand`/`evaluateBand` machinery (which has no `watch` tier — Pitfall 2); the returned literals are already df `Severity` members, so no mapper is needed and the "no component hardcodes a threshold" invariant (T-14-07) holds. All six documented boundaries pinned (6.9→critical, 7→warning, 29.9→warning, 30→watch, 89.9→watch, 90→healthy) with the boundary-belongs-to-the-healthier-band convention. Existing exports byte-untouched (diff = 33 insertions, 0 deletions).
- **`src/lib/overview/host-rollup.ts` (new pure module)** — `buildHostRollup(input)` grades four contributor classes via sanctioned mappers only (`severityFromService`, `severityFromBand(evaluateBand(...))`, `evaluateDaysToFull`, and a local `gradeChain` MIRROR of the LOCKED incidents.ts), reduces with `worstSeverity` (stale filtered — D-08), and names the driver as the first contributor matching the rollup severity in the fixed precedence infra → nodes → resources → storage. Storage driver composes `humanizeDaysToFull` from plan 14-02 (never re-inlined). Disk resources feed the %-FREE band `100 − usedPct`.

## Task Commits

| Task | Phase | Commit | Message |
| ---- | ----- | ------ | ------- |
| 1 | RED | 035a9c9 | test(14-03): add failing test for D-13 four-level days-to-full evaluator |
| 1 | GREEN | 236cfd8 | feat(14-03): add D-13 four-level days-to-full evaluator (additive) |
| 2 | RED | 18fa3b2 | test(14-03): add failing fixtures for host worst-of rollup + D-05 driver |
| 2 | GREEN | 56163cd | feat(14-03): implement host worst-of rollup + D-05 driver line |

## Verification

- `npx vitest run src/lib/read/telemetry-bands.test.ts src/lib/overview/host-rollup.test.ts` — 56 passed.
- `npx vitest run src/lib/overview` (+ telemetry-bands) — 203 passed; existing overview suite unaffected.
- `npx tsc --noEmit` — clean (no errors in changed files).
- Acceptance greps: `from "(next|@/lib/db)"` → 0 (pure module); `worstSeverity` count 12 (≥1); `=== "warn"` → 0; exact `driven by: ` present; `git diff --name-only` excludes incidents.ts / severity-map.ts / ownership.ts (locked-clean).

## Threat Model Compliance

- T-14-06 (honesty invariant): stale contributors filtered by `worstSeverity` — the all-stale-host fixture reduces to `healthy` with a null driver (a no-data child never promotes to critical). No-telemetry hosts are the caller's branch, never reaching the rollup.
- T-14-07 (severity drift): all four days-to-full thresholds live ONLY in `DAYS_TO_FULL_BANDS`; boundary semantics test-pinned; no raw number in view logic.
- T-14-08 (locked-module mutation): acceptance grep asserts the diff excludes the Phase-12 locked files; `gradeChain` is mirrored locally, incidents.ts never imported.
- T-14-SC (npm installs): zero packages installed this plan.

## TDD Gate Compliance

RED → GREEN verified in git log for both tasks (test commit precedes feat commit each time). No refactor commits needed.

## Deviations from Plan

**1. [Rule 3 - Blocking] Fresh worktree had no node_modules**
- **Found during:** Task 1 setup (vitest unavailable).
- **Fix:** symlinked the main repo's gitignored `node_modules` into the worktree (zero packages installed).
- **Files modified:** none tracked (symlink is gitignored).
- **Commit:** n/a.

Otherwise executed exactly as written. Choice points the plan delegated: resource driver phrases and the chain-band phrase shapes were chosen and pinned (see `decisions`); the spec-pinned phrases (`bitcoind not functioning`, `disk filling — ~5 days to full`, `2 nodes critical`) match verbatim.

## Known Stubs

None — both modules are fully wired and production-callable. `buildHostRollup` is view-side pure; its HostCard/StorageVolumes consumers ship in later Phase-14 plans (14-04/14-05/14-06), which is the plan's intended scope.

## Threat Flags

None — no new network endpoints, auth paths, DB access, or schema changes; both modules are pure and fixture-testable.

## Self-Check: PASSED

- src/lib/read/telemetry-bands.ts — FOUND (extended)
- src/lib/overview/host-rollup.ts — FOUND
- src/lib/overview/host-rollup.test.ts — FOUND
- Commits 035a9c9, 236cfd8, 18fa3b2, 56163cd — FOUND
