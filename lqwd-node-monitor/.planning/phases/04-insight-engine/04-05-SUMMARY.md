---
phase: 04-insight-engine
plan: 05
subsystem: insight-detectors
tags: [detector, fees, stepdown, d-09, insight-02, insight-04, golden-fixture, tdd]
requires:
  - "04-01: InsightCardSchema frozen contract (update_fee/close_channel/investigate unions)"
  - "04-02: INSIGHT_CONFIG knobs (fee tier table, drift/earnings ratios, noise floors)"
  - "AFM-001 latestChannelsForNode (src/lib/read/latest.ts)"
  - "SCORECARD_CONFIG revenue tier1 (PPM-LOW band, read at use-site)"
provides:
  - "buildChannelVolumeSql + detectFeeSignals — the only update_fee/close_channel param producers this phase"
  - "buildStepdownSql + detectStepdown — D-09 critical fee-crash detector, France golden-validated"
  - "stepdownForFleet / channelVolumeForFleet / feeSignalChannelsForNode executors for the engine (04 engine plan)"
affects:
  - "04 engine plan (loadInsightView wires these executors + pure detectors)"
  - "Phase 5 export + Phase 6 signing (consume the update_fee/close_channel params emitted here)"
tech-stack:
  added: []
  patterns:
    - "Detector anatomy: banner → SQL builder → raw-row interface → lazy-import executor → pure detect*(rows, config, now)"
    - "ns-window idiom: (EXTRACT(EPOCH FROM now()) - N::int * 86400::int) * 1e9 on every lnd_node_forwards bound"
    - "Golden fixture: real incident series encoded verbatim in the test, detector derives from source columns"
key-files:
  created:
    - src/lib/insight/detectors/fee-signals.ts
    - src/lib/insight/detectors/fee-signals.test.ts
    - src/lib/insight/detectors/fee-stepdown.ts
    - src/lib/insight/detectors/fee-stepdown.test.ts
  modified:
    - .planning/REQUIREMENTS.md
decisions:
  - "timeLockDelta in update_fee params = LND default 80: lnd_node_channel_info carries no TLD column; documented as a preserve-current placeholder, node re-enforces bounds on apply"
  - "Dec-08 boundary week FIRES (exact msat-derived drift ratio 0.42 < 0.5, vs research's rounded ~0.46 estimate) — asserted explicitly as an arguably-true positive with the operator-retune note"
  - "Zero-current-flow nodes skip step-down entirely (ppm7d null): total routing stall is the staleness/peer domain, not fee-crash — EARNINGS-DROP never fires on an idle week"
  - "Worst-rule-wins = smallest observed/threshold ratio across fired rules (deterministic, unit-independent)"
  - "close-candidate takes precedence over fee_lower on dead over-priced channels (tier table verbatim: close instead of tuning); one card max per channel"
metrics:
  duration: "~10 min"
  completed: "2026-06-12"
  tasks: 2
  tests: "34 new (16 fee-signals + 18 fee-stepdown); full suite 344 passed / 16 skipped"
---

# Phase 4 Plan 05: Fee Signals + Fee-Stepdown Detectors Summary

Economic detectors: France tiered-fee raise/lower/close-candidate signals emitting the phase's only typed update_fee/close_channel params, plus the D-09 fee-crash detector golden-validated against the real France routing-pnl weekly series.

## What Was Built

### Task 1 — fee-signals.ts (INSIGHT-02 fee signals)

- `buildChannelVolumeSql(days)`: ONE fleet-wide aggregate over `lnd_node_forwards` — UNION ALL of `chan_id_in`/`chan_id_out` roles, COUNT per `(lnd_pubkey, chan_id)`, ns-window with `::int` casts and the `1e9` factor, bound params only. Zero new SQL touches `lnd_node_channel_info` — current policy comes exclusively from the sanctioned AFM-001 reader (`latestChannelsForNode`).
- `detectFeeSignals(nodes, volumeRows, config, now)`: pure France tier-table detection —
  - **raise**: ≥100 forwards/90d AND PPM < 30 → `update_fee` to `feeFloorPpm` with all six frozen-contract params
  - **lower**: PPM > 500 AND < 10 forwards/90d → `update_fee` to `feeLowerTargetPpm` ([ASSUMED A1] LOW confidence, noted at the knob)
  - **close-candidate**: 0 forwards/90d AND age > 90d (from `lifetime`) → `close_channel { force: false }`; precedence over lower
  - All severity `info`; null policy PPM never coerced; closed channels skipped; D-16 guidance text on every write card.

### Task 2 — fee-stepdown.ts (INSIGHT-04, D-09)

- `buildStepdownSql()`: one pass over `lnd_node_forwards` GROUP BY `lnd_pubkey` with three FILTER windows — 24h, 7d, and the 28d-ending-7d-ago baseline with BOTH bounds in the ns `1e9` form (Pitfall 2); outer predicate bounds the scan at now-35d.
- `detectStepdown(rows, config, now)`: critical card when ANY of —
  1. **PPM-LOW**: 24h PPM below `SCORECARD_CONFIG[backend].revenue.tier1.value` (READ at use-site; `grep -c "= 10\|< 10"` on the module = 0, enforced by a source-grep test)
  2. **PPM-DRIFT**: ppm7d < 0.5× baseline
  3. **EARNINGS-DROP**: 7d earnings < 0.3× baseline weekly
  - Noise floors (baseline ≥200 forwards, baseline PPM ≥5); null PPM stays null (Pitfall 4); one card per node max; `suggestedAction` hard-coded `investigate` with the restoration target (`ppmBaseline`) riding in `evidence.detail` only (T-04-11).

### France golden fixture

The routing-pnl.md weekly table (contiguous 2025-11-03 … 2026-02-23 span) is encoded verbatim in `fee-stepdown.test.ts`; the transform derives msat aggregates from the source sat/BTC columns. Exact fire matrix asserted:

| Week | Fires? | Why |
|---|---|---|
| Dec-15 / Dec-22 / Dec-29 (healthy) | NO | drift ratios 0.63–1.18 |
| **2025-12-08 (boundary)** | **YES** | drift 14.18/33.69 ≈ 0.42 < 0.5 — documented as arguably a TRUE positive (real ~2.4× softening); operator retunes `ppmDriftRatio` if noisy |
| **2026-01-05 (crash)** | **YES** | drift 2.27/17.29 ≈ 0.13; earnings 1,113 < 0.3 × 18,809.5; PPM-LOW 2.27 |
| Jan-12 / Jan-19 / Jan-26 | YES | post-crash, baseline still healthy |
| Feb-02 onward | NO | baseline itself crashed (< ppmBaselineMin noise floor) |

## Commits

| Task | Phase | Commit | Files |
|---|---|---|---|
| 1 | RED | 539fe50 | fee-signals.test.ts |
| 1 | GREEN | c29aabb | fee-signals.ts |
| 2 | RED | 4038969 | fee-stepdown.test.ts (France fixture) |
| 2 | GREEN | 17237cf | fee-stepdown.ts |

## Verification

- `npx vitest run src/lib/insight/detectors` — 34 passed
- Full suite: 344 passed / 16 skipped (live-DB golden tests, no env)
- `npx tsc --noEmit` clean; `npx eslint src/lib/insight/detectors/` clean
- `grep -c "= 10\|< 10" src/lib/insight/detectors/fee-stepdown.ts` → 0

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing field] timeLockDelta has no warehouse source**
- **Found during:** Task 1
- **Issue:** The frozen update_fee contract requires `timeLockDelta`, but `lnd_node_channel_info` carries no time_lock_delta column — "current" TLD is unobservable from the warehouse.
- **Fix:** Pass the LND default (80) as a documented preserve-current placeholder (`DEFAULT_TIME_LOCK_DELTA` with banner note); the node-side executor re-reads and re-enforces actual policy bounds before applying (core constraint).
- **Files modified:** src/lib/insight/detectors/fee-signals.ts
- **Commit:** c29aabb

**2. [Rule 1 - Spec ambiguity resolved] EARNINGS-DROP on zero-flow nodes**
- **Found during:** Task 2
- **Issue:** A node with zero 7d flow has 0 earnings, which would mechanically satisfy EARNINGS-DROP and turn every idle node into a fee-crash false positive — contradicting the plan's "null PPM → no card" behavior fixture.
- **Fix:** Null ppm7d short-circuits the whole node before any rule (including earnings) — total routing stall is the staleness/peer domain per the revenue.ts precedent. Banner documents the choice.
- **Files modified:** src/lib/insight/detectors/fee-stepdown.ts
- **Commit:** 17237cf

### Documented fixture choices (not deviations)

- Dec-08 boundary week fires at exact ratio 0.42 (research's rounded arithmetic estimated ~0.46; both sides of the source numbers agree it sits near the 0.5 line). Asserted explicitly with the operator-retune comment, per the plan's "assert current behavior either way" instruction.
- The non-contiguous routing-pnl tail rows (2026-03-30 / 05-04 / 05-25) are excluded from the fixture — the 4-week trailing-baseline transform requires weekly contiguity (documented in the fixture banner).

## Known Stubs

None — both detectors are fully wired pure functions with live-ready executors; no placeholder data paths.

## Threat Flags

None — no new surface beyond the plan's threat model. T-04-10 (bound params, shape-tested), T-04-11 (investigate-only, test-asserted), T-04-12 (schema parse + six-field params, test-asserted) all mitigated as registered.

## Requirements

- INSIGHT-04 marked complete (step-down detector delivered + golden-validated).
- INSIGHT-02 left pending — fee signals are one of its six detector families; AP-11/AP-12/HTLC-timeout/rebalance land in sibling plans.

## Self-Check: PASSED

All 4 created source/test files exist; all 5 commits (539fe50, c29aabb, 4038969, 17237cf, 473d922) present; no file deletions in the plan range; working tree clean.
