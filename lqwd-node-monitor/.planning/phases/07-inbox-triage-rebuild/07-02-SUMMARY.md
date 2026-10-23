---
phase: 07-inbox-triage-rebuild
plan: 02
subsystem: queue
tags: [server-action, bulk-enqueue, best-effort, hmac, tdd]
requires:
  - "src/lib/queue/enqueue.ts (enqueue — per-row transactional signer)"
  - "src/lib/queue/bounds.ts (updateFeeBoundsSchema — authoritative gate)"
  - "src/app/actions/queue.ts (enqueueInputSchema + enqueueErrorCopy — reused verbatim)"
provides:
  - "enqueueBatch sibling server action (INBOX-04 bulk best-effort tally)"
  - "BatchRowResult / EnqueueBatchResult exported types"
affects:
  - "07-04 bulk-select UI (consumes enqueueBatch via BatchConfirmDialog)"
tech-stack:
  added: []
  patterns:
    - "Loop the existing per-row path; never wrap in an outer transaction (D-07)"
    - "Lazy server-only import of enqueue INSIDE the loop (signer/DB out of pure caller graph)"
    - "Reuse the single-card validator + error copy verbatim (no new bounds/signing code)"
    - "vi.mock the per-row enqueue to unit-test batch orchestration deterministically"
key-files:
  created:
    - "src/app/actions/queue.batch.test.ts"
  modified:
    - "src/app/actions/queue.ts"
decisions:
  - "Unit test (vi.mock enqueue) over live-nodemon round-trip: the transactional write path is already covered by enqueue.test.ts; this plan owns only the loop/tally/skip orchestration, which the mock exercises deterministically without the shared-DB parallel-race surface."
  - "Defensive input.params?.chanId on failure paths (Rule 2): a malformed row that fails safeParse may lack params; the optional chain prevents a thrown TypeError while building the {ok:false} tally entry."
metrics:
  duration: ~12m
  completed: 2026-06-17
requirements: [INBOX-04]
---

# Phase 07 Plan 02: enqueueBatch (bulk best-effort) Summary

`enqueueBatch` sibling server action that powers bulk-enqueue (INBOX-04) by looping the existing per-row `enqueue()` once per intent — each its own transaction, signed once server-side — collecting a best-effort `{ ok | error }` tally with each failure's reason verbatim.

## What Was Built

- **`enqueueBatch(inputs: EnqueueInput[])`** in `src/app/actions/queue.ts`: loops each row through `enqueueInputSchema.safeParse` (authoritative bounds gate) then the lazy-imported `enqueue(pubkey, params)` inside its own `try/catch`. Returns `{ results, queued, skipped }` where `queued` counts only `ok` rows.
- **`BatchRowResult` / `EnqueueBatchResult`** exported types matching the 07-RESEARCH OQ-2 shape (success carries `id`, `pubkey`, `chanId`; failure carries `pubkey`, `chanId`, `error`).
- **`src/app/actions/queue.batch.test.ts`** (TDD RED→GREEN): 6 unit tests mocking `@/lib/queue/enqueue` — verbatim missing-secret skip alongside good queued rows, queued/skipped correctness, per-row bounds rejection without aborting, invalid-pubkey rejection, no-outer-rollback (bad row first still commits the good row after), and the empty-batch tally.

## Safety guarantees inherited (every decision mapped)

- **D-07 best-effort, no rollback** — NO outer `dbNodemon.transaction` wraps the loop (each `enqueue()` is already per-row transactional). Verified: `grep "dbNodemon.transaction" src/app/actions/queue.ts` returns nothing. One bad row leaves all good writes durable.
- **CLAUDE.md §5 sign-once server-side** — the action accepts `{pubkey, params}[]` ONLY; no `signature`/`canonicalPayload` field on `EnqueueInput`/`BatchRowResult`; `enqueue()` recomputes command_id/expires_at/canonical/signature per row.
- **Bounds (T-07-04)** — every row re-validated with the same `updateFeeBoundsSchema` before signing; an over-bounds `suggestedPpm` is rejected pre-sign (test asserts `enqueue` never called for that row).
- **V7 no-secret-in-logs** — thrown rows log `console.error("enqueueBatch row failed")` with no message bytes; `enqueueErrorCopy` carries no secret bytes.

## Verification

- `npx vitest run src/app/actions/queue.batch.test.ts` → 6/6 passed, file collected (not "0 tests"); glob `src/**/*.test.ts` covers `src/app/actions/` (confirmed — first `*.test.ts` under that dir, picked up cleanly).
- `grep "dbNodemon.transaction" src/app/actions/queue.ts` → empty (no outer batch tx).
- No `signature`/`canonicalPayload` field on the input/result types (only doc-comment mentions).
- `npm test` full suite → **668 passed | 20 skipped**, 0 failed. The Phase-6 flaky `stub-executor.test.ts:115` did not fail this run; my scope is green regardless.
- `npx tsc --noEmit` → clean for both queue files.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Defensive `input.params?.chanId` on failure paths**
- **Found during:** Task 1
- **Issue:** The draft pushes `chanId: input.params.chanId` on the `{ok:false}` failure path. If a malformed row that fails `safeParse` lacks a `params` object, `input.params.chanId` throws a TypeError mid-loop, aborting the whole batch — the exact no-rollback guarantee D-07 forbids.
- **Fix:** Use optional chaining `input.params?.chanId` on both failure branches so a structurally-broken row produces a clean `{ok:false}` tally entry instead of crashing the loop.
- **Files modified:** src/app/actions/queue.ts
- **Commit:** 7cf4e2a

**2. [Rule 1 - Bug] Mock arity mismatch (test-only)**
- **Found during:** Task 2 (tsc strict check)
- **Issue:** `vi.fn(async (pubkey: string) => ...)` was called with two args (`pubkey, params`), failing `tsc --noEmit` with TS2554.
- **Fix:** Mock signature accepts both args `(pubkey, _params)`.
- **Files modified:** src/app/actions/queue.batch.test.ts
- **Commit:** c93e226

## Test location decision

The plan's Task 2 instructed to confirm glob coverage before placing the test. The vitest `test.include` is `src/**/*.test.ts`, which DOES cover `src/app/actions/queue.batch.test.ts`. Confirmed by running vitest against that exact path and seeing 6 tests collected (not "0 tests"). No co-location to `src/lib/queue/` was needed; `<files>` stays as planned.

## Known Stubs

None. `enqueueBatch` is fully wired to the real `enqueue()` path; the bulk-select UI that calls it lands in 07-04.

## TDD Gate Compliance

- RED: `test(07-02): add failing enqueueBatch...` (4635e96) — 6 tests failing on `enqueueBatch is not a function`.
- GREEN: `feat(07-02): add enqueueBatch sibling action...` (7cf4e2a) — 6/6 passing.
- (no REFACTOR commit; implementation matched the research draft as-is.)

## Self-Check: PASSED

All created/modified files present on disk; all 3 task commits (4635e96, 7cf4e2a, c93e226) present in git log.
