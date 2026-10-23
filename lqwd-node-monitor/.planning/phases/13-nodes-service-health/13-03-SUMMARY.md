---
phase: 13-nodes-service-health
plan: 03
subsystem: queue-write-path
tags: [queue, transitions, server-actions, tdd, security]
requires:
  - "13-01 (withdrawn enum value live on the nodemon command_state type)"
  - "src/lib/queue/transitions.ts approve()/reject() guarded-flip shape"
  - "src/app/actions/queue.ts enqueueCommand/approveCommand + error-copy helpers"
provides:
  - "withdraw(id) guarded approved→withdrawn transition (D-01/D-02)"
  - "enqueueAndApprove server action (D-11, audit-preserving one-click)"
  - "withdrawCommand server action (D-01 operator undo)"
affects:
  - "Plan 06 UI (ApprovePanel-style withdraw leaf + enqueueAndApprove one-click gesture)"
tech-stack:
  added: []
  patterns:
    - "guarded UPDATE ... WHERE state=<expected> RETURNING id → 0 rows throws (claim-race safety)"
    - "server-signs / client params-only write boundary (strict zod schemas, no HMAC field)"
    - "lazy server-only import of enqueue/transitions inside each action"
    - "DB-free unit test mocking the tx layer + spying drizzle eq to prove the predicate"
key-files:
  created:
    - "src/lib/queue/withdraw.test.ts"
    - "src/app/actions/queue.enqueueAndApprove.test.ts"
  modified:
    - "src/lib/queue/transitions.ts"
    - "src/app/actions/queue.ts"
decisions:
  - "withdraw() gets its OWN 'already claimed' error (not the shared LOST_RACE_ERROR) per interfaces caveat; queue.ts maps its 'ALREADY CLAIMED' marker to a new CLAIMED_RACE_COPY"
  - "withdraw.test.ts written DB-free (mock tx layer, spy drizzle eq) rather than live-DB — deterministic, no nodemon_rw grant dependency"
metrics:
  duration: "~15m"
  tasks: 2
  files: 4
  completed: 2026-07-08
---

# Phase 13 Plan 03: New Write-Path Logic (withdraw + enqueueAndApprove) Summary

Added the two genuinely-new write-path surfaces of the phase — the guarded `withdraw()`
transition and the `enqueueAndApprove` + `withdrawCommand` server actions — TDD-locked,
server-side, params-only, bounds-gated, and audit-preserving.

## What Was Built

**Task 1 — `withdraw()` guarded transition** (`src/lib/queue/transitions.ts`)
- `export async function withdraw(id: string): Promise<void>` following the exact `approve()`
  transaction shape but departing from the literal `"approved"` — it does NOT reuse the module
  `FROM_STATE = "pending_approval"`.
- Defense-in-depth `canTransition("approved", "withdrawn")` check before any DB work.
- Guarded `UPDATE commands SET state='withdrawn' WHERE id=? AND state='approved' RETURNING id`
  inside one `dbNodemon.transaction`. The `WHERE state='approved'` predicate IS the claim-race
  safety (D-02): if the node already claimed the row, 0 rows match and it throws a
  withdraw-specific already-claimed error (`WITHDRAW_CLAIMED_ERROR`, containing the marker
  `ALREADY CLAIMED`).
- On success, inserts `command_audit { fromState:'approved', toState:'withdrawn', actor:'operator' }`.

**Task 2 — `enqueueAndApprove` + `withdrawCommand` actions** (`src/app/actions/queue.ts`)
- `enqueueAndApprove({ pubkey, params, staleAck })`: strict zod schema (no HMAC/signature field
  accepted), re-validates params with the authoritative `updateFeeBoundsSchema` bounds gate BEFORE
  any signing, then calls `enqueue()` ONCE (signs server-side → `pending_approval`) followed by
  `approve(id, staleAck)` (→ `approved`). The full audit trail `∅ → pending_approval → approved`
  is preserved — explicitly NOT auto-approve-on-enqueue and NOT an insert-at-approved bypass.
  `staleAck` flows through into the `approve()` audit row. Returns `EnqueueResult` with the new id.
- `withdrawCommand({ id })`: strict `{ id: uuid }` schema, calls the guarded `withdraw(id)`, maps a
  thrown already-claimed lost-race to `transitionErrorCopy` (new `CLAIMED_RACE_COPY`).
- Added the `CLAIMED_RACE_MARKER` / `CLAIMED_RACE_COPY` pair and extended `transitionErrorCopy`.

## Tests

- `src/lib/queue/withdraw.test.ts` (NEW, 5 tests, DB-free): flip to `withdrawn`, predicate departs
  from `approved` (drizzle `eq` spied — proves it never compares `pending_approval`), audit row
  contents, 0-row → already-claimed throw, defense-in-depth guard trips before DB work.
- `src/app/actions/queue.enqueueAndApprove.test.ts` (NEW, 10 tests): sign-once + approve ordering,
  `∅→pending→approved` call-order, staleAck flow, out-of-bounds rejected before signing, invalid
  pubkey rejected, strict schema rejects a smuggled `signatureHex`, approve lost-race mapping;
  withdrawCommand success, already-claimed mapping, non-uuid rejection.

TDD gates satisfied per task: `test(...)` RED commit precedes the `feat(...)` GREEN commit for both.

## Verification

- `npx vitest run src/lib/queue/withdraw` → 5 passed.
- `npx vitest run src/app/actions/queue.enqueueAndApprove` → 10 passed.
- `npx tsc --noEmit` → clean.
- Source assertions: `withdraw()` uses `eq(commands.state, "approved")` and references
  `FROM_STATE` 0 times; action schemas contain no signature/HMAC field (matches are comments /
  error-copy only).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test `beforeEach` overrode call-order recording**
- **Found during:** Task 2 GREEN run
- **Issue:** `beforeEach` reset the mocks with `mockResolvedValue(...)`, which REPLACED the vi.fn
  implementations that push to `callOrder`, so the audit-trail ordering assertion saw `[]`.
- **Fix:** Removed the `mockResolvedValue` overrides; keep only `mockClear()` (history reset) so the
  base recording implementations survive. `mockRejectedValueOnce` still overrides a single call.
- **Files modified:** src/app/actions/queue.enqueueAndApprove.test.ts
- **Commit:** 023fbd2

### Decision: withdraw error copy
The PATTERNS snippet reused `LOST_RACE_ERROR` verbatim, but the plan's `<interfaces>` explicitly
states "withdraw needs its own 'already claimed' copy" and the action text says "throw a
withdraw-specific 'too late, already claimed' error". Followed the plan: added a distinct
`WITHDRAW_CLAIMED_ERROR` and a matching `CLAIMED_RACE_COPY` mapped by the `ALREADY CLAIMED` marker,
so `withdrawCommand`'s UI copy is the D-01 clean-race line, not the "no longer pending" line.

## Live-DB Test Note (infra, not a code defect)

The pre-existing live-nodemon integration suites (`enqueue.test.ts`, `approve.test.ts`,
`claim.test.ts`, `stub-executor.test.ts`) fail in this worktree with
`Missing required env: NODEMON_QUEUE_URL` — the git-ignored `.env.local` is not present in the
worktree, so no DB connection can be established. This is an environment gap, NOT a code defect and
NOT introduced by this plan. Per the objective note, the `withdraw()` live-DB transition (against the
now-live `withdrawn` enum) was therefore verified via the DB-free unit test rather than a live suite;
no DB grants were altered.

## Threat Model Coverage

- T-13-03-01 (client forges HMAC): both action input schemas are `.strict()` with only
  `{pubkey, params, staleAck}` / `{id}` — a smuggled `signatureHex` is rejected (tested). enqueue()
  signs once server-side.
- T-13-03-02 (out-of-bounds params): `enqueueAndApprove` re-validates via `updateFeeBoundsSchema`
  before signing; out-of-bounds ppm rejected pre-sign (tested).
- T-13-03-03 (double-apply / withdraw racing a claim): `withdraw()` guarded on
  `WHERE state='approved'`; 0 rows → throws already-claimed (tested).
- T-13-03-04 (approved with no trail): `enqueueAndApprove` preserves `∅→pending→approved` via
  enqueue()+approve() (call-order tested), never an insert-at-approved bypass.
- T-13-03-SC (npm installs): zero new packages.

## Known Stubs

None.

## Self-Check: PASSED
- src/lib/queue/transitions.ts — FOUND
- src/app/actions/queue.ts — FOUND
- src/lib/queue/withdraw.test.ts — FOUND
- src/app/actions/queue.enqueueAndApprove.test.ts — FOUND
- Commits 28fbf57, 3399604, 4b9e34b, 023fbd2 — FOUND
