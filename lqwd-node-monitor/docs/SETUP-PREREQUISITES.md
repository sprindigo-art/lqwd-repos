# NodeMonitor — Setup Prerequisites

These are the **operator-only** steps the application cannot self-satisfy: provisioning the
read-only warehouse role, whitelisting the run-host IP, standing up the local `nodemon` DB, and
probing the warehouse pooler mode. Once these are done and `.env.local` is populated, the
boot-time health check (`src/lib/db/health.ts`, run from `src/instrumentation.ts`) verifies the
whole chain at `npm run dev` and fails loud naming the exact failing DB/env var if anything is off.

NodeMonitor holds **zero** node credentials and **never** writes to the warehouses — read-only is
enforced at the DB role (D-01/D-02) and proven by a boot write-rejection probe.

---

## 1. Provision the `nodemon_ro` read-only warehouse role

Run [`db/role-grants.sql`](../db/role-grants.sql) **as a warehouse superuser/owner**, once per
warehouse DB:

```bash
# Replace <generated-strong-password> inside the SQL first (operator-generated secret).
psql "host=192.243.215.101 port=5432 dbname=routing_vm     user=<superuser>" -f db/role-grants.sql
psql "host=192.243.215.101 port=5432 dbname=ldk-lspd-main  user=<superuser>" -f db/role-grants.sql
```

The script:

- creates a **dedicated** `nodemon_ro` role (NOT a reuse of `grafana_demo_ro`),
- sets `default_transaction_read_only = on` (forces every session read-only),
- grants `SELECT` on **named read-layer tables only** (no blanket all-tables grant, no write grants),
- ends with an `information_schema.role_table_grants` verification query.

**Verify (must show SELECT rows only — any write privilege row is a misconfiguration):**

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'nodemon_ro'
ORDER BY table_name, privilege_type;
```

> **A1 — confirm table existence:** the optional extended grant set
> (`lnd_node_peer_info`, `lnd_node_pending_channels`, `lnd_node_pending_sweeps`,
> `internal_rebalance_invoices`, `lnd_restart`) is **commented out** in the SQL. Run the
> `information_schema.tables` existence check (also in the SQL) before uncommenting any of them —
> Phase 1's read layer does not need them.

---

## 2. Whitelist the NodeMonitor run-host IP (HARD dependency)

The warehouse at `192.243.215.101` is **IP-whitelisted** — only the operator laptop + demo droplet
are currently allowed. **The application cannot satisfy this; the operator must:**

1. Add the NodeMonitor run-host's public IP to the warehouse **`pg_hba.conf`** (a `host` line
   allowing `nodemon_ro` to connect to `routing_vm` and `ldk-lspd-main`).
2. Open the warehouse **firewall** for that IP on port `5432`.
3. Reload Postgres: `SELECT pg_reload_conf();` (or `sudo systemctl reload postgresql`).

Until this is done, `nodemon_ro` connections from the run host time out and the boot health check
throws `routing_vm: unreachable` / `ldk-lspd-main: unreachable`.

---

## 3. Provision a local `nodemon` Postgres + `nodemon_rw` role

`nodemon` runs in a **local** Postgres during the build, with a config-driven URL (D-08). No queue
tables yet — they land in Phase 6 (D-07). The boot check only asserts this DB is **writable**.

Option A — local Postgres:

```sql
CREATE ROLE nodemon_rw WITH LOGIN PASSWORD '<generated-strong-password>';
CREATE DATABASE nodemon OWNER nodemon_rw;
```

Option B — Docker:

```bash
docker run --name nodemon-pg -e POSTGRES_USER=nodemon_rw \
  -e POSTGRES_PASSWORD=<generated-strong-password> -e POSTGRES_DB=nodemon \
  -p 5432:5432 -d postgres:16
```

---

## 4. Probe the warehouse pooler mode (§A) → set `WAREHOUSE_PG_TXN_POOLER`

Determines whether a transaction-mode PgBouncer fronts the warehouse. If it does, postgres.js
prepared statements break and the flag must be flipped. Default is `false` (prepared statements on),
since the demo Grafana connects directly on `:5432`.

**Decisive probe (prepared-statement persistence):**

```bash
psql "host=192.243.215.101 port=5432 dbname=routing_vm user=nodemon_ro sslmode=prefer" <<'SQL'
PREPARE probe AS SELECT 1;
EXECUTE probe;
EXECUTE probe;
SQL
```

- Direct / session-mode pooling → **succeeds** → leave `WAREHOUSE_PG_TXN_POOLER=false`.
- Transaction-mode PgBouncer → second `EXECUTE` errors
  `prepared statement "probe" does not exist` → set **`WAREHOUSE_PG_TXN_POOLER=true`**
  (which makes `warehousePrepareFlag()` return `false` → `prepare: false`).

---

## 5. Populate `.env.local` (git-ignored — NAMES below, never commit real credentials)

Create `.env.local` at the repo root (already git-ignored). The warehouse host has **no SSL** — use
`?sslmode=prefer`; never force SSL. `localhost` is acceptable **only here** in the `nodemon` URL,
never as a literal in source code.

```dotenv
# LND warehouse (read-only, nodemon_ro)
ROUTING_VM_DATABASE_URL=postgres://nodemon_ro:<pw>@192.243.215.101:5432/routing_vm?sslmode=prefer

# LDK warehouse (read-only, nodemon_ro)
LDK_LSPD_DATABASE_URL=postgres://nodemon_ro:<pw>@192.243.215.101:5432/ldk-lspd-main?sslmode=prefer

# Local nodemon queue DB (read-write, nodemon_rw) — host may be localhost HERE ONLY
NODEMON_QUEUE_URL=postgres://nodemon_rw:<pw>@localhost:5432/nodemon

# Pooler flag — false by default; set true only if the §4 probe shows txn-mode PgBouncer
WAREHOUSE_PG_TXN_POOLER=false
```

---

## 6. Boot and verify

```bash
npm run dev
```

The boot health check (fail-loud) must pass:

- all three DBs reachable (`SELECT 1`),
- **both warehouses reject** a write probe (read-only confirmed via SQLSTATE 25006/42501),
- **nodemon accepts** a rolled-back write (RW confirmed).

If it throws, the message names the exact failing DB or env var (e.g.
`Missing required env: ROUTING_VM_DATABASE_URL`, `routing_vm: unreachable`,
`routing_vm: warehouse role permits writes (read-only NOT enforced)`, `nodemon: RW role not writable`).
