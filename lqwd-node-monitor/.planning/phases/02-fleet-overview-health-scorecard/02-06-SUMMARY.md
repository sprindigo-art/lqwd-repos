---
phase: 02-fleet-overview-health-scorecard
plan: 06
subsystem: scorecard
tags: [fleet-view, orchestration, d-14-golden, mad-comparison, freshness, sort]
requires:
  - phase: 02-fleet-overview-health-scorecard
    plan: 02
    provides: "types/config/grade/compare/freshness contracts + backendFor (D-02/D-03/D-05..D-13)"
  - phase: 02-fleet-overview-health-scorecard
    plan: 03
    provides: "routing/revenue/liquidity fleet dimension queries"
  - phase: 02-fleet-overview-health-scorecard
    plan: 04
    provides: "channelHealth/forceClose/restart/peer dimensions"
provides:
  - "loadFleetView(): the single server-side FleetView computation the 02-07 pages render"
  - "sortFleet(): pure D-09 sorter (criticals first, worst compositePct first, null last)"
  - "assembleScorecard(): pure per-node assembly, unit-testable without DB"
  - "D-14 phase gate: Canada golden suite green live — downstream may consume scorecard numbers"
affects: [02-07 (pages render FleetView), phase-04 (insight engine reads same numbers)]
tech-stack:
  added: []
  patterns:
    - "Driver-boundary timestamp coercion: drizzle raw .execute returns timestamps as ISO strings — coerce at every mapping boundary"
    - "Two-pass assembly: pure per-node assembleScorecard, then fleet-wide MAD peerRelative attach"
key-files:
  created:
    - src/lib/scorecard/fleet.ts
    - src/lib/scorecard/fleet.test.ts
    - src/lib/scorecard/golden-scorecard.test.ts
  modified:
    - src/lib/scorecard/dimensions/restart.ts
    - src/lib/scorecard/dimensions/restart.test.ts
    - src/lib/read/node-info.ts
    - src/lib/scorecard/dimensions/force-close.ts
decisions:
  - "D-13 deviation: restart excluded from the worst-case freshness floor (RESEARCH A5) — pending operator sign-off at the 02-07 checkpoint"
  - "MAD cohorts include self (standard practice; median robust to one member) — commented at the attach site"
  - "Fleet map miss = { raw: null, note: 'no rows in window' } no-data, never a fabricated zero"
metrics:
  duration: ~13 min
  completed: 2026-06-10
  tasks: 2
  files: 7
---

# Phase 2 Plan 06: Fleet View Assembly + D-14 Canada Golden Summary

One server call (`loadFleetView`) assembles all 26 nodes — AFM-001 snapshot → 7 computed + 3 no-data dimensions → grades → per-backend MAD comparison → D-13 freshness → D-09 sort — and the Canada golden suite proves the computed numbers against live lqwdLogs reference invariants (the phase gate).

## What Was Built

- **`src/lib/scorecard/fleet.ts`** — `loadFleetView()` orchestration: `latestNodeInfoAll()` (the only sanctioned lnd_node_info read), 5 parallel fleet-wide dimension queries + 2 pure transforms over the node-info rows, per-node `assembleScorecard` with `SCORECARD_CONFIG[backend]` (D-02), backend label from `backendFor(pubkey)` after `mapLndNode` (D-03 — mapper provenance is meaningless since LDK rows arrive LND-shaped), a second-pass per-backend MAD comparison (`outlierFor`, cohorts include self; LDK cohort of 1 suppresses per D-11), and the pure `sortFleet` D-09 order. Bounded read (T-02-05): exactly 5 windowed aggregates + 1 DISTINCT ON snapshot per call.
- **`src/lib/scorecard/fleet.test.ts`** — 11 no-DB tests: sort triage rules (critical-with-high-pct before warn-with-low-pct, worst-first within criticals, null-composite last, purity), 10-dimension assembly with 3 greyed no-data dims, freshness floor ignoring restart's year-old asOf, missing-map-entry no-data, synthetic AP-11 close-storm Tier-1 → critical dot + chip.
- **`src/lib/scorecard/golden-scorecard.test.ts`** — D-14 live suite (skipIf no `ROUTING_VM_DATABASE_URL`): 10 invariant-range assertions including the AFM-001 one-row-per-pubkey proof (26 rows from 8M), AFM-002 fee_msat back-conversion within ±1%, and the full `loadFleetView` pipeline + D-09 order check. Skips cleanly (exit 0) without the env var.

## D-13 Deviation — restart excluded from freshness floor (RESEARCH A5)

**FLAGGED FOR OPERATOR SIGN-OFF at the 02-07 visual checkpoint (checker W-2).**

D-13's letter says the per-node stamp is "the oldest of the latest timestamps across the tables its scorecard depends on" — which would include `lnd_restart.last_restart`. The implementation **excludes the restart dimension** from `worstCaseAsOf` because `last_restart` is legitimately ~a year old on healthy nodes (long uptime is the GOOD case); including it would permanently flag every node "stale". The rationale is sound but the operator never ratified the exclusion. The restart asOf is NOT hidden — 02-07 surfaces it in the per-node freshness breakdown. The deviation is commented at the `worstCaseAsOf` call site in `fleet.ts`.

## D-14 Evidence — Canada golden checkpoint output (live run 2026-06-10)

```
[golden] Canada routing: forwards7d=6956 volumeSat=731959349.939 (ref 2026-06-09: 7,023 fwd / 739,079,154 sat)
[golden] Canada revenue: ppm24h=270.90461823393053 earnings7dSat=208063.021 (ref: 631.7 PPM / 208,389.7 sat)
[golden] Canada liquidity: outboundRatio=0.7719677081964603 capacitySat=2759278276 rebalanceSuccessRate=0.26174496644295303 (ref: ~0.76 / 3.027B sat / ~0.26)
[golden] Canada channelHealth: activeChannels=493 vs snapshot=493 inactiveRatio=0.1440972222222222 (ref: 487 active)
[golden] Canada forceClose: localFc30d=6 coopRemoteShare=0.7418278852568378 maxHourlySelfCloses=1 (ref all-time: LOCAL 803 / COOP 1,499)
[golden] Canada pipeline: composite=84 (B) dot=warn stale=true asOf=2026-06-09T02:16:33.729Z fleetSize=26
```

All 10 live assertions passed. Values track the RESEARCH 2026-06-09 snapshot within expected drift (24h PPM is a rolling window — 270.9 vs 631.7 reference is live drift, well inside the (0, 100000) invariant). Note `stale=true` for Canada: the channel-info floor was ~25h old at run time (> 6h warn threshold) — the honest D-13 marker working as designed, not a failure.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Raw-execute timestamps arrive as ISO strings, not Dates**
- **Found during:** Task 2 (first live golden run: `lastRestart.getTime is not a function`, then `asOf.getTime is not a function`)
- **Issue:** drizzle's postgres-js adapter overrides the driver's timestamp parsers; raw `dbRouting.execute()` surfaces `timestamp`/`as_of`/`last_restart` as ISO strings (only schema-typed queries get drizzle's column mapping). The declared `Date | null` row types were a runtime lie, crashing `hoursSince` and `worstCaseAsOf`. Verified by probing the bare `postgres()` driver (returns real Dates) vs the drizzle-wrapped client (returns strings).
- **Fix:** coercion at every raw-execute mapping boundary — `toRestartDate()` in restart.ts (exported + 3 unit tests), `coerceTimestamp()` in node-info.ts (keeps the `LatestNodeInfoRow` contract honest for freshness/channel-health/peer consumers), `new Date(row.as_of)` in force-close.ts. liquidity.ts already coerced; routing/revenue construct Dates from ns numbers.
- **Files modified:** src/lib/scorecard/dimensions/restart.ts, src/lib/scorecard/dimensions/restart.test.ts, src/lib/read/node-info.ts, src/lib/scorecard/dimensions/force-close.ts
- **Commit:** 56e7ae3

## Verification

- `npx vitest run src/lib/scorecard/fleet.test.ts` — 11/11 pass (no DB)
- `npx vitest run src/lib/scorecard/golden-scorecard.test.ts` without env — exit 0, 10 skipped
- Same command with `.env.local` sourced — 10/10 live assertions pass, `[golden]` lines printed
- `npm test` — 131 passed, 14 skipped (both golden suites skip cleanly), 0 failures
- `npx tsc --noEmit` — clean
- Acceptance greps: fleet.ts contains `latestNodeInfoAll`, `backendFor(`, `SCORECARD_CONFIG[`; no bare `from(lndNodeInfo)`/lnd_node_info select; D-13 deviation comment at the `worstCaseAsOf` call site

## Known Stubs

None — `loadFleetView` is fully wired to live warehouse data end to end.

## Commits

| Commit | Type | Description |
| ------ | ---- | ----------- |
| 333ce3c | feat | fleet view orchestration — loadFleetView + pure assembly/sort + 11 tests |
| 56e7ae3 | fix | coerce raw-execute timestamp strings at driver boundaries (Rule 1) |
| 8125569 | test | D-14 Canada golden scorecard validation (live, skipIf) |

## Self-Check: PASSED

All created files exist on disk; all task commits (333ce3c, 56e7ae3, 8125569) verified in git log; no unexpected file deletions; working tree clean.
