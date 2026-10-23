# Phase 01 — Deferred Items

Out-of-scope discoveries logged during execution. NOT fixed here.

## From Plan 01-03 (2026-06-09) — ✅ RESOLVED 2026-06-09

- **`src/lib/db/health.test.ts` live integration test failed under loaded env** (Plan 02 file).
  - Symptom: `runStartupHealthCheck` live test rejected with `25006` on `CREATE TEMP TABLE _ro_probe` — the test expected the overall promise to RESOLVE, but it rejected.
  - **Root cause (real bug, not test-only):** `health.ts` `pgCode()` read only the top-level `error.code`. Drizzle's `db.transaction()` wraps the driver error in a `DrizzleQueryError` and puts the real `PostgresError` (with SQLSTATE 25006) on `.cause`. So `pgCode()` returned `undefined`, `assertReadOnly` re-threw the legitimate read-only rejection, and `runStartupHealthCheck` rejected — meaning **the actual boot check would have false-failed under the read-only session** (it only appeared to pass when probed with raw postgres.js, not through Drizzle).
  - **Fix:** `pgCode()` now walks the `.cause` chain (bounded) to find the SQLSTATE.
  - **Verified:** `health.test.ts` passes 3/3 under loaded env; `next dev` boots `✓ Ready` with instrumentation's health check passing through Drizzle against both warehouses + local nodemon.
