---
phase: 03-per-node-console-pending-monitor
plan: 01
subsystem: read-layer
tags: [pending-channels, drizzle, recency-filter, console-config, tdd]
requires:
  - phase: 02
    provides: "latest.ts builder/lazy-executor pattern, db-timestamp.ts parseDbTimestampUtc, golden.test.ts scaffold, scorecard/config.ts tuning-surface philosophy"
provides:
  - "lndNodePendingChannels + lndNodePendingSweeps typed in the read-only routing schema (timestamptz, corrected identities)"
  - "src/lib/console/config.ts — WINDOW_PRESETS, DEFAULT_WINDOW, ROW_CAP, PENDING_RECENCY_HOURS, TAB_KEYS, EXPORTABLE_TABS (the phase's single tuning surface)"
  - "src/lib/read/pending.ts — buildCurrentPendingChannelsSql, buildCurrentPendingSweepsSql, currentPendingChannels, currentPendingSweeps, buildPendingView, pendingSummary + PendingView/PendingNodeGroup/PendingRow/PendingSweepRow types"
affects:
  - "03-02..03-09 (all later plans import config.ts and/or pending.ts)"
  - "src/components/console/PendingBoard.tsx (plan 03-05 imports the PendingView types)"
tech-stack:
  added: []
  patterns:
    - "Recency-filtered currently-pending read (updated_at > now() - make_interval(hours => $n)) — the only sanctioned path over residue-retaining pending tables"
    - "Pure view shaper with injectable `now` for deterministic age math (T-02-07: UI renders shape verbatim)"
key-files:
  created:
    - src/lib/console/config.ts
    - src/lib/console/config.test.ts
    - src/lib/read/pending.ts
    - src/lib/read/pending.test.ts
    - src/lib/read/golden-pending.test.ts
  modified:
    - src/lib/db/schema/routing.ts
decisions:
  - "buildPendingView sections typed Record<string, PendingRow[]> (three enum keys always present) so an unexpected channel_state value still renders rather than being dropped — every sat accounted for"
  - "pendingSummary reuses buildCurrentPendingChannelsSql fleet-wide and reduces in JS (recency-filtered set is ~63 rows) — one sanctioned SQL path instead of a second count query"
  - "REQUIREMENTS.md not touched: PENDING-01 spans later UI plans (03-05+); orchestrator owns shared-file writes post-wave"
metrics:
  duration: ~9 min
  tasks: 3
  completed: 2026-06-10
---

# Phase 3 Plan 01: Pending Data Foundation Summary

Recency-filtered pending-channel reader (DISTINCT ON channel_point, 6h updated_at window) with grouped/nested/orphan-retaining view shaper, plus the typed pending tables and the central console config every later Phase 3 plan imports.

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | Type pending tables in read-only schema | 53ab6e5 | src/lib/db/schema/routing.ts |
| 2 | Console config tuning surface (TDD) | 69bf43d (RED), 82473d4 (GREEN) | src/lib/console/config.ts, config.test.ts |
| 3 | Sanctioned pending reader + shaper + golden test (TDD) | 4342a98 (RED), 0bfa99e (GREEN) | src/lib/read/pending.ts, pending.test.ts, golden-pending.test.ts |

## What Was Built

- **Schema (Task 1):** `lndNodePendingChannels` (24 cols) and `lndNodePendingSweeps` (17 cols) typed exactly from the RESEARCH live introspection. Both carry `timestamp(..., { withTimezone: true })` — the only timestamptz tables in routing_vm (ldk.ts lsps1_orders precedent). The old stub's wrong claim that sweeps key on `local_pubkey` was deleted; sweeps identity is `lnd_pubkey`. Doc banners document residue semantics (upsert-per-tick, rows persist after resolution), the verified `channel_state` enum {PENDING_OPEN, WAITING_CLOSE, FORCE_CLOSE}, and the sweep→force-close join key (`closing_txid = outpoint_txid`, orphans exist). No drizzle-kit commands run, no migrations created.
- **Config (Task 2):** Pure module exporting `WINDOW_PRESETS` (URL key → bound integer days, D-06), `DEFAULT_WINDOW = "7d"` (D-05), `ROW_CAP = 500` (D-07), `PENDING_RECENCY_HOURS = 6` (A3, golden-verified), `TAB_KEYS` in D-01 order + `TabKey`, `EXPORTABLE_TABS` (NODE-02 minimum). 6 passing tests; zero `server-only` references.
- **Reader (Task 3):** `buildCurrentPendingChannelsSql` (DISTINCT ON + NULL guard + `make_interval(hours => $n)` recency + optional bound `local_pubkey`), `buildCurrentPendingSweepsSql` (recency + optional bound `lnd_pubkey`, no DISTINCT ON), lazy executors via `await import("@/lib/db/warehouse-routing")`, `buildPendingView` pure shaper (per-node groups, sections by verbatim state, created_at-ASC oldest-first, sweep nesting by txid, `unattachedSweeps` orphan retention, `asOf` = max updated_at via `parseDbTimestampUtc`), and `pendingSummary` for the D-12 TriageStat (separate read; `loadFleetView` untouched). 14 shape/shaper assertions passing; golden test skips cleanly without `ROUTING_VM_DATABASE_URL`.

## Verification Results

- `npx vitest run src/lib/read src/lib/console` — 47 passed, 5 skipped (live golden suites, no DB env in worktree)
- `npx tsc --noEmit` — clean
- `grep -c "new Date(" src/lib/read/pending.ts` — 1, and it is the injectable `now: Date = new Date()` default parameter only (no raw warehouse-string parse)
- Lazy `await import` present in pending.ts; no `max(` in either builder; SQLi payloads land in params (asserted)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan-referenced 03-PATTERNS.md absent from worktree**
- **Found during:** Execution start
- **Issue:** `.planning/phases/03-per-node-console-pending-monitor/03-PATTERNS.md` is untracked in the main repo and therefore not present in this worktree (worktrees carry committed state only)
- **Fix:** Proceeded using the plan's inline task detail + 03-RESEARCH.md, which fully specify the required contents (the plan duplicated the PATTERNS contracts inline)
- **Files modified:** none
- **Commit:** n/a

**2. [Rule 1 - Bug] Doc comment tripped the `server-only` grep acceptance gate**
- **Found during:** Task 2 verification
- **Issue:** The config banner comment said "NO server-only import", making `grep -c "server-only"` return 1 against the acceptance criterion of 0
- **Fix:** Reworded to "no server runtime imports"
- **Files modified:** src/lib/console/config.ts
- **Commit:** 82473d4

## Authorization Gates

**Live golden run deferred (operator action required).** The verification step "golden pending test green against the live warehouse" could not be executed by this agent: sourcing the production `.env.local` and querying the live routing_vm warehouse was denied by the permission classifier (production read requires explicit user approval). The test is fully wired and skip-gated; to run it once:

```bash
set -a; source .env.local; set +a
npx vitest run src/lib/read/golden-pending.test.ts
```

Expected: 2 tests pass, `[golden]` lines print per-node opens/limbo cross-checks. This is also covered by the phase-gate sampling rule (RESEARCH §Sampling Rate: "golden pending test run once against the live warehouse" before /gsd-verify-work).

## Known Stubs

None — no UI surfaces in this plan; all exports are wired to real query/shaping logic.

## Threat Flags

None — the only new surfaces are the two SQL builders, both covered by the plan's threat model (T-03-01 bound params asserted by test; T-03-02 recency filter + golden test; T-03-03 recency-bounded scans).

## TDD Gate Compliance

Both TDD tasks completed the RED → GREEN sequence with separate commits: 69bf43d→82473d4 (config), 4342a98→0bfa99e (pending). No refactor commits needed.

## Notes for the Orchestrator

- REQUIREMENTS.md intentionally not modified: PENDING-01 is completed by the UI plans later in this phase; marking it now would be premature and would conflict with parallel worktree agents.
- STATE.md / ROADMAP.md untouched per worktree-mode contract.

## Self-Check: PASSED

All 6 created/modified files exist; all 5 task commits (53ab6e5, 69bf43d, 82473d4, 4342a98, 0bfa99e) present in git log.
