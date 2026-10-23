import "server-only";
import { sql } from "drizzle-orm";
import { dbRouting } from "./warehouse-routing";
import { dbLdk } from "./warehouse-ldk";
import { dbNodemon } from "./nodemon";
import { assertBootEnv } from "./env";
import { classifyReadOnlyProbe } from "./read-only-probe";

// =====================================================
// Boot-time fail-loud health check (RESEARCH §C)
// =====================================================
// Asserts, failing LOUD on the FIRST violation (throwing aborts server start):
//   1. all required env vars present (no host literals in source);
//   2. SELECT 1 reachability against all three DBs;
//   3. both warehouses are READ-ONLY at the ROLE level (a write the role should
//      be denied MUST return a 42501 role-denial — not merely a 25006 session
//      flag rejection; T-18-13, cross-engine health.ts:56 conflict resolution);
//   4. nodemon is WRITABLE (the inverse probe MUST succeed).
// Never logs connection strings or passwords (CLAUDE.md).

// Warehouse tables the role-level write probe targets (Task 1): a SELECT-only
// role rejects a write here with 42501. Hardcoded constants — never user input,
// so `sql.raw` interpolation is injection-safe.
const ROUTING_PROBE_TABLE = "lnd_node_info";
const LDK_PROBE_TABLE = "lightning_channels";

type DrizzleClient = typeof dbRouting | typeof dbLdk | typeof dbNodemon;

/**
 * Extract a Postgres SQLSTATE from a thrown error, if present. Drizzle wraps
 * the driver error (e.g. `Failed query: …`) and puts the real PostgresError on
 * `.cause`, so walk the cause chain — not just the top-level error — or a valid
 * read-only rejection (25006) hides behind the wrapper and the boot check
 * false-fails. Bounded to avoid cycles.
 */
function pgCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (code !== undefined && code !== null && code !== "") return String(code);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** SELECT 1 reachability — throws `<name>: unreachable` on connection failure. */
async function assertReachable(db: DrizzleClient, name: string): Promise<void> {
  try {
    await db.execute(sql`SELECT 1`);
  } catch {
    throw new Error(`${name}: unreachable`);
  }
}

/**
 * A warehouse write MUST be rejected AT THE ROLE LEVEL. The old probe created a
 * TEMP table through a client that already forces `default_transaction_read_only
 * = on`, so it only ever exercised the client's own SESSION flag — a role holding
 * INSERT would still pass, and a 42501 from a missing TEMP privilege passed too
 * (the tautological-probe conflict, T-18-13).
 *
 * This probe instead:
 *   1. STRIPS the session read-only shield (`SET LOCAL transaction_read_only =
 *      off`) so the outcome reflects the role's GRANTS, not the session flag;
 *   2. attempts an INSERT on a REAL warehouse table (always rolled back);
 *   3. requires a genuine `42501` role-denial to PASS.
 *
 * A `25006` (the session flag rejecting the write despite step 1 — e.g. a
 * physical standby in recovery) is INCONCLUSIVE and fails loud: it cannot
 * confirm the role is read-only. An accepted write (or a later constraint error
 * that proves the privilege gate was passed) means the role can write → fail loud.
 */
async function assertReadOnly(db: DrizzleClient, name: string, probeTable: string): Promise<void> {
  let accepted = false;
  let code: string | undefined;
  try {
    await db.transaction(async (tx) => {
      // Remove the session-level RO shield so the write probes the ROLE grant.
      await tx.execute(sql`SET LOCAL transaction_read_only = off`);
      await tx.execute(sql`INSERT INTO ${sql.raw(probeTable)} DEFAULT VALUES`);
      // Reached only if the INSERT was ACCEPTED → the role permits writes. Throw
      // to force a ROLLBACK (the probe row must never commit).
      accepted = true;
      throw new Error("__ro_probe_rollback__");
    });
  } catch (error) {
    if (!accepted) code = pgCode(error);
  }

  if (accepted) {
    throw new Error(`${name}: warehouse role permits writes (INSERT accepted — read-only NOT enforced)`);
  }

  const verdict = classifyReadOnlyProbe(code);
  if (verdict === "read-only-confirmed") return; // 42501 role denial → PASS
  if (verdict === "inconclusive") {
    // 25006 masked the role grant — cannot confirm role-level read-only.
    throw new Error(
      `${name}: read-only probe inconclusive — a 25006 session-flag rejection masked the role grant; cannot confirm role-level read-only`,
    );
  }
  // "writable": the write passed the privilege gate (constraint error, etc.).
  throw new Error(`${name}: warehouse role permits writes (read-only NOT enforced)`);
}

/**
 * Inverse probe: a rolled-back write against nodemon MUST succeed. We create
 * then drop a temp table inside a transaction; any failure means the RW role
 * is not actually writable.
 */
async function assertWritable(db: DrizzleClient, name: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TEMP TABLE _rw_probe (x int)`);
      await tx.execute(sql`DROP TABLE _rw_probe`);
    });
  } catch {
    throw new Error(`${name}: RW role not writable`);
  }
}

/** Boot health check — throws on the first violation (fail loud). */
export async function runStartupHealthCheck(): Promise<void> {
  // 1. Required env presence (throws with the missing var name). The list is the
  //    single source of truth in env.ts (REQUIRED_BOOT_ENV_VARS) — a misconfigured
  //    VM boot halts here by name instead of a silent localhost default (T-18-30).
  assertBootEnv();

  // 2–4. PERF-07: the three databases' probe groups run in PARALLEL (they hit
  //    three independent remote hosts), but WITHIN each group the reachability
  //    probe stays strictly before its privilege probe (reachable-before-probe
  //    ordering — a privilege probe against an unreachable DB would report a
  //    misleading error). Promise.all rejects on the FIRST group to reject, so
  //    the fail-loud/abort-boot posture is unchanged — any single probe failure
  //    still aborts server start.
  await Promise.all([
    // routing_vm: reachable → role-level read-only enforced.
    (async () => {
      await assertReachable(dbRouting, "routing_vm");
      await assertReadOnly(dbRouting, "routing_vm", ROUTING_PROBE_TABLE);
    })(),
    // ldk-lspd-main: reachable → role-level read-only enforced.
    (async () => {
      await assertReachable(dbLdk, "ldk-lspd-main");
      await assertReadOnly(dbLdk, "ldk-lspd-main", LDK_PROBE_TABLE);
    })(),
    // nodemon: reachable → writable (the inverse probe MUST succeed).
    (async () => {
      await assertReachable(dbNodemon, "nodemon");
      await assertWritable(dbNodemon, "nodemon");
    })(),
  ]);
}
