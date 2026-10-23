---
phase: 06-command-queue-approval-ui-prong-1
plan: 04
subsystem: command-queue
tags: [queue, concurrency, ttl, reaper, stub-executor, integration-tests, postgres-advisory-lock]
requires:
  - "commands / command_executions / command_audit tables + command_state enum (06-01)"
  - "canTransition / isExpired pure state machine (06-02)"
  - "dbNodemon RW client + live migrated nodemon DB (06-01)"
provides:
  - "claimNext() — atomic FOR UPDATE SKIP LOCKED single-row claim (no double-apply)"
  - "expireSweep(now) — fail-closed TTL → expired (D-11)"
  - "reaperSweep(now, timeoutMs) — stale-claim release → approved (D-14)"
  - "runStubExecutor(outcome) — TEST-ONLY post-approval driver (D-13)"
  - "test/db-suite-lock.ts — advisory-lock serializer for shared-DB integration suites"
affects:
  - "Phase 7 node-side executor (will invoke the same claim/transition grammar)"
tech-stack:
  added: []
  patterns:
    - "Drizzle .for(\"update\", { skipLocked: true }) → SELECT … FOR UPDATE SKIP LOCKED in a transaction"
    - "Independent fail-closed UPDATE…WHERE sweeps over an injectable clock (now=)"
    - "Per-transition command_audit insert paired with each guarded state flip"
    - "Postgres pg_advisory_lock on a reserved postgres.js connection to serialize shared-DB test suites"
key-files:
  created:
    - "src/lib/queue/claim.ts"
    - "src/lib/queue/claim.test.ts"
    - "src/lib/queue/stub-executor.ts"
    - "src/lib/queue/stub-executor.test.ts"
    - "test/db-suite-lock.ts"
  modified: []
decisions:
  - "Reaper releases stale claims back to 'approved' (re-claimable) rather than 'failed' — the legal claimed→approved reaper edge in state.ts; rescues a dead executor's orphaned claim without burning the intent."
  - "claimNext stays GLOBAL (claims oldest approved across all node_pubkeys = production semantics); test-suite races are solved by an advisory-lock serializer, NOT by weakening the claim to a per-pubkey filter."
metrics:
  duration_min: 21
  completed: 2026-06-16
  tasks: 2
  files: 5
  commits: 5
  tests_added: 10
---

# Phase 6 Plan 04: Atomic Claim + TTL + Reaper + Stub Executor Summary

QUEUE-04's core safety proof: an atomic `claimNext()` (`SELECT … FOR UPDATE SKIP LOCKED`) that guarantees no double-apply under overlapping ticks, independent fail-closed `expireSweep`/`reaperSweep` over an injectable clock, and a TEST-ONLY `runStubExecutor` that drives `claimed→executing→succeeded|failed` — all proven green against the live local `nodemon` DB.

## What Was Built

**Task 1 — `src/lib/queue/claim.ts`** (`feat 2661b5a`, RED `test 386bf80`)
- `claimNext()`: in one `dbNodemon.transaction`, selects the oldest `approved` row with `expiresAt > now()`, `.for("update", { skipLocked: true })`, flips it to `claimed` (sets `claimedAt`) under a `WHERE id=? AND state='approved'` guard, and writes the `approved→claimed` audit row (actor `executor`). Returns `{ id }` or `null`. The DB row-lock is the no-double-apply primitive: two overlapping ticks → the loser SKIPs the locked row and returns `null`.
- `expireSweep(now = new Date())`: fail-closed TTL. Selects every pre-execution row (`pending_approval | approved | claimed`) past `expires_at`, flips them to `expired`, and writes one audit row per victim. `claimNext` already filters `expires_at > now()`, so an expired row is never claimable.
- `reaperSweep(now = new Date(), claimedTimeoutMs = NODEMON_CLAIMED_TIMEOUT_MS||300000)`: independent stale-claim rescue. Releases `claimed` rows whose `claimed_at < now - timeout` back to `approved` (clears `claimedAt`) + audit. The window is the D-14 config placeholder.
- All predicates are parameter-bound (Drizzle `eq`/`gt`/`lt`/`inArray` + a real `Date` cutoff) — never string-concatenated. `import "server-only"` with lazy `dbNodemon`/schema imports.

**Task 2 — `src/lib/queue/stub-executor.ts`** (`feat e72df12`, RED `test de3f9b1`)
- `runStubExecutor(outcome: "succeeded" | "failed")`: calls `claimNext()`; if a row is claimed, runs two guarded transactional flips — `claimed→executing` then `executing→outcome` — each with an audit row, plus one `command_executions` row (`outcome`, `detail`, `executedAt`). Returns `{ id }` or `null`.
- D-13 enforced: TEST-ONLY. No UI mount, no operator "simulate" control. The plan's grep gate (`grep -rl "stub-executor" src/app src/components`) returns nothing.

## Verification

- `npx vitest run src/lib/queue/claim.test.ts` → 7 passed (overlapping-tick no-double-apply, claim+audit, no-approved→null, TTL expire + not-claimable, TTL selective, reaper release, reaper leaves-fresh).
- `npx vitest run src/lib/queue/stub-executor.test.ts` → 3 passed (succeeded chain approved→claimed→executing→succeeded + execution row; failed path; null when no approved row).
- `npx vitest run src/lib/queue` → **48 passed (6 files)**.
- Full repo: **620 passed | 20 skipped** (pre-existing skips); `tsc --noEmit` clean; eslint clean on all new files.
- Grep gates: `grep -c 'for("update"' src/lib/queue/claim.ts` = 2 (≥1); D-13 no-UI-import gate PASS.

## Threat Mitigations Confirmed

| Threat | Mitigation proven |
|--------|-------------------|
| T-06-13 double-apply via overlapping ticks | `Promise.all([claimNext(), claimNext()])` on one approved row → exactly one `{id}`, one `null`, one `claimed` row. |
| T-06-14 replay after expiry | past-`expires_at` row → `expired` via `expireSweep`; `claimNext` returns `null` for it. |
| T-06-15 orphaned claim from dead executor | stale `claimed` row past timeout → released to `approved` by `reaperSweep`. |
| T-06-16 throwaway simulate UI | stub executor is TEST-ONLY; grep gate proves no `src/app`/`src/components` import. |
| T-06-SC npm installs | zero installs this phase. |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Shared-DB integration-test race serialized via advisory lock** (`test 53d1e89`)
- **Found during:** Task 2 verification — `npx vitest run src/lib/queue` (the plan's full-dir verification command) failed 3 tests even though each integration file passed standalone.
- **Issue:** Vitest runs test files in parallel forks. `claimNext()` is GLOBAL by design (it claims the oldest `approved` row across ALL `node_pubkeys` — production semantics). When `claim.test.ts` and `stub-executor.test.ts` raced the same local `nodemon` DB, one suite's `claimNext` grabbed the other suite's seeded `approved` row, so `expect(result).toEqual({ id })` compared two different ids.
- **Fix:** Added `test/db-suite-lock.ts` — `acquireSuiteLock()` holds a Postgres `pg_advisory_lock` on a reserved postgres.js connection (`dbNodemon.$client.reserve()`) for the suite's lifetime; both files acquire it in `beforeAll` and release in `afterAll`, so the two integration suites run one-at-a-time. This keeps `claimNext` GLOBAL/production-correct (NOT weakened to a per-pubkey filter) while making the shared-DB suites deterministic. Test-only; production code never locks.
- **Files modified:** `test/db-suite-lock.ts` (new), `src/lib/queue/claim.test.ts`, `src/lib/queue/stub-executor.test.ts`.
- **Commit:** `53d1e89`.

### Environment notes (not deviations)

- These are the first DB-backed tests in the suite; each integration file loads the git-ignored `.env.local` via `dotenv` at the top BEFORE the lazy `dbNodemon` import resolves (the client calls `requireEnv("NODEMON_QUEUE_URL")` at module load).
- Worktree setup: copied the git-ignored `.env.local` and symlinked `node_modules` from the shared checkout into the worktree so vitest could resolve deps and reach the live DB. Both are git-ignored — not committed.

## Known Stubs

None. `stub-executor.ts` is a deliberate, plan-mandated TEST-ONLY driver (D-13), not an unfinished stub — it has full behavior and a passing test suite. It is intentionally not wired to any UI.

## Self-Check: PASSED

- Files exist: `src/lib/queue/claim.ts`, `src/lib/queue/claim.test.ts`, `src/lib/queue/stub-executor.ts`, `src/lib/queue/stub-executor.test.ts`, `test/db-suite-lock.ts` — all FOUND.
- Commits exist: `386bf80`, `2661b5a`, `de3f9b1`, `e72df12`, `53d1e89` — all FOUND in `git log`.
