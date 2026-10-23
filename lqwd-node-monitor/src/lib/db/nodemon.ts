import "server-only";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema/nodemon";
import { requireEnv } from "./env";

// =====================================================
// dbNodemon — local nodemon (queue) read-write client
// =====================================================
// Third client wired now (D-07); queue tables deferred to Phase 6. Local
// Postgres, RW role (`nodemon_rw`). No `prepare` override — direct connection.
// The full URL (host included) lives ONLY in git-ignored `.env.local`, never code.
//
// TimeZone is pinned to UTC (DB1): `collected_at` columns store UTC wall time as
// `timestamp WITHOUT time zone`, and the time-window reads compare them against
// `(now() AT TIME ZONE 'UTC')`. Without pinning the session TimeZone, a server on
// a non-UTC default would shift those comparisons (and any `now()`-based read) by
// the offset — the 24h/30d windows must not move with the deployment's locale.
// Belt-and-suspenders alongside the AT TIME ZONE 'UTC' idiom in the SQL builders,
// mirroring the warehouse-routing client's posture (WR-04).

const globalForDb = globalThis as unknown as { _nodemonSql?: postgres.Sql };

const sql =
  globalForDb._nodemonSql ??
  postgres(requireEnv("NODEMON_QUEUE_URL"), {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    connection: {
      TimeZone: "UTC",
    },
  });

if (process.env.NODE_ENV !== "production") globalForDb._nodemonSql = sql;

export const dbNodemon = drizzle(sql, { schema });
