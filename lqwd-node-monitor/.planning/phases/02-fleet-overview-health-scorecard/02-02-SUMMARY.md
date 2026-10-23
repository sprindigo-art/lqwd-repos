---
phase: 02-fleet-overview-health-scorecard
plan: 02
subsystem: scorecard
tags: [scorecard, grading, mad, freshness, config, pure-functions]
dependency_graph:
  requires: []
  provides:
    - "src/lib/scorecard/types.ts — DimensionKey/DimensionResult/GradedDimension/ScorecardView/FleetView contracts"
    - "src/lib/scorecard/config.ts — SCORECARD_CONFIG (lnd+ldk), COMPARE_CONFIG, STALENESS (D-02 single tuning surface)"
    - "src/lib/scorecard/grade.ts — pctFor/letterFor/gradeDimension/gradeNoData/compositeOf/nodeDot/reasonFor/criticalChips"
    - "src/lib/scorecard/compare.ts — median/mad/outlierCheck/outlierFor (D-10/11/12)"
    - "src/lib/scorecard/freshness.ts — worstCaseAsOf/isStale (D-13)"
    - "src/lib/config/backends.ts — backendFor(pubkey) with NODE_BACKENDS env override (D-03)"
  affects: ["02-03", "02-04", "02-05", "02-06", "02-07"]
tech_stack:
  added: []
  patterns:
    - "Interface-first pure layer: Wave 2/3 plans import these contracts verbatim, never redefine"
    - "Direction-normalized banding: all Band directions fold onto one higher-better goodness axis in pctFor"
    - "Fail-loud module-scope env parse (NODE_BACKENDS) with descriptive throw"
key_files:
  created:
    - src/lib/scorecard/types.ts
    - src/lib/scorecard/config.ts
    - src/lib/scorecard/grade.ts
    - src/lib/scorecard/grade.test.ts
    - src/lib/scorecard/compare.ts
    - src/lib/scorecard/compare.test.ts
    - src/lib/scorecard/freshness.ts
    - src/lib/scorecard/freshness.test.ts
    - src/lib/config/backends.ts
    - src/lib/config/backends.test.ts
  modified: []
decisions:
  - "DEFAULT_BACKENDS ships empty: the one-off warehouse seeding query was denied (production read not authorized for this mock-first build); known LDK alias LQwD-Lspd-ldk documented in-comment, operator flips via NODE_BACKENDS env"
  - "NODE_BACKENDS value validation added beyond JSON parse: a pubkey mapped to anything but lnd/ldk throws (extends T-02-06 fail-loud to wrong-shaped config)"
  - "Worse-than-d pct extends the c→d slope linearly down to the 0 floor (plan left the sub-60 slope unspecified)"
  - "isStale boundary: exactly AT warnAfterHours is NOT stale (strict >), tested"
metrics:
  duration: "~9 min"
  completed: "2026-06-09"
  tasks: 3
  files: 10
  tests: 36
---

# Phase 2 Plan 02: Pure Scorecard Layer Summary

Direction-normalized grading engine + per-backend tunable config + MAD peer comparison + worst-case freshness, all pure/DB-free, with the operator's red-is-Tier-1-only rule encoded as 36 passing tests.

## What Was Built

**Task 1 — Contracts + config + backend map (`df694ff`)**
- `types.ts`: the 10-key `DimensionKey` union (7 computable, 3 no-data per D-01) plus every view contract (`DimensionResult`, `GradedDimension`, `PeerRelative`, `ScorecardView`, `FleetView`). Raw values stay RAW — AFM-002 formatter applies at render only.
- `config.ts`: `SCORECARD_CONFIG` with separate `lnd` and `ldk` object literals (per-backend tuning surface from day one, D-02/D-08; LDK starts identical pending LDK data), each dimension's band annotated with source + confidence from RESEARCH. `COMPARE_CONFIG = { madN: 3, minCohortForMedian: 3 }`, `STALENESS = { warnAfterHours: 6 }`. Tier-1 lines: revenue `< 10` PPM "fee crash", forceClose `maxHourlySelfCloses >= 50` "close storm", peer `< 1` "unreachable".
- `backends.ts`: `backendFor(pubkey)` resolving env override → `DEFAULT_BACKENDS` → `"lnd"`; `import "server-only"` (T-02-02); reuses `Backend` from `@/lib/read/nodes` (never redeclared); module-scope fail-loud parse of `NODE_BACKENDS` (T-02-06).

**Task 2 — Grading engine (`41d24d9`)**
- `pctFor` folds higher-better / lower-better / mid-better (|raw − center|) onto a single goodness axis; cutoffs a/b/c/d anchor to 90/80/70/60 with linear interpolation, capped 90→100 extension above a, sloped 60→0 floor below d, epsilon-guarded degenerate bands (forceClose a:0 edge tested).
- D-07 hard rule executable: `gradeDimension` colors "critical" ONLY on a Tier-1 breach (raw or `extras` metric); C/D/F cap at "warn". `nodeDot` is "critical" iff ≥1 breach — tested both ways (9 healthy + 1 breach → critical; multiple F dims + zero breach → warn, never red).
- `compositeOf` = unweighted mean of gradable pcts (no-data excluded, breached dims stay in the mean — the chip is the separate signal). `reasonFor` prefers `critical: {label}` over the lowest-pct warn dim's `reasonLabel`.

**Task 3 — MAD comparison + freshness (`0493a33`)**
- `compare.ts`: `median`/`mad`/`outlierCheck` verbatim from RESEARCH §MAD (1.4826 constant, cohort < 3 suppression, MAD === 0 → nobody flagged) + `outlierFor` direction-aware bad-tail filter (higher-better flags only the low tail, lower-better only the high tail, mid-better both) returning `PeerRelative`. No grade inputs/outputs — D-12 separation enforced structurally.
- `freshness.ts`: `worstCaseAsOf` = oldest non-null stamp (caller excludes restart + no-data dims per RESEARCH A5, documented in banner); `isStale` strict-past-threshold, null asOf → stale.

## Verification Results

- `npx vitest run src/lib/scorecard src/lib/config` — 4 files, 36 tests, all green, < 1s, no DB
- `npx tsc --noEmit` — clean
- grep guards: no `type Backend =` outside `src/lib/read/nodes.ts`; no threshold literals in grade.ts beyond letter anchors (90/80/70/60/100/0) + epsilon

## Deviations from Plan

### Auto-handled

**1. [Plan-sanctioned fallback] DEFAULT_BACKENDS seeding query not run**
- **Found during:** Task 1
- **Issue:** The one-off read-only `lnd_node_info` query against `ROUTING_VM_DATABASE_URL` was denied by the execution environment (production-warehouse read not authorized for this task).
- **Fix:** Took the plan's explicit fallback branch — `DEFAULT_BACKENDS` ships empty with an in-comment note naming `LQwD-Lspd-ldk` as the known-LDK alias to add; operator can map it immediately via `NODE_BACKENDS`.
- **Files modified:** src/lib/config/backends.ts
- **Commit:** df694ff

**2. [Rule 2 - Missing validation] NODE_BACKENDS value validation**
- **Found during:** Task 1
- **Issue:** Plan required fail-loud on malformed JSON only; a syntactically-valid map with a wrong backend value (e.g. `"cln"`) would have silently corrupted the backend map — exactly threat T-02-06's mis-routing risk.
- **Fix:** Values are validated as `"lnd" | "ldk"` at parse; anything else throws descriptively. Covered by a 5th test.
- **Files modified:** src/lib/config/backends.ts, src/lib/config/backends.test.ts
- **Commit:** df694ff

No other deviations — plan executed as written.

## Known Stubs

None. All six modules are fully implemented. `DEFAULT_BACKENDS` being empty is intentional, documented config (env-overridable, D-03), not a stub blocking the plan goal.

## Notes for Orchestrator

- FLEET-02/FLEET-03 are shared with Wave 2/3 plans — requirement completion marking deferred to the orchestrator (this plan delivers the pure layer only; dimensions + assembly land in later waves).

## Self-Check: PASSED

- All 10 created files exist on disk
- Commits df694ff, 41d24d9, 0493a33 present on worktree-agent branch
