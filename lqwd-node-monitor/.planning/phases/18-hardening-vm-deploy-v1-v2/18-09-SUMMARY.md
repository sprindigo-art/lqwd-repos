---
phase: 18-hardening-vm-deploy-v1-v2
plan: 09
subsystem: queue
tags: [hmac, ttl, double-apply, rls, postgres, bash, lncli, node-executor]

# Dependency graph
requires:
  - phase: 18-01
    provides: DB-required node-script test harness (pg-harness, fail-on-skip)
  - phase: 18-02
    provides: committed Q1/I1/Q3 base (signed-payload value binding, live time_lock_delta, env rate-limit ceiling)
provides:
  - Node-side TTL re-check against the SIGNED expiresAt (Q5) — the mutable expires_at column is no longer trusted
  - commandId ↔ claimed-row-id binding (Q5b) — an older approved command's genuine (payload,signature) cannot be transplanted
  - commit1 double-apply guard (Q4) — UPDATE ... RETURNING id + conditional audit; abort before apply-fee on an unconfirmed flip
  - Idle-tick sweep preservation (Q-idle) — expire/reaper run in their own committed txn; claim txn is NULLIF-guarded
  - Same-cluster hardening — Q6 outcome='succeeded' rate-limit filter, Q7 generic-secret fallback removed, single-source reaper window
affects: [18-canary-runbook, vm-deploy, queue-execution]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signed bytes are the sole authority for TTL + command identity (mutable columns never trusted)"
    - "Data-modifying CTE (UPDATE ... RETURNING) with a conditional audit INSERT + confirmation marker"
    - "Sweeps committed independently of the claim so an empty tick cannot roll them back"
    - "Single-source config via one env var + one shared fallback across the bash tick and the TS sweep"

key-files:
  created: []
  modified:
    - scripts/node/apply-fee
    - scripts/node/apply-fee.test.sh
    - scripts/node/check-queue
    - scripts/node/check-queue.test.sh
    - src/lib/queue/claim.ts
    - src/lib/queue/claim.test.ts

key-decisions:
  - "TTL is re-checked from the signed expiresAt (payload field 5) in apply-fee, parsed to epoch with GNU date then BSD date fallback; unparseable expiry fails closed as ttl_expired."
  - "commandId binding is enforced in apply-fee against a new --claimed-id passed by check-queue; a missing or mismatched id fails closed (command_id_mismatch) before any lncli call."
  - "The claimed→executing flip uses UPDATE ... RETURNING id inside a CTE with a conditional audit INSERT; the tick aborts (exit 1) unless the committed flip is confirmed via an EXECUTING marker — apply-fee never runs against an unconfirmed flip."
  - "Expire/reaper sweeps were split into their own committed transaction; the claim transaction pre-seeds cand_id='' and guards every id comparison with NULLIF(:'cand_id','')::uuid, so an empty-queue tick commits cleanly under ON_ERROR_STOP=1."
  - "Reaper window is single-sourced: both check-queue and claim.ts read NODEMON_CLAIMED_TIMEOUT_MS with a shared 15-min (900000ms) fallback (raised from the old 5-min TS default)."

patterns-established:
  - "Signed-payload-as-sole-authority: every executor-applied value + TTL + identity derives from the HMAC-covered canonical_payload, never the independently-mutable DB columns."
  - "Confirm-before-act: mutate with RETURNING, require the returned marker, abort if the commit cannot be confirmed."

requirements-completed: [HARDEN-01]

# Metrics
duration: 40min
completed: 2026-07-27
---

# Phase 18 Plan 09: Queue Trust-Boundary Hardening Summary

**The signed payload is now the sole authority for TTL and command identity, the claimed→executing flip is confirm-before-apply so a DB blip can no longer double-apply a fee, empty ticks preserve the fail-closed sweeps, and the same-cluster hardening (outcome-filtered rate limit, per-node-only secret, single-source reaper window) landed on top of the committed Q1/I1/Q3 base.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 completed
- **Files modified:** 6
- **Commits:** 2 task commits (+ this summary commit)

## Accomplishments

### Task 1 — Signed expiresAt TTL re-check + commandId binding (Q5, Q5b) — commit d179276
- `apply-fee` now parses `expiresAt` (canonical_payload field 5) and `commandId` (field 2) from the SIGNED bytes.
- **Q5 (TTL):** the signed expiresAt is parsed to epoch (GNU `date -d` then BSD `date -j` fallback) and compared to now; expiry — or an unparseable value — fails closed `ttl_expired` before any `lncli` call. The mutable `commands.expires_at` column is no longer trusted for TTL.
- **Q5b (identity):** `apply-fee` takes a new `--claimed-id` and requires it to equal the signed commandId; a missing or mismatched id fails closed `command_id_mismatch`. This blocks transplanting an older approved command's genuine `(payload,signature)` onto a different claimed row.
- `check-queue` passes the claimed row id via `--claimed-id "$CLAIM_ID"`.
- `apply-fee.test.sh`: added the `signed-ttl` case (past signed expiresAt → `ttl_expired`, no `updatechanpolicy`) and the `commandid-binding` case (commandId≠claimed-id → `command_id_mismatch`, no `updatechanpolicy`). All 6 golden cases pass.

### Task 2 — commit1 double-apply guard + idle-tick sweeps + same-cluster hardening (Q4, Q-idle, Q6, Q7, reaper window) — commit 212d0ec
- **Q4 (double-apply):** the claimed→executing flip is `UPDATE ... RETURNING id` in a CTE with a CONDITIONAL audit INSERT and an `EXECUTING`<tab>id confirmation marker. If psql rc≠0 OR no marker is returned, the tick aborts (exit 1) with a log and never calls `apply-fee`.
- **Q-idle:** the expire + reaper sweeps were moved into their OWN committed transaction (run before, and independent of, the claim). The claim transaction pre-seeds `\set cand_id ''` and wraps every id comparison in `NULLIF(:'cand_id','')::uuid`, so an empty-queue tick commits cleanly under `ON_ERROR_STOP=1` and cannot roll back the sweeps.
- **Q6:** the hourly rate-limit count now filters `ce.outcome='succeeded'`, so transient `lncli` failures on one channel never exhaust the node-wide apply budget.
- **Q7:** the generic-secret fallback (`${!SECRET_VAR:-${NODEMON_HMAC_SECRET:-}}`) was removed; the node resolves ONLY the per-pubkey key and fails closed without it.
- **Reaper window (Q4-window):** single-sourced — both `check-queue` (`CLAIMED_TIMEOUT_MS`) and `claim.ts` (`defaultClaimedTimeoutMs`) read `NODEMON_CLAIMED_TIMEOUT_MS` with the SAME 900000ms (15 min) fallback; the divergent 5-min TS default was removed.
- Tests: `check-queue.test.sh` adds a double-apply-guard case (simulated unconfirmed flip → abort, no execution row, never `succeeded`) and an idle-tick sweep case (empty-queue tick still lands the expired row `expired`); it also exports the per-pubkey secret to match the Q7 change. `claim.test.ts` adds pure single-source reaper-window assertions.

## Verification

- `bash scripts/node/apply-fee.test.sh` — **PASS** (6/6 golden cases; `ttl_expired` present in `apply-fee` outside comments).
- `npx vitest run src/lib/queue/claim` — **PASS** (3 new pure reaper-window tests pass; 7 DB-required cases skip locally with no `nodemon` DB, per the 18-01 fail-on-skip convention — they run under the CI Postgres harness).
- `npx tsc --noEmit` — **clean** (no type errors).
- `npx eslint src/lib/queue/claim.ts src/lib/queue/claim.test.ts` — **clean** (only the pre-existing ~10 base ESLint errors on unrelated files remain, untouched per plan note).
- `bash -n` — clean on `apply-fee`, `check-queue`, `check-queue.test.sh`.
- `check-queue.test.sh` node-script integration cases (Q3/Q4/Q-idle) require the docker/podman Postgres harness; they are visibly skipped locally and execute under CI (18-01 fail-on-skip). They were authored against the existing harness fixture and validated for shell syntax.

## Threat Register Outcomes

| Threat ID | Disposition | Landed mitigation |
|-----------|-------------|-------------------|
| T-18-19 (expires_at column extended) | mitigated | `apply-fee` fail_closed `ttl_expired` from signed field 5 |
| T-18-20 (older payload/signature transplanted) | mitigated | commandId (field 2) bound to `--claimed-id` |
| T-18-21 (double-apply via unchecked commit1) | mitigated | `UPDATE ... RETURNING id`; abort on no-flip; conditional audit |
| T-18-22 (shared generic secret across nodes) | mitigated | generic-secret fallback removed; fail closed without per-pubkey key |
| T-18-23 (failed rows exhaust rate budget) | mitigated | rate-limit count filters `outcome='succeeded'` |

## Deviations from Plan

None — plan executed as written. Both Task 1 and Task 2 landed exactly the specified changes.

Notes on implementation choices within the plan's latitude:
- The plan offered "split sweeps into their own committed transaction OR pre-seed `\set cand_id ''` and guard" for Q-idle. Both were applied (belt-and-suspenders): sweeps committed independently AND the claim txn is NULLIF-guarded.
- The single-source reaper default was set to 15 min (900000ms) — the more conservative of the two pre-existing values (bash 15m vs TS 5m) — to stay strictly greater than the max claim→execute latency.

## Known Stubs

None. No hardcoded empty/placeholder values were introduced; all changes are behavior on live signed rows.

## Self-Check: PASSED

- All 6 modified files verified present on disk.
- Both task commits verified in git log: `d179276` (Task 1), `212d0ec` (Task 2).
