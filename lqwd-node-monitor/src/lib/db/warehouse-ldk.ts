import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/ldk";
import { requireEnv, warehousePrepareFlag } from "./env";

// =====================================================
// dbLdk — ldk-lspd-main (LDK) read-only client
// =====================================================
// Same fail-loud, server-only, singleton pattern as dbRouting. Read-only
// enforced at the DB role (target: dedicated `nodemon_ro`). INTERIM (D-02
// deviation): connection forces `default_transaction_read_only=on` so writes
// are impossible through this client regardless of role grants (temporary
// `grafana_demo_ro` bridge) -> any write hits SQLSTATE 25006. `?sslmode=...`
// lives in the env URL.

const globalForDb = globalThis as unknown as { _ldkSql?: postgres.Sql };

const sql =
  globalForDb._ldkSql ??
  postgres(requireEnv("LDK_LSPD_DATABASE_URL"), {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    prepare: warehousePrepareFlag(), // false only if PgBouncer txn-mode pooler (D-03)
    connection: { default_transaction_read_only: true }, // session-level RO (interim, D-02)
  });

if (process.env.NODE_ENV !== "production") globalForDb._ldkSql = sql;

export const dbLdk = drizzle(sql, { schema });
