---
phase: 17-incident-lifecycle-ai-explanation
plan: 03
subsystem: database
tags: [drizzle, postgres, migration, incident-tracking, nodemon]

# Dependency graph
requires:
  - phase: 06-command-queue
    provides: nodemon Drizzle-owned queue DB + drizzle.nodemon.config.ts migration flow
provides:
  - incident_tracking table (ack/owner/snooze + D-06 mute baseline + D-07 epochs)
  - partial-unique index incident_tracking_active_key_uniq (incident_key WHERE cleared_at IS NULL) — D-01 one-active-per-key
  - incidentTracking pgTable typed surface in src/lib/db/schema/nodemon.ts
affects: [17-05, 17-07, 17-08, 17-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "nodemon-only write surface: DDL applied out-of-band with owner role; app role (nodemon_rw) holds DML grants only"
    - "partial-unique index for one-active-row-per-key soft-delete lifecycle"

key-files:
  created:
    - drizzle/nodemon/0004_strong_vapor.sql
    - drizzle/nodemon/meta/0004_snapshot.json
    - drizzle/nodemon/manual/0004_incident_tracking.apply.sql
  modified:
    - src/lib/db/schema/nodemon.ts
    - drizzle/nodemon/meta/_journal.json

key-decisions:
  - "Live migration applied out-of-band by operator with an owner role — nodemon_rw lacks DDL/CREATE privilege by design (dashboard never holds elevated node/DB credentials)"
  - "Scoped manual apply script created (drizzle/nodemon/manual/) because the live nodemon DB has no drizzle migration history and drizzle-kit migrate would replay/fail; the generated 0004 SQL stays as the drizzle record"
  - "Excluded the log_patterns_config.category ALTER that drizzle bundled into 0004 — pre-existing Phase-16 drift, out of scope, and that table does not exist in this DB"

patterns-established:
  - "Owner-applied DDL + nodemon_rw DML grants: the app role can never mutate schema, only rows"
  - "Partial-unique active-row index encodes D-01 (at most one uncleared tracking row per incident_key)"

requirements-completed: [INC-02]

# Metrics
duration: ~90min (incl. blocking migration checkpoint)
completed: 2026-07-20
---

# Phase 17-03: incident_tracking write surface Summary

**Added the phase's only new write surface — the `incident_tracking` nodemon table (ack/owner/snooze + D-06 mute + D-07 epochs) with a partial-unique active-key index — as a typed Drizzle schema and applied it live via an owner-role, nodemon-only migration.**

## Performance

- **Duration:** ~90 min (schema autonomous; live migration gated on a blocking human-verify checkpoint)
- **Completed:** 2026-07-20
- **Tasks:** 2 (Task 1 autonomous; Task 2 human-verify checkpoint)
- **Files modified/created:** 5

## Accomplishments
- `incidentTracking` pgTable added to `src/lib/db/schema/nodemon.ts` — 9 columns, `uniqueIndex` partial on `(incident_key) WHERE cleared_at IS NULL`, plus a plain key index
- Drizzle migration `0004_strong_vapor.sql` generated (via `drizzle.nodemon.config.ts` → nodemon only) and committed with its snapshot/journal
- Live `incident_tracking` table created in the nodemon DB with the partial-unique index; `nodemon_rw` granted SELECT/INSERT/UPDATE/DELETE — verified live
- No warehouse (`routing_vm` / `ldk-lspd-main`) schema touched — nodemon-only write boundary held (T-17-06)

## Task Commits

1. **Task 1: Add incidentTracking pgTable to nodemon schema** — `97cbd79` (feat)
2. **Task 2: Generate + apply nodemon migration** — `1c8c8fd` (feat — generated SQL + snapshot + manual apply script). Live apply performed out-of-band by the operator with an owner role.

## Files Created/Modified
- `src/lib/db/schema/nodemon.ts` — `incidentTracking` pgTable + `uniqueIndex`/`sql` imports
- `drizzle/nodemon/0004_strong_vapor.sql` — drizzle-generated migration (incident_tracking + indexes; also carries a Phase-16 log_patterns_config.category drift line, not applied here)
- `drizzle/nodemon/meta/0004_snapshot.json`, `drizzle/nodemon/meta/_journal.json` — drizzle migration state
- `drizzle/nodemon/manual/0004_incident_tracking.apply.sql` — scoped, idempotent owner-apply script (incident_tracking + indexes + nodemon_rw grants) used for the live apply

## Decisions Made
- **Owner-applied DDL, not app-applied.** The nodemon `nodemon_rw` role has no CREATE/DDL privilege by design — the dashboard never holds elevated credentials. The operator applied the DDL out-of-band with an owner role.
- **Manual scoped apply script.** The live nodemon DB has no `drizzle.__drizzle_migrations` history and is only partially populated, so `drizzle-kit migrate` would replay/fail. A hand-run, idempotent script under `drizzle/nodemon/manual/` applied exactly Phase 17's table + indexes + grants; the generated `0004` SQL remains the drizzle-side record.
- **Excluded Phase-16 drift.** `0004` bundled an unrelated `log_patterns_config.category` ALTER (schema edited in 16-04 without a migration). It was left unapplied — separate Phase-16 concern; `log_patterns_config` doesn't exist in this DB.

## Deviations from Plan
The plan's `how-to-verify` referenced `npm run db:generate` / `npm run db:migrate`. Those scripts pass no `--config` and there is no default `drizzle.config.*`, and the app role cannot run DDL — so generation used the explicit `--config drizzle.nodemon.config.ts`, and the live apply was performed out-of-band by the operator with an owner role via a scoped manual script. Outcome matches the plan's acceptance criteria (table + partial-unique index live in nodemon, no warehouse touched); the mechanism differed to respect the zero-elevated-credentials boundary.

## Issues Encountered
- **Blocking:** `nodemon_rw` lacks DDL/CREATE; live DB missing prior drizzle migration history (`__drizzle_migrations`, `log_patterns_config` absent). Resolved by an operator-applied, scoped owner-role migration. Follow-up worth tracking: reconcile Phase-16's nodemon migration state / drizzle journal on this database.

## Next Phase Readiness
- `incident_tracking` is live and writable by `nodemon_rw` — Wave 2 (`17-05` read/write layer + server actions) can build against it.
- Typed `incidentTracking` surface is committed — Waves 2–4 can import it for reads/writes and RSC composition.

---
*Phase: 17-incident-lifecycle-ai-explanation*
*Completed: 2026-07-20*
