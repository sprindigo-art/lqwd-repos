---
phase: 02-fleet-overview-health-scorecard
plan: 04
subsystem: scorecard-dimensions
tags: [force-close, ap-11, restart, peer, dimensions, drizzle, sql-shape-tests]
requires:
  - 02-01 (lndNodeClosedChannels/lndRestart schema + verified enums)
  - 02-02 (DimensionResult type, SCORECARD_CONFIG tier1 metric key)
provides:
  - forceCloseForFleet (raw 30d LOCAL count + extras.maxHourlySelfCloses + coopRemoteShare)
  - restartForFleet (raw hours since last_restart; asOf excluded from freshness floor)
  - peerFromNodeInfo (pure transform; raw num_peers; partial note)
affects:
  - 02-06 fleet.ts (consumes all three Maps)
tech-stack:
  added: []
  patterns:
    - latest.ts skeleton (builder + lazy-import executor, no-DB shape tests via PgDialect.sqlToQuery)
    - bound number-only params; enum filters as fixed literals
key-files:
  created:
    - src/lib/scorecard/dimensions/force-close.ts
    - src/lib/scorecard/dimensions/force-close.test.ts
    - src/lib/scorecard/dimensions/restart.ts
    - src/lib/scorecard/dimensions/restart.test.ts
    - src/lib/scorecard/dimensions/peer.ts
    - src/lib/scorecard/dimensions/peer.test.ts
  modified: []
decisions:
  - "extras.coopRemoteShare omitted (not zeroed) when a node has no cooperative closes — NULLIF yields NULL and a fabricated 0 share would misread as 'all coop closes local-initiated'"
  - "hoursSince exported as a pure helper so the restart formula is unit-tested without a DB"
  - "peer.ts banner intentionally names lnd_node_peer_info in a comment (plan-mandated warning); the code-level guard is zero DB imports and no lndNodePeerInfo symbol"
metrics:
  duration: ~6 min
  completed: 2026-06-09T23:29:00Z
  tasks: 2
  files: 6
---

# Phase 02 Plan 04: Force-Close / Restart / Peer Dimensions Summary

30d LOCAL force-close grading with the AP-11 close-storm Tier-1 metric (extras.maxHourlySelfCloses), restart as a recency-only signal, and the partial peer dimension as a pure num_peers transform — completing the 7 computable dimensions for Wave 3 assembly.

## What Was Built

### force-close.ts (Task 1)
- `buildForceCloseAggSql(windowDays = 30)` — fleet-wide GROUP BY over `lnd_node_closed_channels` (one row per close, no DISTINCT ON needed — documented in comment): `COUNT FILTER (close_type = 'LOCAL_FORCE_CLOSE')` over a bound `make_interval(days => $1)` window, all-time coop-REMOTE share with `NULLIF` denominator guard, `MAX(timestamp) AS as_of`.
- `buildSelfCloseStormSql(windowHours = 24)` — AP-11 input: `date_trunc('hour')` buckets of `INITIATOR_LOCAL` closes, `MAX(hourly)` per node, bound window param.
- `forceCloseForFleet()` — runs both in parallel, merges into `Map<string, DimensionResult>`: raw = windowed LOCAL count; `extras.maxHourlySelfCloses` defaults to 0 when a node is absent from the storm query; `extras.coopRemoteShare` only when non-null.
- The extras key string `"maxHourlySelfCloses"` is asserted in tests against `SCORECARD_CONFIG.{lnd,ldk}.forceClose.tier1.metric` (T-02-07 — mismatch would silently disable the only HIGH-confidence Tier-1 line).

### restart.ts + peer.ts (Task 2)
- `buildRestartAllSql()` — defensive `DISTINCT ON (pubkey) ... ORDER BY pubkey, last_restart DESC` with `pubkey IS NOT NULL`, even though `lnd_restart` holds one row per node today.
- `restartForFleet()` — raw = hours since `last_restart` (1 decimal via pure `hoursSince` helper), null when unknown; asOf = `last_restart`. Banner states the RECENCY-ONLY scope (restart-loop Tier-1 deferred — no history in `lnd_restart`, RESEARCH Open Question 2) and that fleet.ts excludes restart from the D-13 freshness floor (RESEARCH A5).
- `peerFromNodeInfo(rows)` — PURE module (type-only imports, zero DB): raw = `num_peers ?? null` (0 preserved as the unreachable Tier-1 signal); asOf passthrough; every result carries the exact note `"partial — flap-rate needs event history"` (UI-SPEC copy key); banner forbids `COUNT(*)` of the cumulative `lnd_node_peer_info` (RESEARCH Pitfall 2).

## Verification

- `npx vitest run src/lib/scorecard/dimensions` — 3 files / 23 tests green (this worktree holds this plan's 3 dimension files; the other 4 are built by 02-03 in a parallel worktree — the "all 7 green" criterion completes at orchestrator merge).
- `npx tsc --noEmit` — green.
- Pitfall 2 grep: no `lndNodePeerInfo` symbol and no DB import anywhere in `src/lib/scorecard/dimensions/`; the raw table name `lnd_node_peer_info` appears only inside the plan-mandated warning comment in peer.ts.
- AP-11 key contract: test asserts config tier1 metric === `"maxHourlySelfCloses"` on both backends.

## Task Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | force-close dimension + AP-11 storm metric + tests | d478e80 | force-close.ts, force-close.test.ts |
| 2 | restart recency + partial peer + tests | 67a8bed | restart.ts, restart.test.ts, peer.ts, peer.test.ts |

## Deviations from Plan

None - plan executed exactly as written. (One clarification, not a deviation: the plan's verification grep `grep -l "lnd_node_peer_info" src/lib/scorecard/dimensions/` conflicts textually with the plan's own mandated peer.ts banner, which must contain that table name. Resolved per the acceptance criterion's intent — the guard is against the `lndNodePeerInfo` Drizzle symbol and DB imports, both verified absent.)

## Known Stubs

None — all three modules are fully wired; no placeholder values or unwired data paths.

## Threat Flags

None — no new surface beyond the plan's threat model. All queries are SELECT-only aggregates with bound number params; zero packages installed.

## Self-Check: PASSED

- src/lib/scorecard/dimensions/force-close.ts — FOUND
- src/lib/scorecard/dimensions/force-close.test.ts — FOUND
- src/lib/scorecard/dimensions/restart.ts — FOUND
- src/lib/scorecard/dimensions/restart.test.ts — FOUND
- src/lib/scorecard/dimensions/peer.ts — FOUND
- src/lib/scorecard/dimensions/peer.test.ts — FOUND
- Commit d478e80 — FOUND
- Commit 67a8bed — FOUND
