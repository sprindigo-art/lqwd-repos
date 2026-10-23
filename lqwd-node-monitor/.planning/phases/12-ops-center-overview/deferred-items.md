# Phase 12 — Deferred Items

Out-of-scope discoveries logged during execution (do NOT fix inline).

## 12-06 — DB-dependent test suites fail on sandbox grants (pre-existing, out of scope)

`npx vitest run` (full suite) reports 5 failed files / 932 passed / 47 skipped. The 5
failures are all live-Postgres integration/golden suites failing on
`PostgresError: permission denied for table command_audit` (SQLSTATE 42501) — a sandbox
DB-grant/env condition, not a code regression:

- `src/lib/queue/approve.test.ts`
- `src/lib/read/golden.test.ts`
- `src/lib/read/golden-pending.test.ts`
- `src/lib/scorecard/golden-scorecard.test.ts`
- (+1 additional DB-backed suite truncated in the captured tail)

These are unrelated to 12-06's pure-module + SSR view-layer changes (no DB access in
`filter.ts` / `QueueFilters.tsx` / `AiBandClient.tsx`). The 12-06 suites pass in isolation:
`filter` 11/11, `QueueFilters` 9/9. Resolution requires the `command_audit`/warehouse
SELECT/DELETE grants for the test role in this environment — operator/infra concern.

