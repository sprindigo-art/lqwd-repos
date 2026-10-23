---
phase: 04-insight-engine
plan: 04
subsystem: insight
tags: [detector, force-close, htlc-timeout, tdd, insight-02]
requires:
  - phase: 04-insight-engine
    plan: 01
    provides: "InsightCard schema/types (InsightCardSchema, CARD_SCHEMA_VERSION, DetectorId htlc_timeout_fc)"
  - phase: 04-insight-engine
    plan: 02
    provides: "INSIGHT_CONFIG knobs (htlcWindowDays/htlcTimeoutMinCount/htlcTimeoutCriticalCount) + buildDeepLink"
provides:
  - "buildHtlcTimeoutSql(windowDays) — Query 1 signature fleet aggregate over lnd_node_closed_channels"
  - "detectHtlcTimeout(rows, config, nodeMeta) — pure warn/critical card emitter (one card per node max)"
  - "htlcTimeoutCards(config, aliasByPubkey?) — lazy-import server executor (fetch + backendFor + detect)"
  - "fetchHtlcTimeoutRows(windowDays) — coerced HtlcRow fetch (Number()/parseDbTimestampUtc at one layer)"
affects:
  - "Wave 4 engine (04-07 imports htlcTimeoutCards)"
  - "Wave 5 inbox UI (renders htlc_timeout_fc cards)"
tech-stack:
  added: []
  patterns:
    - "Dimension-module 4-part anatomy (force-close.ts analog): banner → SQL builder → raw-row interface → lazy-import executor"
    - "Pure detect() split from server executor — fixtures drive detection with no DB (RESEARCH detector twist)"
key-files:
  created:
    - src/lib/insight/detectors/htlc-timeout.ts
    - src/lib/insight/detectors/htlc-timeout.test.ts
  modified: []
decisions:
  - "Executor split across tasks: Task 1 shipped fetchHtlcTimeoutRows (the lazy-import DB half); Task 2 added htlcTimeoutCards composing fetch + node metadata + detect — keeps every TDD commit compiling without stubbing detect()"
  - "evidence.asOf epoch sentinel for a null row timestamp (unreachable for firing rows — a GROUP BY node has ≥1 close, MAX(timestamp) non-null) rather than fabricating 'now'"
  - "detail.avgSettledRatio omitted when the SQL aggregate is NULL (no signature rows) — never fabricate a 0 ratio"
  - "deepLink carries no ?window= param: htlcWindowDays is operator-tunable and a non-preset value (e.g. 45d) would make buildDeepLink throw — plain /:pubkey/closes is always valid"
metrics:
  duration: "~6 min"
  completed: "2026-06-12"
  tasks: 2
  files: 2
---

# Phase 4 Plan 04: HTLC-Timeout Force-Close Signature Detector Summary

INSIGHT-02 Detector 4: mechanism-fingerprinted LOCAL_FC counter (force-close-analysis-methodology Query 1 signature) over `lnd_node_closed_channels` firing config-driven warn (≥2 in 30d) / critical (≥10 in 24h) investigate-only cards.

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | buildHtlcTimeoutSql + raw-row coercion | 21196b3 (RED), 3a5343a (GREEN) | src/lib/insight/detectors/htlc-timeout.ts, htlc-timeout.test.ts |
| 2 | detectHtlcTimeout pure function + fixture tests | 5ba2b05 (RED), 865c995 (GREEN) | src/lib/insight/detectors/htlc-timeout.ts, htlc-timeout.test.ts |

## What Was Built

### buildHtlcTimeoutSql (Task 1)
- Fleet-wide `GROUP BY local_pubkey` over `lnd_node_closed_channels` (one row per close — no DISTINCT ON; banner documents table, identity column, and the Query 1 citation), WHERE-bounded to `timestamp > now() - make_interval(days => ${windowDays})` with the param number-typed and sql-template bound (T-04-08).
- Signature filter is fixed literals: `close_type = 'LOCAL_FORCE_CLOSE' AND time_locked_balance > 0 AND settled_balance::float / NULLIF(capacity, 0) < 0.8`.
- Computes `sig_count`, `sig_count_24h` (same filter + fixed `make_interval(hours => 24)` bucket), `avg_settled_ratio` and `total_time_locked` FILTERed to signature rows, and `MAX(timestamp) AS as_of`.
- Raw-row interface with `string | number | bigint` unions; ONE mapping layer coerces via `Number()` / `parseDbTimestampUtc` (WR-01) into the exported `HtlcRow`.
- `fetchHtlcTimeoutRows` lazy-imports `dbRouting` so the server-only client never enters the shape-test import graph (T-04-09 — asserted by a source-text test).

### detectHtlcTimeout + htlcTimeoutCards (Task 2)
- Pure `detectHtlcTimeout(rows, config, nodeMeta)`: critical when `sigCount24h >= htlcTimeoutCriticalCount` (supersedes warn — one card per node max), warn when `sigCount >= htlcTimeoutMinCount`, silent below (healthy band 0–1 FC/month). No hardcoded thresholds — proven by config-mutation tests (raised warn floor silences a 2-count node; lowered critical ceiling escalates; window string follows `htlcWindowDays`).
- Cards: signal `htlc_timeout_fc`, D-08 dedupe id `htlc_timeout_fc:{pubkey}:node`, target `{kind:"node"}`, investigate-ONLY suggestedAction (mechanism diagnosis is a human job), evidence `{metric: htlcTimeoutSignatureCloses, unit: closes, window: 30d|24h, deepLink: /:pubkey/closes}` with raw `detail.avgSettledRatio`/`detail.totalTimeLockedSat` (AFM-002 at render only).
- `htlcTimeoutCards(config, aliasByPubkey?)` executor lazy-imports `backendFor` (server-only env module) alongside the fetch, builds the per-node metadata map, and delegates to the pure detect.

## Verification

- `npx vitest run src/lib/insight/detectors/htlc-timeout.test.ts` — 14 tests green (7 shape + 7 fixture).
- `npx vitest run src/lib/insight` — 6 files, 56 tests green (no regression).
- `npx tsc --noEmit` and `npx eslint src/lib/insight/detectors/` clean.

## Deviations from Plan

### Minor sequencing adjustment

**1. [Sequencing] `htlcTimeoutCards` executor delivered in Task 2 instead of Task 1**
- **Found during:** Task 1
- **Issue:** The plan placed the `htlcTimeoutCards(config)` executor in Task 1, but its body must call `detectHtlcTimeout` (Task 2). Shipping it in Task 1 would require a stub or a non-compiling commit — both violate TDD gate discipline.
- **Fix:** Task 1 shipped the DB half as `fetchHtlcTimeoutRows` (lazy-import executor per the pattern); Task 2 added `htlcTimeoutCards` composing fetch + node metadata + detect. The plan's final exported surface is fully delivered.
- **Files modified:** src/lib/insight/detectors/htlc-timeout.ts
- **Commits:** 3a5343a, 865c995

## Requirements Note

INSIGHT-02 spans multiple wave-3 detector plans (04-03 fee/rebalance signals, this plan's HTLC-timeout signature, plus AP-11/AP-12 surfaces in sibling plans). This plan delivers only the HTLC-timeout slice, so INSIGHT-02 is NOT marked complete here — the orchestrator owns the REQUIREMENTS.md marking after the wave merges (also avoids parallel-agent write conflicts on the shared file).

## Known Stubs

None — no placeholder values, no empty-data wiring; all exports are fully implemented and tested.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. Both plan-assigned mitigations applied: T-04-08 (bound window param, fixed enum literals, shape-test asserted) and T-04-09 (lazy-import executor, source-text test).

## TDD Gate Compliance

RED → GREEN sequence verified per task in git log: 21196b3 (test) → 3a5343a (feat) → 5ba2b05 (test) → 865c995 (feat). No refactor commits needed.

## Self-Check: PASSED

- src/lib/insight/detectors/htlc-timeout.ts — FOUND
- src/lib/insight/detectors/htlc-timeout.test.ts — FOUND
- Commits 21196b3, 3a5343a, 5ba2b05, 865c995 — FOUND
