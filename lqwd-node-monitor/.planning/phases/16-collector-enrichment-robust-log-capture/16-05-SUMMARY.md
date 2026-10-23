---
phase: 16-collector-enrichment-robust-log-capture
plan: 05
subsystem: collector-dimensions
tags: [path-reconciler, owner-side-ddl, service-inventory, upsert, d-07, col-06]

# Dependency graph
requires:
  - phase: 16-collector-enrichment-robust-log-capture
    provides: "16-04 nullable category column + re-derived log-pattern seed (owner-side ADD COLUMN discipline mirrored here)"
provides:
  - "Owner-run scripts/fileserver/path-reconciler.sql: guarded UNIQUE (host_id, service_name) constraint DDL + convention-driven UPSERT of lnd/bitcoind/postgres daemon-log paths into service_inventory fleet-wide off the hosts dimension"
  - "db/seed-dimensions.sql documents the standard daemon paths/globs (bitcoind/postgres artifact_path populated, lnd convention noted) with a reconcile-not-clobber note so the seed and reconciler never diverge"
affects: [17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Owner-run reconciler as a SEPARATE SQL artifact (guarded constraint DDL + convention UPSERT) — never folded into the collector; the collector stays SELECT-only on service_inventory (Pitfall 7)"
    - "Guarded idempotent ADD CONSTRAINT via DO $$ IF NOT EXISTS (pg_constraint) $$ (mirrors 16-04 ADD COLUMN IF NOT EXISTS) so ON CONFLICT (host_id, service_name) resolves against the live PK-only schema and re-runs never error"
    - "Convention-driven fleet UPSERT: INSERT ... SELECT off hosts CROSS JOIN inline VALUES; ON CONFLICT DO UPDATE SET artifact_path ONLY (reconcile, not clobber canary-tuned columns)"

key-files:
  created:
    - scripts/fileserver/path-reconciler.sql
  modified:
    - db/seed-dimensions.sql

key-decisions:
  - "Assert the guarded UNIQUE (host_id, service_name) constraint owner-side BEFORE the UPSERT — the live schema (nodemon.ts) has PK id only, so ON CONFLICT would otherwise raise 'no unique or exclusion constraint matching the ON CONFLICT specification'"
  - "DO UPDATE SET artifact_path ONLY — never detection_method/is_expected/node_pubkey/expected_interval_seconds — so canary-tuned rows survive re-runs (reconcile, not clobber)"
  - "No GRANT and no schema generate/migrate anywhere — reconciler runs with owner creds; the collector's SELECT-only warehouse boundary is preserved (T-16-05)"

patterns-established:
  - "Standard fleet daemon-log convention: lnd /lnd/logs/bitcoin/mainnet/lnd.log (stable-name), bitcoind /bitcoin/debug.log (stable-name), postgres /var/log/postgresql/postgresql-*.log (GLOB, resolve_artifact newest-match)"

requirements-completed: [COL-06]

# Metrics
duration: ~8min
completed: 2026-07-16
---

# Phase 16 Plan 05: Owner-Run Daemon-Path Reconciler Summary

**Created a SEPARATE owner-run reconciler (`scripts/fileserver/path-reconciler.sql`) that first asserts a guarded UNIQUE (host_id, service_name) constraint against the live PK-only `service_inventory`, then UPSERTs the standard fleet lnd/bitcoind/postgres daemon-log paths+globs fleet-wide off the `hosts` dimension — self-healing on re-run without clobbering canary rows — and documented those same conventions in `db/seed-dimensions.sql` so the seed and reconciler never diverge. No collector write; the SELECT-only warehouse boundary is untouched.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-07-16
- **Tasks:** 2
- **Files created/modified:** 2 (1 created, 1 modified)

## Accomplishments
- Created `scripts/fileserver/path-reconciler.sql` as an OPERATOR-RUN artifact: it opens with the seed-dimensions header discipline (owner-run, hand-authored, NOT a schema generate/migrate, NOT collector self-seed), then STEP 1 emits a guarded idempotent `DO $$ ... IF NOT EXISTS (pg_constraint conname='service_inventory_host_service_uniq') ... ALTER TABLE service_inventory ADD CONSTRAINT ... UNIQUE (host_id, service_name) ... $$` so ON CONFLICT resolves against the live PK-only schema and re-runs never error.
- STEP 2 implements the RESEARCH Pattern 7 convention-driven UPSERT: `INSERT INTO service_inventory (host_id, service_name, artifact_path) SELECT ... FROM hosts h CROSS JOIN (VALUES (lnd, /lnd/logs/bitcoin/mainnet/lnd.log), (bitcoind, /bitcoin/debug.log), (postgres, /var/log/postgresql/postgresql-*.log)) conv ON CONFLICT (host_id, service_name) DO UPDATE SET artifact_path = EXCLUDED.artifact_path` — keyed off hosts so a new host auto-registers all three paths with no SSH, and DO UPDATE touches ONLY artifact_path.
- Added an owner verification SELECT that asserts every hosts row carries lnd/bitcoind/postgres artifact_path and that the postgres row carries the `*` glob; plus an inline note that `nodemon.ts`'s service_inventory type surface should document the owner-created UNIQUE constraint for future readers.
- Extended `db/seed-dimensions.sql`: populated the previously-NULL infra-trio artifact_path for bitcoind (`/bitcoin/debug.log`) and postgres (`/var/log/postgresql/postgresql-*.log` GLOB), documented the node-scoped lnd log convention, and added a D-07 reconciler-ownership + reconcile-not-clobber note. Extended the verification SELECT to surface artifact_path. Left detection_method/is_expected/expected_interval_seconds/host+pubkey placeholders unchanged and the OPERATOR-RUN header intact.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create path-reconciler.sql — guarded UNIQUE DDL + convention UPSERT** — `766f4bc` (feat)
2. **Task 2: Document standard daemon paths/globs + canary reconcile note in seed-dimensions.sql** — `d90f719` (feat)

## Files Created/Modified
- `scripts/fileserver/path-reconciler.sql` (created) — owner-run guarded-constraint DDL + convention-driven daemon-path UPSERT; no GRANT, no schema migrate; owner verification SELECT.
- `db/seed-dimensions.sql` (modified) — bitcoind/postgres artifact_path populated; lnd convention + D-07 reconciler ownership documented; verification SELECT surfaces artifact_path.

## Decisions Made
- **Guarded UNIQUE constraint asserted before the UPSERT** — the live schema gives `service_inventory` PK `id` (uuid) only with no composite unique; without the constraint the `ON CONFLICT (host_id, service_name)` raises "no unique or exclusion constraint matching the ON CONFLICT specification". Wrapped in a `pg_constraint` existence guard (ADD CONSTRAINT has no IF NOT EXISTS) to stay idempotent, mirroring 16-04's ADD COLUMN IF NOT EXISTS discipline.
- **DO UPDATE SET artifact_path ONLY** — preserves detection_method/is_expected/node_pubkey/expected_interval_seconds so the canary-tuned rows survive; the reconciler self-heals on a path move rather than clobbering (T-16-07).
- **No GRANT, no schema generate/migrate** — the reconciler is a separate owner-run artifact; the collector (nodemon_telemetry) stays SELECT-only on service_inventory (Pitfall 7, T-16-05).

## Deviations from Plan

None — plan executed exactly as written. Both tasks landed with the guarded UNIQUE constraint DDL, the convention-driven UPSERT, the documented daemon paths/globs, and the reconcile-not-clobber note.

## Verification
- Task 1 gate: `grep` confirms `service_inventory_host_service_uniq`, `ADD CONSTRAINT`, `ON CONFLICT (host_id, service_name)`, `DO UPDATE SET artifact_path`, `postgresql-*.log` present, and NO `GRANT` / NO `drizzle` literal anywhere → GATE_OK.
- Task 2 gate: `grep` confirms `/bitcoin/debug.log`, `postgresql-*.log`, `/lnd/logs/bitcoin/mainnet/lnd.log`, and a `reconcil` note present in `db/seed-dimensions.sql` → GATE_OK.
- Both files are owner-run SQL — no automated DB apply here; the operator runs them with owner creds per the header contract.

## Threat Compliance
- **T-16-05 (EoP):** No `GRANT ... ON service_inventory to nodemon_telemetry` introduced; verified by the no-GRANT grep gate. Collector stays SELECT-only.
- **T-16-06 (Tampering, bad paths):** artifact_path values are hard-coded fleet conventions in the UPSERT VALUES list (not derived from untrusted input); DO UPDATE touches only artifact_path.
- **T-16-07 (Tampering, clobber):** ON CONFLICT DO UPDATE limited to artifact_path; guarded UNIQUE constraint makes re-apply idempotent (reconcile, not clobber).

## User Setup Required
- Operator schedules `scripts/fileserver/path-reconciler.sql` owner-side (e.g. an owner cron running `psql -f`) against the `nodemon` DB with owner creds — it asserts the UNIQUE constraint (once) and reconciles daemon-log paths fleet-wide. The collector role cannot apply this (SELECT-only). Standard out-of-band operator step (D-18).
- For future readers, the `service_inventory` type surface in `src/lib/db/schema/nodemon.ts` should document the owner-created UNIQUE (host_id, service_name) constraint (noted inline in the reconciler; not edited in this plan per files_modified scope).

## Self-Check: PASSED

- Both files present on disk (`scripts/fileserver/path-reconciler.sql` created, `db/seed-dimensions.sql` modified).
- Both task commits present in git history (`766f4bc`, `d90f719`).

---
*Phase: 16-collector-enrichment-robust-log-capture*
*Completed: 2026-07-16*
