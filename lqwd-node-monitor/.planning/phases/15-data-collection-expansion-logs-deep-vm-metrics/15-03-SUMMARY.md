---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 03
subsystem: read-layer
tags: [col-01, logs, read-time-suppression, config-id-join, tdd, drizzle]
requires:
  - "15-01 (service_log_events + log_patterns_config schema, config_id suppress key)"
  - "15-02 (nothing imported directly; wave-1 sibling)"
provides:
  - "getServiceLogEvents(hostId, service?) — newest-first, benign-suppressed NodeLogLine stream + { asOf, stale }"
  - "buildServiceLogEventsSql(hostId, service) — the config_id-PK benign-JOIN SQL shape"
  - "mapServiceLogEventRow — raw row → NodeLogLine (level narrowing, ts pre-format, inert message)"
affects:
  - "15-08 (un-stub NodeLogsStream logs / ServiceLogTail logRows swap points)"
tech-stack:
  added: []
  patterns:
    - "D-04 read-time suppression keyed on the matched-pattern PRIMARY KEY (c.id = e.config_id) — never on classification"
    - "Log-STREAM read shape (collected_at DESC LIMIT N) distinct from the DISTINCT-ON latest-per-entity facts"
key-files:
  created:
    - src/lib/read/service-log-events.ts
    - src/lib/read/service-log-events.test.ts
  modified: []
decisions:
  - "Suppression joins log_patterns_config ON c.id = e.config_id (1:1 PK) — a classification join would invert suppression (BP-001 leaks via the suppress=false 40001 sibling) and fan out rows (critical rendered once per sibling config row); shape test asserts the classification join is ABSENT"
  - "config_id = NULL (unmatched/'other') survives via COALESCE(c.suppress,false)=false — unmatched lines are shown, never silently dropped"
  - "Reader returns { lines, asOf, stale }: asOf = newest surviving line's collected_at, stale via the shared deriveStale (D-13) — no stored flag"
  - "Level narrowing: error/err/fatal/crit(ical) → error; warn/warning → warn; debug/null/unknown → info — the UI chip never sees a raw level"
  - "ts pre-formatted reader-side as 'YYYY-MM-DD HH:MM:SS UTC' (NodeLogLine contract: component does no unit math)"
  - "DB-backed suite double-gated: describe.skipIf(!NODEMON_QUEUE_URL) + a to_regclass probe that per-test skips when the operator-gated 0003 migration is not yet applied (Plan 15-01 gate)"
metrics:
  duration: ~4m
  completed: 2026-07-14
---

# Phase 15 Plan 03: COL-01 Service-Log-Events Reader Summary

**One-liner:** `getServiceLogEvents` streams newest-first log lines mapped to `NodeLogLine`, suppressing benign lines AT READ via a `log_patterns_config` LEFT JOIN keyed on the matched-pattern `config_id` PK (no inversion, no fan-out), TDD'd RED→GREEN.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (RED) | Failing shape + suppression tests | 34d1911 | src/lib/read/service-log-events.test.ts |
| 1 (GREEN) | Reader + SQL builder + mapper | bad3e3e | src/lib/read/service-log-events.ts |

## What Was Built

- **`buildServiceLogEventsSql(hostId, service)`** — the one net-new SQL shape: `SELECT e.* FROM service_log_events e LEFT JOIN log_patterns_config c ON c.id = e.config_id WHERE e.host_id = $1 AND e.host_id IS NOT NULL [AND e.service_name = $2] AND COALESCE(c.suppress, false) = false ORDER BY e.collected_at DESC LIMIT 500`. A log STREAM (no DISTINCT ON, no MAX(); collector persists everything, suppression is a retunable read-layer decision — D-04/D-10). hostId/service are Drizzle-bound params (T-15-01).
- **`mapServiceLogEventRow`** — maps to the shipped `NodeLogLine` shape (type-only import from `NodeLogsStream`): id, service (null → "unknown"), pre-formatted UTC ts, narrowed level, message passed through unchanged as inert text (T-15-05/T-15-07).
- **`getServiceLogEvents(hostId, service?)`** — lazy `dbNodemon` import + `execute` idiom (host-metrics analog), returns `{ lines, asOf, stale }` with `stale` derived via the shared `deriveStale` (D-13).
- **Tests (two tiers):** 11 always-run no-DB shape/mapper tests (config_id join present, classification join ABSENT, COALESCE clause, stream ordering + LIMIT, no DISTINCT ON/MAX, injection strings bound not inlined, level narrowing, inert message) + 4 DB-backed suppression/fan-out tests (BP-001 suppressed, 40001 sibling survives, critical appears exactly once, newest-first + service filter) gated on `NODEMON_QUEUE_URL` **and** a `to_regclass` probe for the operator-gated 0003 tables.

## Verification

- `npx vitest run src/lib/read/service-log-events.test.ts` — 11 passed, 4 skipped (no DB in worktree env; consistent with the Plan 15-01 operator gate).
- Full read-layer suite `npx vitest run src/lib/read` — 233 passed / 21 skipped (was 222/17 pre-plan; +11/+4 all from this file, zero regressions).
- `npx tsc --noEmit` — zero errors mentioning service-log-events.
- `grep -E "\.format|f\"|\+ hostId|\+ service" src/lib/read/service-log-events.ts` — no matches (no string-built SQL, T-15-01).
- Acceptance greps confirmed in compiled SQL: `left join log_patterns_config`, `c.id = e.config_id`, `coalesce(c.suppress, false) = false`, `collected_at desc`, `limit`; absent: `c.classification = e.classification`, `distinct on`.

## TDD Gate Compliance

RED→GREEN verified in git log:
1. `34d1911` test(15-03) — RED (import failure, module absent)
2. `bad3e3e` feat(15-03) — GREEN (11 pass / 4 env-skipped)

No refactor commit needed — implementation landed clean.

## Deviations from Plan

**1. [Adaptation] DB-backed tests double-gated on table existence (operator gate from Plan 15-01)**
- **Found during:** Task 1 test authoring
- **Issue:** The plan gates the DB-backed tests only on `NODEMON_QUEUE_URL`, but the live nodemon DB has NOT had migration 0003 applied (operator-gated per 15-01). With the URL set but tables absent, the suite would error instead of skipping.
- **Fix:** Added a `to_regclass('service_log_events'/'log_patterns_config')` probe in `beforeAll`; each DB test `ctx.skip()`s when the tables are absent. Behavior with URL unset is unchanged (`describe.skipIf`).
- **Files modified:** src/lib/read/service-log-events.test.ts
- **Commit:** 34d1911

No other deviations — plan executed as written.

## Authentication Gates

None new. The DB-backed suppression tests inherit the Plan 15-01 operator gate (0003 apply as DB owner) — they skip cleanly until it is applied, then run under the same owner-credentialed test environment the existing telemetry-fixture suites use.

## Known Stubs

None. (The Plan-08 page swap points `logs: []` / `logRows: []` remain stubbed by design — un-stubbing them is Plan 15-08's scope, and this reader is the data source it will wire.)

## Threat Flags

None — all surface is inside the plan's threat model: T-15-01 mitigated (bound params + grep gate), T-15-05 mitigated (per-pattern config_id suppression, inert message), T-15-07 preserved (reader returns data only, no command derivation).

## Self-Check: PASSED

- FOUND: src/lib/read/service-log-events.ts (exports buildServiceLogEventsSql, mapServiceLogEventRow, getServiceLogEvents)
- FOUND: src/lib/read/service-log-events.test.ts
- FOUND commits: 34d1911, bad3e3e
