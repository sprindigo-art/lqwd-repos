---
phase: 06-command-queue-approval-ui-prong-1
plan: 07
subsystem: command-queue-approval-ui
tags: [phase-gate, queue-04, stub-executor, no-double-apply, security-greps, operator-signoff]
requires:
  - Full queue state machine (06-01..06-06) merged to main
  - claimNext / expireSweep / reaperSweep / stub-executor (06-04)
  - enqueue / approve / reject services (06-03) + server actions (06-05)
  - /queue approval surface (06-06)
provides:
  - Green phase gate (full suite + QUEUE-04 concurrency proof + security greps + build)
  - Operator visual sign-off on the enqueue/approval write UI
status: complete
operator_verdict: approved
---

# 06-07 — Phase Gate: prove the queue end-to-end + operator sign-off

## Result

**Gate GREEN. Operator approved.**

## Task 1 — automated proof (PASS)

- **Full Vitest suite:** 631 passed / 20 skipped — deterministic across 3 consecutive runs.
- **QUEUE-04 proofs (explicit):** 17/17 — the overlapping-tick no-double-apply test (Success
  Criterion 4: two concurrent `claimNext()` on one approved row → exactly one claim), fail-closed
  TTL `expireSweep`, stale-claim `reaperSweep`, the stub-executor drive, and the guarded approve flip.
- **Security grep battery (clean):**
  - no inline unit conversions (`/1e8`, `*1000`) in `src/components/queue` or the `/queue` page;
  - no `MAX(timestamp)` in the queue page (AFM-001 discipline);
  - `NODEMON_HMAC_SECRET` appears only in the `"use server"` action `src/app/actions/queue.ts`
    — absent from every client component (secret never reaches a client bundle, V7);
  - `stub-executor` has 0 imports from `src/app` / `src/components` (D-13);
  - `server-only` present on sign / enqueue / transitions / claim / stub-executor.
- **Build:** `npm run build` succeeds; `/queue` registered as a dynamic route.
- **Zero dependency installs** this phase (T-06-SC): the checkbox primitive was vendored from the
  already-present `radix-ui` package.

## Task 2 — operator visual checkpoint (APPROVED)

Operator verdict, verbatim:

> "looks good ... so queue is approved and actions are work"

The operator initially hit a **"NO SIGNING SECRET FOR THIS NODE"** error on enqueue. Root-caused
(systematic debugging) as the queue **failing loud by design** (D-12): `.env.local` carried no
`NODEMON_HMAC_SECRET_<pubkey>` for any node — Phase 6 ships no real secrets (they arrive via the
Phase 7 downloader). Resolved by setting throwaway per-node TEST secrets in git-ignored `.env.local`
for five LND nodes that carry live `update_fee` recs (Canada / Indonesia / Australia / Japan /
France) and restarting the dev server. **No code defect** — the signing path and all 631 tests are
correct; this confirmed the fail-loud contract works as specified.

## Deviations / fixes applied during the gate

1. **`fix(06-07)`** — `approve.test.ts` now acquires the shared advisory suite-lock
   (`test/db-suite-lock.ts`). It creates `approved` rows that the GLOBAL `claimNext()` in the sibling
   QUEUE-04 suites would steal under vitest file-parallelism — a real flaky cross-suite race the gate
   exposed (passed earlier runs, failed under load). Production code unchanged; the fix is test-only
   serialization. Suite is now deterministic (3/3 green runs).
2. **`fix(06)`** — widened the `$client.end` cast in `test-helpers.ts` to postgres.js's real
   `end(options?)` signature (a post-merge tsc error vitest's esbuild had masked).

## QUEUE-01..04 coverage

- **QUEUE-01** (enqueue as signed `pending_approval`): enqueue service + server action + EnqueuePreview, proven.
- **QUEUE-02** (HMAC sign/verify, canonical freeze): 38 crypto/contract tests; byte-identical to `openssl`.
- **QUEUE-03** (operator approve/reject, guarded + audited): transitions + ApprovePanel + stale-ack gate.
- **QUEUE-04** (atomic claim, no double apply, TTL, reaper): overlapping-tick proof green.

## Follow-up captured (NOT a Phase 6 gap)

Operator requested a **separate** inbox-page layout overhaul (the `/inbox` recommendation surface
shows ~531 cards in one long scroll). This is new design exploration against the existing inbox from
earlier phases — it does not affect the Phase 6 queue deliverable, which is approved. Routed to a
sketch/exploration track.
