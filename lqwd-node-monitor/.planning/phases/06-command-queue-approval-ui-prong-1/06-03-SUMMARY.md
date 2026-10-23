---
phase: 06-command-queue-approval-ui-prong-1
plan: 03
subsystem: command-queue
tags: [queue, enqueue, transitions, hmac, audit, server-only, drizzle, tdd]
requires:
  - "src/lib/queue/canonical.ts (canonicalize, buildSignedPayload) — 06-02"
  - "src/lib/queue/sign.ts (signPayload) — 06-02"
  - "src/lib/queue/bounds.ts (UpdateFeeParams) — 06-02"
  - "src/lib/queue/state.ts (canTransition) — 06-02"
  - "src/lib/db/schema/nodemon.ts (commands, commandAudit, commandState) — 06-01"
  - "src/lib/db/nodemon.ts (dbNodemon RW client) — Phase 1"
provides:
  - "enqueue(pubkey, params): server-only transactional enqueue (sign-once + INSERT commands + INSERT audit)"
  - "approve(id, staleAck) / reject(id, reason?): server-only guarded state flips + audit insert"
  - "src/lib/queue/test-helpers.ts: live-nodemon fixture (env load, per-file pubkey, scoped cleanup, seed)"
affects:
  - "06-04 (server actions) lazy-imports enqueue + transitions"
  - "06-05 (UI leaves) calls the enqueue/approve/reject actions"
tech-stack:
  added: []
  patterns:
    - "server-only + lazy dbNodemon import inside functions (narrate.ts/latest.ts precedent)"
    - "transactional flip: UPDATE … WHERE id=? AND state=<expected> .returning() + audit insert in one txn"
    - "live-DB test isolation via per-file pubkey namespace (no global TRUNCATE)"
key-files:
  created:
    - src/lib/queue/enqueue.ts
    - src/lib/queue/transitions.ts
    - src/lib/queue/test-helpers.ts
    - src/lib/queue/enqueue.test.ts
    - src/lib/queue/approve.test.ts
  modified: []
decisions:
  - "expires_at stored as Date (timestamptz); its .toISOString() feeds the signed payload so Phase 7 hashes identical bytes"
  - "lost-race guard error copy frozen as 'THIS COMMAND IS NO LONGER PENDING APPROVAL' (UI-SPEC)"
  - "live-DB tests use a per-file random pubkey + scoped DELETE cleanup so files stay parallel-safe against the single shared nodemon DB"
metrics:
  duration: ~30 min
  completed: 2026-06-15
  tasks: 2
  files: 5
---

# Phase 6 Plan 03: Queue Write Services (enqueue + transitions) Summary

Server-only transactional `enqueue` (sign-once at enqueue, then INSERT command + initial audit row atomically) and `approve`/`reject` transitions (guarded `WHERE state='pending_approval'` flip + audit insert in one transaction), proven against the live local `nodemon` DB with a parallel-safe integration fixture.

## What was built

- **`src/lib/queue/enqueue.ts`** — `enqueue(pubkey, params)`. Generates `command_id = randomUUID()` and `expires_at = now() + NODEMON_TTL_HOURS*3600000` (default 24, D-11) BEFORE signing (Pitfall 2). Builds `canonicalize(params)` → `buildSignedPayload(...)` → `signPayload(...)` hex, then in ONE `dbNodemon.transaction` INSERTs the `commands` row (`state='pending_approval'`, `canonicalPayload` stored VERBATIM per CLAUDE.md §4, `signatureHex`) and the initial `commandAudit` row (`fromState=null`, `toState='pending_approval'`, `actor='operator'`). `import "server-only"`, lazy DB import inside the function.
- **`src/lib/queue/transitions.ts`** — `approve(id, staleAck)` and `reject(id, reason?)`. Each validates the legal edge via `canTransition` (defense in depth), then in one transaction runs `UPDATE commands SET state=<to> WHERE id=? AND state='pending_approval'` `.returning()`; zero rows updated → throws `THIS COMMAND IS NO LONGER PENDING APPROVAL` (lost-race guard, T-06-08). approve records `staleAcknowledged` (D-10); reject records the optional free-text `reason` (D-07, data only — never an HTML sink). `import "server-only"`, lazy DB import.
- **`src/lib/queue/test-helpers.ts`** — live-nodemon fixture: loads git-ignored `.env.local` via dotenv (vitest has no Next runtime / dotenv auto-load), mints a per-file 66-hex test pubkey, installs/clears the per-node HMAC test secret, scoped-DELETE cleanup by pubkey, `seedCommand(pubkey, state)`, and `closeQueueDb()` to end the pool cleanly.
- **`enqueue.test.ts` (4 tests)** — pending_approval row count, verbatim `canonical_payload` reconstruction, 64-hex signature, audit `from_state` NULL, `expires_at` fixed pre-sign.
- **`approve.test.ts` (7 tests)** — approve flip + audit (`stale_acknowledged` false/true), double-approve and non-existent id throw the guard, reject flip + reason capture (and null when omitted), double-reject throws.

## Verification

- `npx vitest run src/lib/queue/enqueue.test.ts` → 4 passed.
- `npx vitest run src/lib/queue/approve.test.ts` → 7 passed.
- `npx vitest run src/lib/queue` → 49 passed (Wave 1 pure suite + the two new live-DB suites), stable green across 3 consecutive runs.
- `npm test` (full project) → 621 passed, 20 skipped, 0 failed.
- eslint clean on all 5 new files.
- Grep guards: both `enqueue.ts` and `transitions.ts` start with `import "server-only"`, have NO top-level `dbNodemon` import (lazy `await import` inside functions), `randomUUID` present in enqueue, `gen_random_uuid` appears only in a comment (not the signed-id path), `.returning()` guard present in both transitions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cross-file live-DB test interference (parallel TRUNCATE race)**
- **Found during:** Task 2 verification (full `src/lib/queue` suite run after both files existed).
- **Issue:** The plan's fixture specified a global `TRUNCATE commands, command_executions, command_audit` between tests. Vitest runs test FILES in parallel by default, and `enqueue.test.ts` + `approve.test.ts` share ONE physical nodemon DB — so one file's `TRUNCATE` wiped rows the other had just inserted, producing 2 intermittent audit-count failures (each file passed in isolation, failed together).
- **Fix:** Replaced the global TRUNCATE with a per-file random pubkey namespace (`mkTestPubkey()`) plus pubkey-scoped `DELETE` cleanup (`cleanPubkeyRows(pubkey)`). Each suite now operates only on its own rows, making the two live-DB files fully parallel-safe. Also threaded the pubkey through `setTestSecret`/`clearTestSecret`/`seedCommand`.
- **Files modified:** src/lib/queue/test-helpers.ts, src/lib/queue/enqueue.test.ts, src/lib/queue/approve.test.ts
- **Commit:** 4534e43

**2. [Rule 3 - Blocking] Worktree lacked the git-ignored `.env.local`**
- **Found during:** Task 1 setup (live-DB tests need `NODEMON_QUEUE_URL`).
- **Issue:** `.env.local` is git-ignored and exists only in the main repo, not the parallel worktree; vitest does not auto-load it.
- **Fix:** Copied `.env.local` into the worktree (still git-ignored, never committed) and had `test-helpers.ts` load it via `dotenv` (`override:false`). This is the documented Phase 6 requirement (.env.example: a test secret in `.env.local` so Wave 2 integration tests run).
- **Files modified:** none committed (env file is git-ignored).

## Threat surface

No new security surface beyond the plan's threat register. The implementation mitigates the assigned dispositions: T-06-08 (lost-update race) via the `WHERE state='pending_approval'` returning-guard + zero-row throw; T-06-09 (untracked state change) via the same-transaction audit insert on every flip; T-06-11 (client-supplied signed payload) via server-side recompute of id/expires_at/canonical/signature; T-06-12 (reject reason as HTML sink) by storing the reason as text data only.

## TDD Gate Compliance

Both features satisfy the RED→GREEN gate sequence: a `test(...)` RED commit precedes the corresponding `feat(...)` GREEN commit for each.

- Enqueue: RED `c3cffb5` → GREEN `4237c1e` (immediate).
- Transitions: RED `d935694` → GREEN `4daf120`. NOTE: `transitions.ts` was inadvertently left uncommitted after its GREEN test run; it was committed at `4daf120` after the parallel-safe-test fix (`4534e43`). The RED-before-GREEN ordering for the feature still holds; only the GREEN commit landed slightly later in the log than its RED.

## Self-Check: PASSED

- FOUND: src/lib/queue/enqueue.ts
- FOUND: src/lib/queue/transitions.ts
- FOUND: src/lib/queue/test-helpers.ts
- FOUND: src/lib/queue/enqueue.test.ts
- FOUND: src/lib/queue/approve.test.ts
- FOUND commit c3cffb5 (test RED — enqueue)
- FOUND commit 4237c1e (feat GREEN — enqueue)
- FOUND commit d935694 (test RED — transitions)
- FOUND commit 4daf120 (feat GREEN — transitions)
- FOUND commit 4534e43 (fix — parallel-safe tests)
