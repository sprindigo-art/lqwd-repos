---
phase: 16-collector-enrichment-robust-log-capture
plan: 04
subsystem: read-layer
tags: [log-taxonomy, seed-sql, drizzle-schema, d-04, d-05, col-06, owner-side-ddl]

# Dependency graph
requires:
  - phase: 16-collector-enrichment-robust-log-capture
    provides: "16-01 RED TS guardrails pinning config_id=NULL survival, level narrowing, and counter-driven AP-12 independence"
provides:
  - "Re-derived log_patterns_config seed in the {info,warn,critical} + human-readable category taxonomy (real fleet/canary signatures, opaque ap11/ap12 codes removed)"
  - "Additive nullable `category` column applied owner-side (ADD COLUMN IF NOT EXISTS, no drizzle push) and mirrored in nodemon.ts schema types"
  - "Read-layer module doc reconciled to the D-05 info-tier collect-time override; config_id PK join + config_id=NULL survival invariant unchanged"
affects: [17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-run SQL owns additive DDL (ADD COLUMN IF NOT EXISTS) on externally-managed config table; drizzle schema is a type-surface mirror only (never push/migrate)"
    - "Classification rename is inert to the read layer — suppression keyed on config_id PK, never the classification string"

key-files:
  created: []
  modified:
    - db/seed-log-patterns.sql
    - src/lib/db/schema/nodemon.ts
    - src/lib/read/service-log-events.ts

key-decisions:
  - "Reconcile old-taxonomy rows via owner DELETE + reseed (not per-row UPDATE): the seed is authoritative and historical events keep config_id — a now-deleted id LEFT-JOINs to nothing → line survives as unmatched (A6, accept historical mixed, no backfill)"
  - "Mapped the LND-side ap12b GRDB SQLSTATE 40001 surface to warn/graph-serialization-retry (AP-12 DETECTION stays a pg_health counter, D-04) rather than dropping it"
  - "Set both level and classification columns to the info/warn/critical taxonomy so the reader's narrowLevel maps cleanly; info-tier rows kept suppress=true (exemplars hidden) while their aggregate count survives in log_patterns (D-06)"

patterns-established:
  - "Verification SELECT asserts taxonomy (classification IN info/warn/critical) + non-null category via bool_and, plus a total/suppressed row-count probe for the operator"

requirements-completed: [COL-06]

# Metrics
duration: ~10min
completed: 2026-07-16
---

# Phase 16 Plan 04: Log Taxonomy Read Reconcile Summary

**Re-derived the log classification from real fleet/canary signatures into the clean {info,warn,critical} + human-readable category taxonomy, applied the additive nullable `category` column owner-side (no drizzle push), and reconciled the schema types + read-layer docs — keeping the 16-01 D-04 guardrails green and the config_id PK join untouched.**

## Performance

- **Duration:** ~10 min
- **Completed:** 2026-07-16
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Rewrote `db/seed-log-patterns.sql` (20 rows) into the `{info,warn,critical}` taxonomy with a human-readable `category` per row. Replaced the Obsidian-proven-wrong `[ERR] HSWC.*Unhandled error` row with the REAL canary signatures (`HSWC.*failing link|broken pipe`, `HSWC.*resuming link failed` → warn/channel-reconnect) and added the re-derivation-table rows (CMGR conn-noise, PEER peer-churn, SWPR/UTXN sweep-failure).
- Mapped the opaque codes out: old `ap12a` PG row → `critical/postgres-connection-exhaustion`; old `ap12b` LND GRDB row → `warn/graph-serialization-retry`; old `ap11` closechannel → `warn/close-event` (with an inline note that AP-11 is a read-time RATE signature, not a log class).
- Prepended the owner-applied idempotent `ALTER TABLE log_patterns_config ADD COLUMN IF NOT EXISTS category text;` and a `DELETE FROM log_patterns_config;` reconcile block, preserving the OPERATOR-RUN / not-a-Drizzle-migration header and the per-row config_id/suppress contract. Updated the verification SELECT to assert the taxonomy + non-null category.
- Mirrored the additive `category: text("category")` column in `nodemon.ts` and updated the classification comment `{benign,warn,ap11,ap12,critical,other}` → `{info,warn,critical}` (kept plain `text()`, no pgEnum).
- Recorded the D-05 info-tier collect-time override in the `service-log-events.ts` module doc WITHOUT touching the query — the `c.id = e.config_id` PK join and the `config_id=NULL` survival invariant stay load-bearing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Re-derive db/seed-log-patterns.sql to info/warn/critical + category** — `af4dbc8` (feat)
2. **Task 2: Reconcile schema types + read-layer docs; verify D-04 unaffected** — `716d9ed` (feat)

## Files Created/Modified
- `db/seed-log-patterns.sql` — full re-derivation to info/warn/critical + category; owner-side ADD COLUMN + reconcile DELETE; verification SELECT rewritten.
- `src/lib/db/schema/nodemon.ts` — `category` text column on log_patterns_config; classification comment updated to the new taxonomy (still plain text, no pgEnum).
- `src/lib/read/service-log-events.ts` — module doc records the D-05 info-tier override and the taxonomy rename; query untouched.

## Decisions Made
- **Reconcile via owner DELETE + reseed** (not per-row UPDATE): the seed is authoritative and historical `service_log_events` rows keep their `config_id`; a now-deleted id LEFT-JOINs to nothing → COALESCE(false) → the line survives as unmatched (A6: accept historical mixed classification, no backfill). This is a dimension reset, not a fact delete.
- **ap12b LND GRDB surface → warn/graph-serialization-retry** rather than dropped: it is a real LND-side serialization retry line; the AP-12 DETECTION remains a pg_health COUNTER (telemetry-bands.ts / ap12-advisory.ts, D-04), independent of the log class.
- **level column aligned to info/warn/critical** so the reader's `narrowLevel` maps cleanly; info-tier rows kept `suppress=true` (read-time exemplar hide) while the aggregate count survives in `log_patterns` (D-06).

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed with the specified taxonomy, category column, owner-side DDL, and doc reconcile.

## Issues Encountered
- The Task 1 grep gate initially reported no `OK` because the verification COMMENT itself literally quoted the old codes (`'ap11'/'ap12'/'benign'`), tripping the `! grep` guard. Reworded the comment to not embed the quoted literals; the gate then passed. No functional change.

## Verification
- Task 1 gate: `grep` confirms `category`, `ADD COLUMN IF NOT EXISTS category`, `postgres-connection-exhaustion` present and NO `'ap11'/'ap12'/'benign'` classification literals remain → GATE_OK.
- Task 2 gate: `npx vitest run` on the three read-layer guardrail files → **114 passed / 4 DB-skipped** (16-01 D-04 guardrails stay GREEN). `grep` confirms no classification-value branch in `src/lib`; `telemetry-bands.ts` and `ap12-advisory.ts` unmodified in the working tree. `npx tsc --noEmit` clean.

## D-04 Compliance
The AP-12 counter detectors (`src/lib/read/telemetry-bands.ts`, `src/lib/insight/detectors/ap12-advisory.ts`) are byte-unchanged; the `ap12-advisory.test.ts` D-04 independence guard stays green — dropping the `ap12` LOG class does not touch the pg_health COUNTER path.

## User Setup Required
- Operator must run the updated `db/seed-log-patterns.sql` against the `nodemon` DB as owner (applies the additive `category` column + reseeds the taxonomy). The collector role stays SELECT-only and cannot apply this (T-16-04). This is the standard out-of-band operator step (D-11); no code deploy is required for classification/category retunes (D-05).

## Self-Check: PASSED

- All 3 modified files present on disk.
- Both task commits present in git history (`af4dbc8`, `716d9ed`).

---
*Phase: 16-collector-enrichment-robust-log-capture*
*Completed: 2026-07-16*
