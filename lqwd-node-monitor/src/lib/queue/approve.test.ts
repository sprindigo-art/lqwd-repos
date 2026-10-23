import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cleanPubkeyRows,
  closeQueueDb,
  mkTestPubkey,
  requireNodemonDb,
  seedCommand,
} from "@/lib/queue/test-helpers";
import { acquireSuiteLock, type SuiteLock } from "../../../test/db-suite-lock";

// DB-required tag (HARDEN-01): throws in CI without NODEMON_QUEUE_URL; local
// DB-less runs skip with a visible warning (enrolls in the CI fail-on-skip gate).
const DB_AVAILABLE = requireNodemonDb("approve.test.ts");

// Per-FILE pubkey namespace so this suite is parallel-safe against the shared
// nodemon DB (cleanup is scoped to this pubkey, never a global TRUNCATE).
const TEST_PUBKEY = mkTestPubkey();

// =====================================================
// QUEUE-03 — approve/reject guarded flip + audit (live nodemon)
// =====================================================
// Each transition is a `UPDATE … WHERE id=? AND state=<expected>` `.returning()`
// inside one transaction: zero rows updated → throw (the lost-race "no longer
// pending" guard, T-06-08). Every flip co-writes a command_audit row (T-06-09):
// approve records the stale-data acknowledgement (D-10); reject captures the
// optional free-text reason (D-07). No flip without an audit trail.

const NONEXISTENT_ID = "00000000-0000-0000-0000-000000000000";

// This suite flips rows to `approved`, which the GLOBAL claimNext() in the
// sibling QUEUE-04 suites (claim.test.ts / stub-executor.test.ts) would steal if
// they ran concurrently against the shared nodemon DB. Hold the same suite-level
// advisory lock so all three serialize — per-pubkey isolation alone cannot guard
// an `approved` row from a global, cross-pubkey claim. Production never locks.
let suiteLock: SuiteLock;

beforeAll(async () => {
  if (!DB_AVAILABLE) return;
  suiteLock = await acquireSuiteLock();
});

afterAll(async () => {
  if (!DB_AVAILABLE) return;
  await cleanPubkeyRows(TEST_PUBKEY);
  // Release the advisory lock before closing the pool — the lock lives on a
  // reserved connection from that same pool.
  await suiteLock.release();
  await closeQueueDb();
});

beforeEach(async () => {
  if (!DB_AVAILABLE) return;
  await cleanPubkeyRows(TEST_PUBKEY);
});

describe.skipIf(!DB_AVAILABLE)("approve (guarded pending_approval → approved + audit)", () => {
  it("flips pending_approval → approved and writes an audit row", async () => {
    const { approve } = await import("@/lib/queue/transitions");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await approve(id, false);

    const [row] = await dbNodemon.select().from(commands).where(eq(commands.id, id));
    expect(row.state).toBe("approved");

    const audit = await dbNodemon
      .select()
      .from(commandAudit)
      .where(eq(commandAudit.commandId, id));
    expect(audit).toHaveLength(1);
    expect(audit[0].fromState).toBe("pending_approval");
    expect(audit[0].toState).toBe("approved");
    expect(audit[0].actor).toBe("operator");
    expect(audit[0].staleAcknowledged).toBe(false);
  });

  it("records stale_acknowledged=true when the operator overrides the stale gate (D-10)", async () => {
    const { approve } = await import("@/lib/queue/transitions");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commandAudit } = await import("@/lib/db/schema/nodemon");

    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await approve(id, true);

    const [audit] = await dbNodemon
      .select()
      .from(commandAudit)
      .where(eq(commandAudit.commandId, id));
    expect(audit.staleAcknowledged).toBe(true);
  });

  it("throws on a second approve of an already-approved row (lost-race guard)", async () => {
    const { approve } = await import("@/lib/queue/transitions");
    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await approve(id, false);
    await expect(approve(id, false)).rejects.toThrow(/no longer pending/i);
  });

  it("throws when approving a non-existent / non-pending id", async () => {
    const { approve } = await import("@/lib/queue/transitions");
    await expect(approve(NONEXISTENT_ID, false)).rejects.toThrow(/no longer pending/i);
  });
});

describe.skipIf(!DB_AVAILABLE)("reject (guarded pending_approval → rejected + audit, optional reason)", () => {
  it("flips pending_approval → rejected and captures the optional reason (D-07)", async () => {
    const { reject } = await import("@/lib/queue/transitions");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await reject(id, "bad fee");

    const [row] = await dbNodemon.select().from(commands).where(eq(commands.id, id));
    expect(row.state).toBe("rejected");

    const [audit] = await dbNodemon
      .select()
      .from(commandAudit)
      .where(eq(commandAudit.commandId, id));
    expect(audit.fromState).toBe("pending_approval");
    expect(audit.toState).toBe("rejected");
    expect(audit.reason).toBe("bad fee");
  });

  it("rejects with a null reason when none is provided", async () => {
    const { reject } = await import("@/lib/queue/transitions");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commandAudit } = await import("@/lib/db/schema/nodemon");

    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await reject(id);

    const [audit] = await dbNodemon
      .select()
      .from(commandAudit)
      .where(eq(commandAudit.commandId, id));
    expect(audit.toState).toBe("rejected");
    expect(audit.reason).toBeNull();
  });

  it("throws when rejecting an already-rejected row (lost-race guard)", async () => {
    const { reject } = await import("@/lib/queue/transitions");
    const id = await seedCommand(TEST_PUBKEY, "pending_approval");
    await reject(id, "first");
    await expect(reject(id, "second")).rejects.toThrow(/no longer pending/i);
  });
});
