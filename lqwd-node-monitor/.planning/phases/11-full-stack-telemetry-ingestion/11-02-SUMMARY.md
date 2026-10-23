---
phase: 11-full-stack-telemetry-ingestion
plan: 02
subsystem: database
tags: [postgres, rls, role-grants, telemetry, seed, security]

# Dependency graph
requires:
  - phase: 11-01
    provides: nodemon telemetry schema (host_metrics, host_storage, service_health, chain_telemetry fact tables + hosts, service_inventory dimensions)
provides:
  - "nodemon_telemetry least-privilege role (SELECT/INSERT/DELETE on 4 fact tables, SELECT on 2 dimensions)"
  - "host-axis FORCE RLS with two-arg fail-closed app.host_id policies on all 4 fact tables (+ node_pubkey clause on service_health)"
  - "db/seed-dimensions.sql one-time operator bootstrap of the canary host + 10 service_inventory rows (D-17/D-18)"
affects: [11-03, 11-04, collect_telemetry.py, CANARY-RUNBOOK]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-arg current_setting('app.host_id', true) → NULL-on-unset → fail-closed RLS (host-axis clone of the nodemon_node pubkey-axis pattern)"
    - "Dimensions seeded out-of-band by operator psql because the SELECT/INSERT-only collector role cannot INSERT them under FORCE RLS (D-18)"

key-files:
  created:
    - db/seed-dimensions.sql
  modified:
    - db/role-grants.sql

key-decisions:
  - "Granted scoped DELETE to nodemon_telemetry for the in-collector 21-day retention prune (D-02), still RLS-boxed to the node's own host_id"
  - "Infra trio (bitcoind/esplora/postgres) seeded host-level with node_pubkey NULL; the SVC-01 six are node-scoped with the canary pubkey"
  - "rebalance declared in service_inventory with is_expected=false so it reads as no-data, never DOWN (D-17, cron disabled on the live fleet)"

patterns-established:
  - "Host-axis FORCE RLS: ENABLE+FORCE + USING/WITH CHECK on host_id for host-level facts; service rows add (node_pubkey IS NULL OR node_pubkey = current_setting('app.node_pubkey', true))"
  - "Operator-run, run-once, NOT-Drizzle-migrated SQL artifacts carry an explicit header + embedded verification query"

requirements-completed: [TEL-01, TEL-02, TEL-03]

# Metrics
duration: ~12min
completed: 2026-06-29
---

# Phase 11 Plan 02: Telemetry Role-Grants + Dimension Seed Summary

**A least-privilege `nodemon_telemetry` role with host-axis FORCE RLS on the 4 telemetry fact tables, plus a one-time operator psql seed of the canary host + the D-17 9-service inventory (rebalance not-expected).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Appended a `nodemon_telemetry` role to `db/role-grants.sql`: SELECT/INSERT/DELETE on the 4 fact tables, SELECT only on the 2 dimensions — no UPDATE/TRUNCATE/DDL anywhere.
- Added ENABLE + FORCE ROW LEVEL SECURITY with two-arg fail-closed `app.host_id` policies on host_metrics/host_storage/chain_telemetry, and a host_id + node_pubkey policy on service_health.
- Created `db/seed-dimensions.sql`: a hand-authored, operator-run, run-once bootstrap seeding the canary `hosts` row + 10 `service_inventory` rows (SVC-01 six + infra trio graded, rebalance declared not-expected) with verbatim per-service detection/parse/interval values.
- Both files carry an embedded verification SELECT and explicit "NOT a Drizzle migration" discipline.

## Task Commits

Each task was committed atomically:

1. **Task 1: Append nodemon_telemetry role + host-axis FORCE RLS to role-grants.sql** - `8a64e7f` (feat)
2. **Task 2: Create db/seed-dimensions.sql operator one-time bootstrap** - `650834c` (feat)

## Files Created/Modified
- `db/role-grants.sql` - Added the `nodemon_telemetry` least-privilege role + host-axis FORCE RLS block (4 ENABLE+FORCE tables, 4 fail-closed policies, grant-set verification query).
- `db/seed-dimensions.sql` - NEW operator-run seed: canary `hosts` row + 10 `service_inventory` rows (9 expected D-17 + rebalance not-expected) with per-service freshness clocks.

## Decisions Made
- Included scoped `DELETE` in the fact-table grant (beyond the bare SELECT/INSERT) to support the recommended in-collector 21-day retention prune (D-02); RLS still boxes the DELETE to the node's own host_id.
- `expected_interval_seconds` set per-service cadence (300 for `*/5` + persistent log-liveness, 3600 for hourly, 21600 for 6-hourly) so batch services are not judged against the ~15-min collector clock.
- Infra trio uses `detection_method='native'` per the plan (the systemctl/probe target stored in `running_target`); `pgrep` only for the persistent Go procs (channelAcceptor, Monitoring); `cron-mtime` for batch services.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Initial Edit targeted the shared-checkout path; re-applied against the worktree copy (worktree isolation guard). No content impact.

## Threat Surface
All threat-register mitigations (T-11-03 cross-host forgery, T-11-04 privilege creep, T-11-05 owner-bypass) are implemented: two-arg fail-closed host-axis RLS, SELECT/INSERT/(+scoped DELETE)-only grant set asserted by the verification query, and an explicit "role MUST NOT own the tables" note. No new security surface beyond the plan's threat model.

## User Setup Required
None in this plan directly — but note both SQL files are OPERATOR-RUN: the operator applies `db/role-grants.sql` (as nodemon DB owner) and `db/seed-dimensions.sql` (substituting real `<CANARY_HOST_ID>`/`<CANARY_PUBKEY>` values) via psql at runbook time, before the collector's first tick. Deferred to the Plan 07 runbook.

## Next Phase Readiness
- The integrity boundary (role + RLS) and the expected-set dimension rows are now defined for the collector (`collect_telemetry.py`, later plan) to SET LOCAL app.host_id/app.node_pubkey and INSERT against.
- Placeholders `<generated-strong-password>`, `<CANARY_HOST_ID>`, `<CANARY_PUBKEY>` remain operator-substituted by design (secrets/host facts never committed).

## Self-Check: PASSED

- db/role-grants.sql — FOUND
- db/seed-dimensions.sql — FOUND
- 11-02-SUMMARY.md — FOUND
- Commit 8a64e7f (Task 1) — FOUND
- Commit 650834c (Task 2) — FOUND

---
*Phase: 11-full-stack-telemetry-ingestion*
*Completed: 2026-06-29*
