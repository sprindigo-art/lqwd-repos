---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 01
subsystem: database
tags: [drizzle, postgres, rls, telemetry, log-ingestion, pg-health, deep-vm-metrics]
requires: []
provides:
  - 8 new nodemon Drizzle tables (service_log_events, log_patterns, log_patterns_config, host_metrics_ext, host_cpu_core, host_disk_io, host_net_iface, pg_health)
  - host_storage additive nullable inode columns (inodes_total/used/free)
  - drizzle/nodemon/0003 additive migration (generated + committed; live apply operator-gated)
  - Phase-15 nodemon_telemetry grants + FORCE RLS block in db/role-grants.sql
  - db/seed-log-patterns.sql (Obsidian BP-001..008 + AP-11/AP-12 transcription)
affects: [15-03, 15-04, 15-05, 15-06, 15-07, 15-09]
tech-stack:
  added: []
  patterns:
    - config_id-per-event read-time suppression key (join log_patterns_config on PK, never on classification)
    - child-fact composite index (host_id, <dim>, collected_at DESC) per hostStorage template
    - single deliberate UPDATE grant exception (log_patterns upsert) with zero-row misconfiguration probe
key-files:
  created:
    - drizzle/nodemon/0003_moaning_randall.sql
    - drizzle/nodemon/meta/0003_snapshot.json
    - db/seed-log-patterns.sql
  modified:
    - src/lib/db/schema/nodemon.ts
    - drizzle/nodemon/meta/_journal.json
    - db/role-grants.sql
decisions:
  - "service_log_events.config_id is a nullable uuid identity pointer to the matched log_patterns_config row — suppression resolves per PATTERN at read, never per classification (benign class holds both suppress=true BP rows and the suppress=false SQLSTATE 40001 sibling)"
  - "contextLines is a self-contained text column (Open-Q2 option a — no child table/join)"
  - "classification stays plain text (not pgEnum) so it is SQL-tunable (D-05)"
  - "0003 live application is an OPERATOR-RUN step: nodemon_rw lacks CREATE on schema public; all prior DDL (0000-0002) was owner-applied on the live nodemon DB — same out-of-band discipline as role-grants/seeds"
metrics:
  duration: ~25m
  completed: 2026-07-14
---

# Phase 15 Plan 01: DB Foundation — 8 Tables, Migration, Grants, Seed Summary

Eight Phase-15 nodemon tables (raw log events with config_id suppress key + pattern aggregate/config + deep-VM scalar/child facts + pg_health) defined, migrated (file generated; live apply operator-gated), with least-privilege grants + FORCE RLS and the Obsidian pattern seed authored.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | Define 8 new nodemon tables + host_storage inode columns | 7d8b3ac | src/lib/db/schema/nodemon.ts |
| 2 | Generate + apply 0003 nodemon migration | 76592f9 | drizzle/nodemon/0003_moaning_randall.sql, meta/ (generated + verified additive-only; live apply gated — see Auth Gates) |
| 3 | Extend role-grants.sql + author seed-log-patterns.sql | 2171e17 | db/role-grants.sql, db/seed-log-patterns.sql |

## What Was Built

- **Schema (Task 1):** 8 new `pgTable` defs appended to `src/lib/db/schema/nodemon.ts` under a Phase-15 section, mirroring the shipped fact shape (uuid pk defaultRandom, host_id RLS axis, collected_at, RAW-only columns — no severity/band/stale, D-06b/D-14). `service_log_events` carries `contextLines` (±5, D-01) and nullable `configId` (per-pattern read-time suppress key) plus a `(host_id, signature)` index for exemplar retention. `log_patterns` has UNIQUE `(host_id, signature)` backing the D-03 upsert. Child facts (`host_cpu_core`/`host_disk_io`/`host_net_iface`) key `(host_id, <dim>, collected_at DESC)` per the hostStorage template (Pitfall 4). `hostStorage` gained additive nullable `inodes_total/used/free`. tsc clean for nodemon.ts; shipped host-metrics + storage-growth reader tests green (18 pass / 5 skipped).
- **Migration (Task 2):** `drizzle/nodemon/0003_moaning_randall.sql` — exactly 8 `CREATE TABLE` + 3 `ALTER TABLE host_storage ADD COLUMN`; zero DROP/RENAME; zero GRANT/CREATE POLICY (RLS hand-authored). No rename prompts occurred.
- **Grants + RLS + Seed (Task 3):** Phase-15 block appended to `db/role-grants.sql`: SELECT/INSERT/DELETE on the 6 new raw facts; the ONE deliberate `UPDATE` exception on `log_patterns` (documented, Pitfall 1/T-15-03); SELECT-only on `log_patterns_config`; ENABLE+FORCE RLS on all 7 new fact tables with fail-closed two-arg `current_setting('app.host_id', true)` policies; compound host+pubkey policy on `service_log_events` mirroring `tel_own_service` (NULL node_pubkey allowed for host-level rows); verification extended with an explicit zero-row UPDATE/TRUNCATE misconfiguration probe. `db/seed-log-patterns.sql` transcribes all 15 Obsidian rows (BP-001..008 + AP-11/AP-12a/b + kernel hard-zero bands); `FATAL: sorry, too many clients already` → ap12; `SQLSTATE 40001` → benign with suppress=false.

## Authentication Gates

**Task 2 — live migration apply requires the nodemon DB owner (operator action pending):**

- `NODEMON_QUEUE_URL` connects as `nodemon_rw`, which has **no CREATE privilege on schema public**; all existing nodemon tables are owned by `postgres` (superuser). No `drizzle.__drizzle_migrations` journal exists on the live DB — migrations 0000–0002 were applied out-of-band by the owner (the schema's own 0002 comment confirms this practice). `drizzle-kit migrate` therefore both lacks privileges and would attempt a from-scratch replay.
- No local dev nodemon DB exists (local Postgres on 5432 rejects all available credentials).
- **Operator step (before Plans 03/04/05 readers run against real rows and before the Plan 09 canary):** connect to the nodemon DB (192.243.215.101) **as the owner (`postgres`)** and run:
  ```
  psql "<owner nodemon URL>" -f drizzle/nodemon/0003_moaning_randall.sql
  ```
  (`--> statement-breakpoint` lines are `--` comments — psql handles the file directly.) Then apply the Phase-15 block of `db/role-grants.sql` and `db/seed-log-patterns.sql` (canary time, Plan 09).
- Verification after apply: the 8 tables list in `\dt`; `host_storage` shows the 3 inode columns; the role-grants zero-row probe returns nothing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] NODEMON_QUEUE_URL absent from the worktree environment**
- **Found during:** Task 2 (`drizzle-kit generate/migrate` needs the URL)
- **Issue:** `.env.local` is git-ignored and not copied into the parallel worktree
- **Fix:** exported `NODEMON_QUEUE_URL` from the main repo's `.env.local` for the migrate/verify runs (never printed, never committed)
- **Files modified:** none
- **Commit:** n/a (environment only)

### Blocked (not auto-fixable)

**2. [Auth gate] 0003 live apply requires DB-owner credentials not held by the dashboard**
- Documented above under Authentication Gates; consistent with the project's operator-run-DDL discipline (Core Value: dashboard holds no privileged credentials). The migration FILE is complete, verified additive-only, and committed; Plan-09 canary runbook covers the apply. Task 3 proceeded because it is pure file authoring with no live-DB dependency (its artifacts are themselves operator-run).

## Verification

- `npx tsc --noEmit` — zero errors in nodemon.ts.
- `npx vitest run src/lib/read/host-metrics.test.ts src/lib/read/storage-growth.test.ts` — 18 pass / 5 skipped (additive change proven non-breaking).
- 0003: 8 CREATE TABLE, 3 additive ADD COLUMN, no DROP/RENAME/GRANT/POLICY.
- role-grants: FORCE RLS count 7 → 14 (+7); `UPDATE ON` matches only log_patterns; no `ON ALL TABLES`; compound `app.node_pubkey` policy on service_log_events.
- seed: 15 rows; ap12 too-many-clients row present; 40001 row benign/suppress=false.

## Threat Flags

None — all new surface (tables, grants, RLS) is inside the plan's threat model (T-15-02 mitigated via FORCE RLS; T-15-03 mitigated via the single scoped UPDATE grant + zero-row probe).

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/lib/db/schema/nodemon.ts (8 new pgTables, configId, inode columns)
- FOUND: drizzle/nodemon/0003_moaning_randall.sql
- FOUND: drizzle/nodemon/meta/0003_snapshot.json
- FOUND: db/role-grants.sql Phase-15 block
- FOUND: db/seed-log-patterns.sql
- FOUND commits: 7d8b3ac, 76592f9, 2171e17
