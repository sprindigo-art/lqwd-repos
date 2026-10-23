# Deferred Items — Phase 11

Out-of-scope discoveries logged during execution (not fixed; see SCOPE BOUNDARY).

## 11-03 (Plan 03 — read-side substrate)

- **Queue tests fail without `NODEMON_QUEUE_URL`** (pre-existing, unrelated to Plan 03).
  - Files: `src/lib/queue/enqueue.test.ts`, `approve.test.ts`, `claim.test.ts`,
    `stub-executor.test.ts`.
  - Cause: these Phase-6 queue tests reach `requireEnv("NODEMON_QUEUE_URL")` via
    `src/lib/queue/test-helpers.ts` → `src/lib/db/nodemon.ts` at test time, and are
    NOT gated behind `describe.skipIf(!process.env.NODEMON_QUEUE_URL)` the way
    `src/lib/db/health.test.ts` is. In a worktree with no nodemon DB env they throw
    instead of skipping.
  - Why deferred: not caused by Plan 03 (units/bands/fixture). The telemetry fixture
    helper itself follows the lazy-import + skipIf-gate pattern correctly.
  - Suggested fix (future): wrap the queue test suites in the same
    `describe.skipIf(!process.env.NODEMON_QUEUE_URL)` gate so they skip cleanly off-DB.
  - **11-04 re-confirmed:** still the only failures in `npx vitest run` (4 failed in
    `src/lib/queue/{enqueue,approve,claim,stub-executor}.test.ts`). Plan 04 touched zero
    queue files; the new read helpers + tests follow the lazy-import + skipIf gate
    correctly (host-metrics / chain-telemetry seeded suites skip cleanly off-DB).

## 11-05 (Plan 05 — two-axis service-health read)

- **Same queue-test failures still present** (4 files: `enqueue`, `approve`, `claim`,
  `stub-executor`). Re-confirmed during 11-05: `npx vitest run` reports `4 failed |
  831 passed | 38 skipped`. Identical root cause as the 11-03 entry above
  (`requireEnv("NODEMON_QUEUE_URL")` at module load, no skipIf gate). Out of scope
  for 11-05 — `src/lib/read/service-health.ts` is not imported by any queue test, and
  the new service-health suite lazy-imports `dbNodemon` + gates its seeded block with
  `describe.skipIf(!process.env.NODEMON_QUEUE_URL)`, so it skips cleanly off-DB.
