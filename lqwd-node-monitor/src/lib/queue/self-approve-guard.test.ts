import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import {
  cleanPubkeyRows,
  closeQueueDb,
  mkTestPubkey,
  requireNodemonDb,
  seedCommand,
} from "@/lib/queue/test-helpers";
import { acquireSuiteLock, type SuiteLock } from "../../../test/db-suite-lock";

// =====================================================
// HARDEN-01 / Q2 — DB-level self-approve guard (live nodemon)
// =====================================================
// Proves the `nodemon_node_transition_guard` BEFORE UPDATE trigger
// (drizzle/nodemon/0005_self_approve_guard.sql, canonical in db/role-grants.sql):
//   * the executor role CANNOT flip pending_approval → approved (self-approve) —
//     rejected AT THE DB, independent of app code (T-18-24);
//   * the node/reaper-legal edges (approved→claimed, claimed→approved reaper
//     release, →expired TTL) still succeed as the executor role;
//   * the operator/dashboard-writer approval path (approve()) is unaffected.
//
// The executor identity is reached with `SET LOCAL ROLE nodemon_node` inside one
// transaction (the trigger keys on current_user, so SET ROLE exercises it exactly
// as a real nodemon_node login would). `app.node_pubkey` is set in the same tx so
// the row is VISIBLE under the FORCE-RLS node_own_commands policy — otherwise the
// UPDATE would match zero rows and the trigger would never fire (a false pass).
//
// DB-required tag (HARDEN-01, per 18-01): throws in CI without NODEMON_QUEUE_URL;
// local DB-less runs skip with a visible warning.
//
// CI/OPERATOR PREREQUISITES on the target nodemon DB (beyond a plain `drizzle-kit
// migrate`): db/role-grants.sql must have been applied (creates the `nodemon_node`
// role + FORCE RLS on commands) AND migration 0005 must be applied (installs the
// trigger), AND the test's login role must be able to `SET ROLE nodemon_node`
// (superuser, or a member of nodemon_node). The "prerequisites installed" test
// below fails LOUDLY with remediation guidance if any of these is missing — a
// missing guard is a real deploy-gate failure, not a skip.

const DB_AVAILABLE = requireNodemonDb("self-approve-guard.test.ts");
const TEST_PUBKEY = mkTestPubkey();
const EXECUTOR_ROLE = "nodemon_node";
const GUARD_TRIGGER = "nodemon_node_transition_guard";

// This suite flips rows to `approved`/`claimed`, which the GLOBAL claimNext() in the
// sibling QUEUE-04 suites would steal if run concurrently against the shared nodemon
// DB. Hold the shared advisory lock so all queue integration suites serialize.
let suiteLock: SuiteLock;

/**
 * Run `fn` inside ONE transaction AS the executor role, with `app.node_pubkey`
 * bound so the seeded row is visible under RLS. The transaction commits on success
 * and rolls back if `fn` (or the trigger) throws — so a rejected self-approve leaves
 * no residue. Role name is a fixed constant (no injection surface).
 */
async function asExecutor(fn: (tx: postgres.TransactionSql) => Promise<void>): Promise<void> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  await dbNodemon.$client.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL ROLE "${EXECUTOR_ROLE}"`);
    await tx`SELECT set_config('app.node_pubkey', ${TEST_PUBKEY}, true)`;
    await fn(tx);
  });
}

/** Read one command's current state via the owner drizzle client (RLS-unscoped). */
async function stateOf(id: string): Promise<string | undefined> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands } = await import("@/lib/db/schema/nodemon");
  const [row] = await dbNodemon.select().from(commands).where(eq(commands.id, id));
  return row?.state;
}

beforeAll(async () => {
  if (!DB_AVAILABLE) return;
  suiteLock = await acquireSuiteLock();
});

afterAll(async () => {
  if (!DB_AVAILABLE) return;
  await cleanPubkeyRows(TEST_PUBKEY);
  await suiteLock.release();
  await closeQueueDb();
});

beforeEach(async () => {
  if (!DB_AVAILABLE) return;
  await cleanPubkeyRows(TEST_PUBKEY);
});

describe.skipIf(!DB_AVAILABLE)("self-approve guard (DB-level executor transition trigger)", () => {
  it("prerequisites installed: nodemon_node role + guard trigger exist on this DB", async () => {
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { sql } = await import("drizzle-orm");

    const roleRows = await dbNodemon.execute(
      sql`SELECT 1 FROM pg_roles WHERE rolname = ${EXECUTOR_ROLE}`,
    );
    expect(
      roleRows.length,
      `Role "${EXECUTOR_ROLE}" is missing. Apply db/role-grants.sql (nodemon_node block) ` +
        "to this nodemon DB before running the self-approve guard proof.",
    ).toBeGreaterThan(0);

    const trigRows = await dbNodemon.execute(
      sql`SELECT 1 FROM pg_trigger WHERE tgname = ${GUARD_TRIGGER} AND NOT tgisinternal`,
    );
    expect(
      trigRows.length,
      `Trigger "${GUARD_TRIGGER}" is missing. Apply nodemon migration 0005_self_approve_guard.sql ` +
        "(npx drizzle-kit migrate --config drizzle.nodemon.config.ts) before running this proof.",
    ).toBeGreaterThan(0);
  });

  it("REJECTS pending_approval → approved for nodemon_node (self-approve blocked)", async () => {
    const id = await seedCommand(TEST_PUBKEY, "pending_approval");

    await expect(
      asExecutor(async (tx) => {
        await tx`UPDATE commands SET state = 'approved' WHERE id = ${id} AND state = 'pending_approval'`;
      }),
    ).rejects.toThrow(/executor-illegal edge|approval is operator-only/i);

    // The row must remain pending — the rejected transaction left no residue.
    expect(await stateOf(id)).toBe("pending_approval");
  });

  it("REJECTS pending_approval → rejected and approved → withdrawn for nodemon_node (operator-only edges)", async () => {
    const pendingId = await seedCommand(TEST_PUBKEY, "pending_approval");
    await expect(
      asExecutor(async (tx) => {
        await tx`UPDATE commands SET state = 'rejected' WHERE id = ${pendingId}`;
      }),
    ).rejects.toThrow(/executor-illegal edge/i);
    expect(await stateOf(pendingId)).toBe("pending_approval");

    const approvedId = await seedCommand(TEST_PUBKEY, "approved");
    await expect(
      asExecutor(async (tx) => {
        await tx`UPDATE commands SET state = 'withdrawn' WHERE id = ${approvedId}`;
      }),
    ).rejects.toThrow(/executor-illegal edge/i);
    expect(await stateOf(approvedId)).toBe("approved");
  });

  it("ALLOWS approved → claimed for nodemon_node (atomic claim)", async () => {
    const id = await seedCommand(TEST_PUBKEY, "approved");
    await asExecutor(async (tx) => {
      await tx`UPDATE commands SET state = 'claimed' WHERE id = ${id} AND state = 'approved'`;
    });
    expect(await stateOf(id)).toBe("claimed");
  });

  it("ALLOWS claimed → approved for nodemon_node (reaper release)", async () => {
    const id = await seedCommand(TEST_PUBKEY, "claimed");
    await asExecutor(async (tx) => {
      await tx`UPDATE commands SET state = 'approved' WHERE id = ${id} AND state = 'claimed'`;
    });
    expect(await stateOf(id)).toBe("approved");
  });

  it("ALLOWS pending_approval → expired for nodemon_node (TTL fail-close)", async () => {
    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await asExecutor(async (tx) => {
      await tx`UPDATE commands SET state = 'expired' WHERE id = ${id} AND state = 'pending_approval'`;
    });
    expect(await stateOf(id)).toBe("expired");
  });

  it("does NOT block the dashboard-writer approval path (approve() still flips the row)", async () => {
    // approve() runs as the owner / dashboard-writer role via dbNodemon — current_user
    // is NOT nodemon_node, so the guard bypasses and the operator gate keeps working.
    const { approve } = await import("@/lib/queue/transitions");
    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await approve(id, false);
    expect(await stateOf(id)).toBe("approved");
  });
});
