import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/routing";
import { requireEnv, warehousePrepareFlag } from "./env";

// =====================================================
// dbRouting — routing_vm (LND) read-only client
// =====================================================
// Fail-loud (no graceful-null fallback): requireEnv throws at boot if the URL
// is missing. Read-only is enforced at the DB role (target: dedicated `nodemon_ro`).
// INTERIM (D-02 deviation): while the dedicated read-only role is pending, the
// connection also forces `default_transaction_read_only=on` so NodeMonitor
// physically cannot write through this client regardless of the role's grants
// (e.g. the temporary `grafana_demo_ro` bridge can CREATE in public schema). Any
// write attempt -> SQLSTATE 25006. This is belt-and-suspenders once `nodemon_ro`
// (role-level read-only) lands; remove or keep as defense-in-depth then.
// Module-level singleton cached on globalThis prevents dev hot-reload pool
// leaks (drizzle-orm#1988). `?sslmode=...` lives in the env URL, never code.

const globalForDb = globalThis as unknown as { _routingSql?: postgres.Sql };

const sql =
  globalForDb._routingSql ??
  postgres(requireEnv("ROUTING_VM_DATABASE_URL"), {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: warehousePrepareFlag(), // false only if PgBouncer txn-mode pooler (D-03)
    connection: {
      default_transaction_read_only: true, // session-level RO (interim, D-02)
      // Pin the session timezone: `timestamp` columns store UTC wall time, and
      // any timestamptz comparison would otherwise shift with the server's
      // default TimeZone — an unstated deployment assumption (WR-04). The SQL
      // builders are also written timezone-independent (AT TIME ZONE 'UTC');
      // this is belt-and-suspenders for the VM-ready env-only boot.
      TimeZone: "UTC",
    },
  });

if (process.env.NODE_ENV !== "production") globalForDb._routingSql = sql;

export const dbRouting = drizzle(sql, { schema });
