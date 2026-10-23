---
phase: 11-full-stack-telemetry-ingestion
plan: 05
subsystem: api
tags: [drizzle, postgres, telemetry, service-health, afm-001, distinct-on, read-model]

# Dependency graph
requires:
  - phase: 11-01
    provides: service_inventory + service_health schema (two-axis columns, expected_interval_seconds, last_artifact_mtime)
  - phase: 11-03
    provides: telemetry-fixture.ts (up-but-dead, never-reported, batch-within-interval seed rows) + parseDbTimestampUtc coercion
provides:
  - buildServiceHealthSql — AFM-001 DISTINCT ON (host_id, service_name) inventory-driven LEFT JOIN builder
  - getServiceHealthRows — lazy-dbNodemon executor returning typed ServiceHealthRow[]
  - deriveServiceHealth — pure two-axis + per-service-freshness read-time derivation
  - getServiceHealth — executor + derivation; the TEL-02 two-axis service-health read
affects: [telemetry-ui, ops-center, node-detail, service-status-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AFM-001 builder/executor split cloned for the (host_id, service_name) key"
    - "Inventory-driven LEFT JOIN USING (host_id, service_name) so declared-but-silent services read as no-data, not absent (SC#4)"
    - "Two-clock derivation: per-service functioning-freshness (expected_interval_seconds × grace) distinct from ~15-min collector-freshness"

key-files:
  created:
    - src/lib/read/service-health.ts
    - src/lib/read/service-health.test.ts
  modified:
    - .planning/phases/11-full-stack-telemetry-ingestion/deferred-items.md

key-decisions:
  - "LEFT JOIN USING (host_id, service_name) keeps the join keys unqualified so DISTINCT ON references the merged (left/inventory) key — never a NULL right-side key (avoids the AFM-001 NULL-key collapse for never-reported services)"
  - "Single `stale` field = per-service functioning-freshness; collector-freshness surfaced separately as `collectorStale` so it never downs a batch service (RESEARCH Pitfall 1)"
  - "FUNCTIONING_GRACE = 2 (within RESEARCH's 2–3× band); functioning-staleness only computed when both expected_interval_seconds and last_artifact_mtime are present — otherwise the probe alone drives the axis (persistent procs)"
  - "deriveServiceHealth is pure (row, now) so both halves of the per-service-clock invariant (within-interval → functioning, past-interval → stale) are asserted deterministically with no live DB"

patterns-established:
  - "Pure read-time derivation: raw booleans + timestamps in, two-axis state out; nothing about staleness stored (D-13/D-14)"
  - "green = running AND functioning expressed in the derivation as the unmistakable up-but-dead guard"

requirements-completed: [TEL-02]

# Metrics
duration: 14min
completed: 2026-06-29
---

# Phase 11 Plan 05: Two-Axis Service-Health Read Summary

**getServiceHealth — AFM-001 DISTINCT-ON service-health read that returns per-service RUNNING + FUNCTIONING state, surfacing up-but-dead as not-functioning and declared-but-silent services as no-data, with functioning-freshness judged against each service's own expected_interval_seconds rather than the 15-min collector clock.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-29T11:53:00Z
- **Completed:** 2026-06-29T11:58:00Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 3 (2 created, 1 doc)

## Accomplishments
- `buildServiceHealthSql(hostId)` emits the AFM-001 `DISTINCT ON (host_id, service_name)` shape over an inventory-driven `service_inventory LEFT JOIN service_health USING (host_id, service_name)` — never `MAX(`, `service_name IS NOT NULL` NULL-key guard, host key `$1`-bound.
- `getServiceHealth` derives the two-axis state: green only when both `running` and `functioning` are true; up-but-dead (running=true, functioning=false) reads not-functioning; never-reported reads no-data (SC#4).
- Per-service functioning-freshness uses `expected_interval_seconds × grace` on `last_artifact_mtime` (D-17) — a 60-min batch 20 min old is NOT stale; the same service past its interval IS. Collector-freshness (~15 min on `collected_at`) is tracked separately and never downs a batch service.
- 13 tests pass (6 SQL-shape + 7 pure-derivation); 1 seeded integration suite skips cleanly without `NODEMON_QUEUE_URL`.

## Task Commits

1. **Task 1 (RED): buildServiceHealthSql shape tests** - `726c3e0` (test)
2. **Task 1 (GREEN): DISTINCT-ON LEFT-JOIN builder + executor** - `17056be` (feat)
3. **Task 2 (RED): two-axis derivation + seeded tests** - `9d48cce` (test)
4. **Task 2 (GREEN): two-axis + per-service-freshness derivation** - `ff6308b` (feat)

**Deferred-items doc:** `0eb5941` (docs)

## Files Created/Modified
- `src/lib/read/service-health.ts` - `buildServiceHealthSql` + `getServiceHealthRows` (AFM-001 read) and `deriveServiceHealth` + `getServiceHealth` (two-axis/per-service-freshness derivation); typed `ServiceHealthRow` / `ServiceHealthState`; `COLLECTOR_WINDOW_MS` + `FUNCTIONING_GRACE`.
- `src/lib/read/service-health.test.ts` - 6 no-DB SQL-shape tests, 7 pure-derivation tests, 1 `skipIf(!NODEMON_QUEUE_URL)` seeded integration test against the Plan-03 fixture.
- `.planning/.../deferred-items.md` - logged the re-confirmed out-of-scope queue-test failures.

## Decisions Made
- **`USING (host_id, service_name)` join:** chosen over qualified `ON sh.host_id = si.host_id ...` so the DISTINCT ON / ORDER BY reference the unqualified merged keys (left-table values for a LEFT JOIN). This both satisfies the literal `distinct on (host_id, service_name)` contract and structurally prevents the AFM-001 NULL-key collapse that a `DISTINCT ON (sh.host_id, sh.service_name)` would reintroduce for never-reported services.
- **Two separate staleness fields:** `stale` (per-service functioning clock) drives the functioning axis; `collectorStale` (collector clock) is reported but isolated — directly encoding RESEARCH Pitfall 1 ("all cron-batch services show red on a healthy host").
- **Grace = 2** (documented, within the 2–3× RESEARCH range); functioning-staleness skipped when interval or artifact mtime is absent so persistent procs aren't falsely staled.

## Deviations from Plan

None - plan executed exactly as written. (The plan's output shape `{running, functioning, stale, lastSuccessAt, errorCount, noData}` was implemented with two additive clarity fields — `green` and `collectorStale` — to express the "green only when both axes" invariant and keep the two freshness clocks unconflated; both are required by the acceptance criteria, not scope creep.)

## Issues Encountered
- Full-suite run shows 4 pre-existing failing files under `src/lib/queue/` (`enqueue`, `approve`, `claim`, `stub-executor`). Root cause is unrelated to this plan: those Phase-6 tests reach `requireEnv("NODEMON_QUEUE_URL")` at module load without a `skipIf` gate, so they throw off-DB instead of skipping. `service-health.ts` is not imported by any of them; the new service-health suite lazy-imports `dbNodemon` and gates its seeded block, so it skips cleanly. Logged to `deferred-items.md` (out of scope per SCOPE BOUNDARY).

## User Setup Required
None - no external service configuration required. Seeded integration coverage runs automatically once `NODEMON_QUEUE_URL` points at a nodemon DB with the Plan-01 telemetry migration applied (operator-deferred).

## Next Phase Readiness
- `getServiceHealth(hostId)` is ready to back a service-status panel / ops-center surface: returns per-service `{running, functioning, green, stale, collectorStale, noData, lastSuccessAt, lastArtifactMtime, collectedAt, errorCount, expectedIntervalSeconds}`.
- No blockers. Live two-axis verification against real `service_health` data is gated on applying the telemetry migration to the nodemon DB (operator step).

## Self-Check: PASSED

- Files: `service-health.ts`, `service-health.test.ts`, `11-05-SUMMARY.md` all present.
- Commits: `726c3e0`, `17056be`, `9d48cce`, `ff6308b`, `0eb5941` all in history.
- Tests: `npx vitest run src/lib/read/service-health.test.ts` → 13 passed, 1 skipped (seeded, no DB).
- Typecheck: `npx tsc --noEmit` → exit 0.

---
*Phase: 11-full-stack-telemetry-ingestion*
*Completed: 2026-06-29*
