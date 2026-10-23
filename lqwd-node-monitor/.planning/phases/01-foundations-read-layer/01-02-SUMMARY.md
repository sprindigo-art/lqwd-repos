---
phase: 01-foundations-read-layer
plan: 02
subsystem: data-layer
tags: [drizzle, postgres-js, server-only, read-only, health-check, instrumentation, afm, role-grants]
requires:
  - "01-01 scaffold (Next.js app, server-only, postgres/drizzle deps)"
provides:
  - "Three server-only Drizzle clients on three roles: dbRouting (RO), dbLdk (RO), dbNodemon (RW)"
  - "Boot-time fail-loud health check (instrumentation.ts → runStartupHealthCheck)"
  - "Session-level read-only enforcement on both warehouse clients (default_transaction_read_only)"
  - "Operator artifacts: db/role-grants.sql (nodemon_ro) + docs/SETUP-PREREQUISITES.md"
affects:
  - "Plans 01-03/01-04 import dbRouting/dbLdk for warehouse reads"
  - "Phase 6 will add the nodemon queue tables behind dbNodemon (none in Phase 1)"
tech-stack:
  added:
    - "drizzle-orm/postgres-js clients (3 separate postgres() pools)"
  patterns:
    - "import server-only on every DB/credential module; fail-loud requireEnv() (no localhost literals, no dev defaults)"
    - "globalThis singleton per client (dev hot-reload pool-leak guard)"
    - "boot health check probes: reachability (SELECT 1), warehouse read-only (write rejected 25006/42501), nodemon writable"
    - "INTERIM: connection { default_transaction_read_only: true } makes warehouse writes impossible regardless of role grants"
key-files:
  created:
    - "src/lib/db/env.ts (requireEnv, warehousePrepareFlag)"
    - "src/lib/db/warehouse-routing.ts (dbRouting RO)"
    - "src/lib/db/warehouse-ldk.ts (dbLdk RO)"
    - "src/lib/db/nodemon.ts (dbNodemon RW)"
    - "src/lib/db/schema/{routing,ldk,nodemon}.ts (placeholder schemas)"
    - "src/lib/db/health.ts (runStartupHealthCheck)"
    - "src/lib/db/health.test.ts (guarded integration test)"
    - "src/instrumentation.ts (Next.js boot hook)"
    - "drizzle.routing.config.ts, drizzle.ldk.config.ts (PULL-ONLY), drizzle.nodemon.config.ts (migrate target)"
    - "db/role-grants.sql, docs/SETUP-PREREQUISITES.md"
    - "test/server-only-stub.ts"
  modified:
    - "tsconfig.json (target ES2017→ES2020 for BigInt), vitest.config.ts (server-only alias)"
    - "src/lib/db/warehouse-routing.ts + warehouse-ldk.ts (session read-only — interim D-02 bridge)"
decisions:
  - "D-01..D-03/D-07/D-08 honored: three least-privilege clients, warehouse configs PULL-ONLY, pooler flag (WAREHOUSE_PG_TXN_POOLER), nodemon wired with NO tables (deferred to Phase 6), nodemon the only migrate target."
  - "INTERIM (operator-approved): bridged the warehouse read path with the existing grafana_demo_ro role + an SSH port-forward tunnel through the Demo Grafana VM (whitelisted to the warehouse), instead of the not-yet-created nodemon_ro role."
  - "Because grafana_demo_ro is NOT a true read-only role (it has CREATE on schema public), added session-level default_transaction_read_only=on to both warehouse clients so NodeMonitor physically cannot write regardless of role — the strict boot check then passes honestly."
metrics:
  completed: "2026-06-09"
  tasks: 4
  files: 17
---

# Phase 1 Plan 02: Three Drizzle Clients + Boot Health Check Summary

Three `server-only` Drizzle clients on three least-privilege roles (2 read-only warehouses + 1 read-write local `nodemon`), a fail-loud boot-time health check wired through `instrumentation.ts`, and the operator-run `nodemon_ro` grant SQL + setup doc (READ-01). The warehouse read path is live now via an **interim grafana-role bridge** (operator decision) with **session-level read-only enforcement** so the safety guarantee holds until the dedicated `nodemon_ro` role is created.

## What Was Built

- **Task 1 — Three clients + configs** (`4702669`): `env.ts` (fail-loud `requireEnv()`, `warehousePrepareFlag()` reading `WAREHOUSE_PG_TXN_POOLER`); `dbRouting`/`dbLdk` read-only warehouse clients + `dbNodemon` RW client, each `import "server-only"`, each a `globalThis` singleton; three `drizzle.*.config.ts` (warehouse two marked **PULL ONLY**, nodemon the only `generate`/`migrate` target); placeholder schemas (no queue tables — Phase 6).
- **Task 2 — Boot health check** (`5f7aea9`): `health.ts` `runStartupHealthCheck()` asserts env presence → reachability (`SELECT 1`) → warehouse read-only (a `CREATE TEMP TABLE` inside a rolled-back txn MUST be rejected with `25006`/`42501`) → nodemon writable; `instrumentation.ts` calls it on the Node runtime so a throw aborts server start. `health.test.ts` guarded by `skipIf(!ROUTING_VM_DATABASE_URL)`.
- **Task 3 — Operator artifacts** (`d87b2b7`, +`c4a16bf` grep-guard cleanup): `db/role-grants.sql` (`CREATE ROLE nodemon_ro`, `default_transaction_read_only = on`, scoped `GRANT SELECT`, `role_table_grants` verification query, no blanket/write grants) and `docs/SETUP-PREREQUISITES.md` (role provisioning, IP whitelist, local nodemon, §A pooler probe, `.env.local` template).
- **Task 4 — Checkpoint resolution** (`cb316b9`): operator chose the interim grafana-role bridge (below); added session-level `default_transaction_read_only: true` to both warehouse clients; verified the boot health check passes end-to-end against the live warehouses + local nodemon.

## Checkpoint Resolution — Interim Warehouse Bridge (operator-approved)

The dedicated `nodemon_ro` role and warehouse IP-whitelist are not yet provisioned. Per operator decision ("use the grafana role until we can create new role"), the warehouse read path was bridged as follows — **temporary; the durable path remains `db/role-grants.sql` → `nodemon_ro`**:

- **Reachability:** this host is not whitelisted on `192.243.215.101`. An SSH local-forward tunnel (`127.0.0.1:15432 → 192.243.215.101:5432`) runs through the **Demo Grafana VM** `64.23.131.62` (already whitelisted as the Grafana datasource host). The tunnel runs no remote commands — port-forward only — and is dev-only scaffolding.
- **Auth:** `.env.local` (git-ignored) uses the existing `grafana_demo_ro` credentials for both `ROUTING_VM_DATABASE_URL` and `LDK_LSPD_DATABASE_URL`; `NODEMON_QUEUE_URL` points at a local Docker `postgres:16` (`nodemon` DB, port 5433).
- **Read-only safety:** see the deviation below.

## Verification Results

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 16 passed, 1 skipped (the live-warehouse test skips without `ROUTING_VM_DATABASE_URL` in the vitest env).
- `grep -rn "localhost" src drizzle.*.config.ts` → no matches (no host literals in source).
- `grep -q default_transaction_read_only db/role-grants.sql` → present.
- **Live boot health check (`runStartupHealthCheck` equivalent), via the grafana bridge:**
  - `routing_vm`: reachable, `SELECT 1` OK, write probe **rejected `25006`** → read-only PASS.
  - `ldk-lspd-main`: reachable, `SELECT 1` OK, write probe **rejected `25006`** → read-only PASS.
  - `nodemon` (local :5433): reachable, temp-table create+drop **succeeds** → writable PASS.
  - `next dev` boots with `.env.local` and no health-check throw.

## Deviations from Plan

### Operator-approved interim (D-01/D-02)

**1. [Operator decision] Temporary `grafana_demo_ro` warehouse bridge instead of `nodemon_ro`**
- **Why:** dedicated role + IP-whitelist not yet provisioned; operator wanted live reads now.
- **Risk control:** `grafana_demo_ro` has SELECT on warehouse tables and **no INSERT/UPDATE/DELETE** on existing data (existing warehouse data cannot be mutated). It is, however, **not a true read-only role** — it holds `CREATE` on schema `public` (the pre-PG15 `GRANT CREATE ON public TO PUBLIC` default), so it can create/drop its own objects.
- **Mitigation (`cb316b9`):** both warehouse clients now set `connection: { default_transaction_read_only: true }`, so every NodeMonitor warehouse connection is read-only at the session level — any write hits `25006` regardless of role grants. This satisfies the boot check's read-only assertion honestly and is belt-and-suspenders even after `nodemon_ro` lands.
- **Deviates from:** D-02 ("read-only enforced at the DB role level, not app convention"). This is an explicitly temporary app-level enforcement; the role-level guarantee returns with `nodemon_ro`.

### Auto-fixed issues (during Tasks 1–3)

- **[Rule 3] tsconfig `target` ES2017→ES2020** — Wave 1's `units.test.ts` BigInt literals failed `tsc --noEmit` under ES2017 (Vitest/esbuild had masked it); this plan's gate requires `tsc` to pass.
- **[Rule 3] Vitest `server-only` alias** — `health.test.ts` imports a `server-only` module; added `resolve.alias` `server-only` → `test/server-only-stub.ts` no-op so server-only modules are unit-testable. Real build-time guard unaffected.
- **[grep-guard hygiene] (`c4a16bf`)** reworded comments to avoid the literal `localhost` / `GRANT SELECT ON ALL` tokens so the `no-host-literal` / `no-blanket-grant` grep guards stay exact.

## Authentication Gates

- **Checkpoint Task 4 (`checkpoint:human-action`)** — operator infrastructure: warehouse role + reachability + local nodemon. Resolved via the interim grafana bridge above (operator-approved). The original durable path (`db/role-grants.sql` + IP whitelist) is documented in `docs/SETUP-PREREQUISITES.md` and remains the follow-up.

## Known Stubs

- `src/lib/db/schema/nodemon.ts` is an intentional placeholder — the `nodemon` queue tables (`commands`/`executions`/`audit`) are deferred to Phase 6 by design (D-07). The RW client + DB exist and are health-checked; no tables yet.

## Notes for Downstream

- **Dev environment is live but scaffolded:** the SSH tunnel (`127.0.0.1:15432`) and local Docker `nodemon` (`:5433`) must be running for warehouse reads. `.env.local` points warehouse URLs at the tunnel and `nodemon` at `:5433`.
- **Plans 01-03/01-04** can import `dbRouting`/`dbLdk` and read live warehouse data now (read-only enforced at the session).
- **Follow-ups (carry forward):**
  1. Create the dedicated `nodemon_ro` role (`db/role-grants.sql`) + whitelist the run-host IP, then point `.env.local` directly at the warehouse and drop the grafana bridge.
  2. **Security hardening (warehouse):** `REVOKE CREATE ON SCHEMA public FROM PUBLIC` on `routing_vm` + `ldk-lspd-main` — the `grafana_demo_ro` (and any role) can currently create objects in `public`. Existing data is already protected (SELECT-only).

## Self-Check: PASSED

All declared files exist on disk; task commits (`4702669`, `5f7aea9`, `d87b2b7`, `c4a16bf`, `cb316b9`) present in git log. Boot health check verified passing live against both warehouses + local nodemon.
