---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 09
subsystem: canary-gate
tags: [phase-gate, vitest, security-grep, canary-runbook, deferred-canary, rls]
requires: [15-01, 15-06, 15-07, 15-08]
provides:
  - Phase-15 gate result (full vitest suite + python test_extract + security grep battery)
  - CANARY-RUNBOOK.md "Data-Collection Expansion (Phase 15)" section (apply order + 8-table verification + deferred fleet-splice note)
affects: []
tech-stack:
  added: []
  patterns:
    - stdlib unittest runner for scripts/fileserver python tests (pytest not installed locally)
    - security grep battery as a phase gate (shell=True / f-string SQL / stored band / MAX-timestamp read)
key-files:
  created:
    - .planning/phases/15-data-collection-expansion-logs-deep-vm-metrics/15-09-SUMMARY.md
  modified:
    - scripts/fileserver/CANARY-RUNBOOK.md
decisions:
  - "Only Task 3 (the autonomous phase gate) was executed; Tasks 1 & 2 (live canary migration/grants/seed apply + canary tick verification) are OPERATOR-GATED and DEFERRED per operator decision — no live nodemon DB was touched"
  - "python tests run via stdlib `python3 -m unittest discover` (pytest not installed locally; the VALIDATION doc's pytest command falls back to unittest — same test file, same 27 assertions)"
  - "the two AFM-001 grep hits in the new readers are documentation comments (marked ❌ / 'never MAX(collected_at)'), not code — actual queries all use SELECT DISTINCT ON"
metrics:
  duration: ~10m
  completed: 2026-07-14
---

# Phase 15 Plan 09: Phase Gate + Canary Runbook Section Summary

Phase-15 gate run (Task 3 only): full vitest suite green except the four
pre-existing/environmental live-DB queue tests + the pre-existing NavRailShell
view-tab failures; all seven NEW Phase-15 suites + the python `test_extract` green;
security grep battery clean; `CANARY-RUNBOOK.md` extended with the Data-Collection
Expansion (Phase 15) canary procedure. Tasks 1 & 2 (live apply + canary tick) remain
DEFERRED per operator decision.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 3 | Phase gate — full suite + security grep battery + runbook section | (this commit) | scripts/fileserver/CANARY-RUNBOOK.md |

## Deferred / Pending Operator Action

**Tasks 1 & 2 of Plan 15-09 were NOT executed — they are operator-gated and
explicitly DEFERRED by the operator.** They remain the gate before COL-01/02/03 can
be marked end-to-end proven and before any fleet splice:

- **Task 1 (checkpoint:human-action, blocking) — live migration + grants + seed apply
  on the canary nodemon DB, owner-run.** NOT done. Migration
  `drizzle/nodemon/0003_moaning_randall.sql` has **NOT** been applied to the live
  nodemon DB — the file is generated, committed, and verified additive-only (Plan
  15-01), but the owner-run `psql` apply (0003 migration → `db/role-grants.sql`
  Phase-15 delta → `db/seed-log-patterns.sql`, in that order) plus the A1/A3
  precondition confirmations are pending. `nodemon_rw` lacks CREATE on schema
  `public`; this is a DB-owner (`postgres`) step, consistent with the project's
  operator-run-DDL discipline.
- **Task 2 (checkpoint:human-verify, blocking) — canary tick + real-row
  verification.** NOT done. Requires the expanded `collect_telemetry.py` deployed to
  a live canary and one `*/5` tick, then querying all 8 new tables for ≥1 canary row
  with no SQLSTATE 42501, no cross-host leakage (T-15-02), and message redaction held
  (T-15-05). Cannot run without a live nodemon DB / canary node.

Both are documented step-by-step in the new `CANARY-RUNBOOK.md` "Data-Collection
Expansion (Phase 15)" section (P15-1 bootstrap = Task 1; P15-2 expanded-tick = Task
2). COL-01/02/03 stay **canary-unproven** until the operator runs them; the
fleet-wide splice to all ~26 nodes (D-09) stays deferred behind that gate.

## What Was Built (Task 3)

### 1. Full test suite result

`npm test` → **Test Files 5 failed | 109 passed | 4 skipped (118)**; **Tests 8
failed | 1300 passed | 53 skipped (1361)**. Every failing file is a
known pre-existing / environmental failure unrelated to Phase 15:

| Failing file | Why (pre-existing, acceptable) |
|--------------|--------------------------------|
| `src/lib/queue/enqueue.test.ts` | live-DB integration — `Missing required env: NODEMON_QUEUE_URL` (worktree has no queue DSN) |
| `src/lib/queue/approve.test.ts` | live-DB integration (permission denied / DSN) |
| `src/lib/queue/claim.test.ts` | live-DB integration (permission denied / DSN) |
| `src/lib/queue/stub-executor.test.ts` | live-DB integration (permission denied / DSN) |
| `src/components/df/NavRailShell.test.tsx` | 4 pre-existing view-tab toggle failures (red before Phase 15) |

These are exactly the failures the plan/task spec designates as acceptable (the four
`src/lib/queue` live-DB integration tests + the pre-existing NavRailShell view-tab
toggle tests). No Phase-15 file is among them.

**Every NEW Phase-15 suite is green** (`npx vitest run` targeted, 6 files → **163
passed | 4 skipped**):

- `src/lib/read/telemetry-bands.test.ts` ✅
- `src/lib/read/counter-delta.test.ts` ✅
- `src/lib/read/service-log-events.test.ts` ✅
- `src/lib/read/host-metrics-ext.test.ts` ✅
- `src/lib/read/pg-health.test.ts` ✅
- `src/lib/insight/detectors/ap12-advisory.test.ts` ✅

**Python `test_extract`** (`python3 -m unittest discover -s scripts/fileserver -p
'test_*.py'`, pytest not installed locally) → **Ran 27 tests … OK** ✅.

### 2. Security grep battery (all clean)

| # | Check | Command | Result |
|---|-------|---------|--------|
| G1 | no `shell=True` in the collector | `grep -nE "shell=True" scripts/fileserver/collect_telemetry.py` | **no matches** (exit 1) — clean |
| G2 | no f-string / `.format()` SQL in the collector | `grep -nE "f\"(INSERT\|UPDATE\|SELECT\|DELETE)\|f'(INSERT\|UPDATE\|SELECT\|DELETE)\|\.format\(.*(INSERT\|UPDATE\|SELECT\|DELETE)" scripts/fileserver/collect_telemetry.py` | **no matches** (exit 1) — clean |
| G3 | no stored severity/band/stale column in any new fact table (D-14) | `grep -niE "\b(severity\|band\|stale)\b" drizzle/nodemon/0003_moaning_randall.sql` | **no matches** (exit 1) — clean |
| G4 | no `WHERE collected_at = MAX(...)` / non-DISTINCT-ON latest read in the new readers (AFM-001) | `grep -rnE "MAX\(collected_at\)" src/lib/read/{service-log-events,host-metrics-ext,pg-health}.ts` | only **documentation comments** (`❌ … AFM-001 failure`, `never MAX(collected_at)`); actual queries all use `SELECT DISTINCT ON` — clean |

G4 note: the three raw hits (`pg-health.ts:15`, `host-metrics-ext.ts:16`,
`pg-health.ts:131`) are all comment lines that warn against the anti-pattern and mark
the ✅ `SELECT DISTINCT ON (…) ORDER BY …, collected_at DESC` alternative. `grep -rniE
"distinct on"` confirms every new reader builds its latest-per-entity fragment with
DISTINCT ON — no code uses a MAX-timestamp latest read.

### 3. CANARY-RUNBOOK.md — "Data-Collection Expansion (Phase 15)" section

Appended after the Phase-11 telemetry section, mirroring its idiom. Documents:

- **Apply order (D-18):** `0003` migration (owner) → `db/role-grants.sql` Phase-15
  delta (owner; UPDATE granted ONLY on `log_patterns`) → `db/seed-log-patterns.sql`
  (owner), with an explicit "**Status: NOT YET APPLIED**" callout that migration 0003
  is not on the live DB.
- **A1** (`PG_PROBE_CONNINFO` reads `pg_stat_activity` / `pg_stat_database`) and
  **A3** (a `postgres` `service_inventory` row with a readable `artifact_path`
  exists) preconditions, each with a verification command.
- **Per-table verification queries (from Task 2):** the 7-way UNION count/`max`
  query proving ≥1 row in each of `service_log_events`, `log_patterns`,
  `host_metrics_ext`, `host_cpu_core`, `host_disk_io`, `host_net_iface`, `pg_health`;
  the `host_id = <canary>` isolation check (no cross-host leak, T-15-02); the no-42501
  assertion (T-15-03); and the message-redaction spot-check (T-15-05).
- **Deferred fleet splice (D-09):** an explicit note that the ~26-node splice is the
  deferred rollout step and `CRON_JOB_12` stays **unchanged** for the canary.

Verify: `grep -q "Phase 15" scripts/fileserver/CANARY-RUNBOOK.md` → **PASS**.

## Deviations from Plan

None for Task 3 — executed exactly as written (suite run + recorded, security grep
battery run + recorded, runbook section added). Tasks 1 & 2 were intentionally NOT
executed per the operator's explicit deferral (documented above), not a deviation.

## Threat Flags

None — no new security surface introduced. Task 3 is a documentation + verification
gate; the runbook section restates the existing Phase-15 threat mitigations
(T-15-02 RLS isolation, T-15-03 scoped UPDATE, T-15-05 redaction, T-15-08/D-14 no
stored bands, T-15-09 least-privilege pg probe) as canary acceptance checks.

## Known Stubs

None. The un-stub swaps (logs / deep vitals) were completed in Plan 15-08; this plan
only gates and documents.

## Self-Check: PASSED

- FOUND: scripts/fileserver/CANARY-RUNBOOK.md ("Data-Collection Expansion (Phase 15)" section; `grep -q "Phase 15"` passes)
- FOUND: .planning/phases/15-data-collection-expansion-logs-deep-vm-metrics/15-09-SUMMARY.md
- VERIFIED: all 6 Phase-15 vitest suites green (163 passed / 4 skipped); python test_extract 27 passed
- VERIFIED: security grep battery clean (G1–G4)
- Commit hash recorded by the harness on commit of this file + CANARY-RUNBOOK.md
