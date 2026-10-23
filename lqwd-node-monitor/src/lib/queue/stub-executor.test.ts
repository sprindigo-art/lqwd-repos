import { config as loadEnv } from "dotenv";
// Load the git-ignored local env BEFORE any lazy DB import resolves.
loadEnv({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { acquireSuiteLock, type SuiteLock } from "../../../test/db-suite-lock";
import { requireNodemonDb } from "@/lib/queue/test-helpers";

// DB-required tag (HARDEN-01): throws in CI without NODEMON_QUEUE_URL; local
// DB-less runs skip with a visible warning (enrolls in the CI fail-on-skip gate).
const DB_AVAILABLE = requireNodemonDb("stub-executor.test.ts");

// =====================================================
// QUEUE-04 — TEST-ONLY stub executor (claimed→executing→succeeded|failed)
// =====================================================
// D-13: this driver is the ONLY thing that advances post-approval states in
// Phase 6 (the real node does so in Phase 7). There is NO operator "simulate"
// control and NO UI mount — a throwaway simulate button was explicitly rejected
// (RESEARCH Anti-Patterns / Deferred Ideas). The grep gate in the plan AC proves
// no `src/app` or `src/components` import of this module.
//
// runStubExecutor(outcome): claimNext() one approved row, then flip
// claimed→executing→(succeeded|failed) via guarded transactional flips + an
// audit row each, and write ONE command_executions row. Tests assert the full
// audit chain approved→claimed→executing→outcome and the execution row.

const NODE_PUBKEY = "02test-stub-04";
const CANONICAL = '{"action":"update_fee","stub-test":true}';
const SIGNATURE = "00".repeat(32);
const HOUR = 60 * 60 * 1000;

async function db() {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  return dbNodemon;
}

/** Node-scoped cleanup so a parallel suite sharing the DB is never disturbed. */
async function cleanup() {
  const d = await db();
  const { commands, commandAudit, commandExecutions } = await import("@/lib/db/schema/nodemon");
  const owned = await d
    .select({ id: commands.id })
    .from(commands)
    .where(eq(commands.nodePubkey, NODE_PUBKEY));
  const ids = owned.map((r) => r.id);
  if (ids.length > 0) {
    await d.delete(commandExecutions).where(inArray(commandExecutions.commandId, ids));
    await d.delete(commandAudit).where(inArray(commandAudit.commandId, ids));
    await d.delete(commands).where(inArray(commands.id, ids));
  }
}

/** Seed one APPROVED row ready to be claimed + driven by the stub. */
async function seedApproved(): Promise<string> {
  const d = await db();
  const { commands } = await import("@/lib/db/schema/nodemon");
  const id = randomUUID();
  await d.insert(commands).values({
    id,
    nodePubkey: NODE_PUBKEY,
    actionType: "update_fee",
    params: { base_fee_msat: 1000, fee_rate_ppm: 100 },
    canonicalPayload: CANONICAL,
    signatureHex: SIGNATURE,
    state: "approved",
    expiresAt: new Date(Date.now() + HOUR),
  });
  return id;
}

async function stateOf(id: string): Promise<string | null> {
  const d = await db();
  const { commands } = await import("@/lib/db/schema/nodemon");
  const [row] = await d.select({ state: commands.state }).from(commands).where(eq(commands.id, id));
  return row?.state ?? null;
}

async function auditChain(id: string): Promise<string[]> {
  const d = await db();
  const { commandAudit } = await import("@/lib/db/schema/nodemon");
  const rows = await d
    .select({ toState: commandAudit.toState, ts: commandAudit.ts })
    .from(commandAudit)
    .where(eq(commandAudit.commandId, id))
    .orderBy(commandAudit.ts);
  return rows.map((r) => r.toState);
}

async function executionsFor(id: string) {
  const d = await db();
  const { commandExecutions } = await import("@/lib/db/schema/nodemon");
  return d.select().from(commandExecutions).where(eq(commandExecutions.commandId, id));
}

let suiteLock: SuiteLock;

beforeAll(async () => {
  if (!DB_AVAILABLE) return;
  // Serialize against the sibling claim integration suite (shared DB).
  suiteLock = await acquireSuiteLock();
});

afterAll(async () => {
  if (!DB_AVAILABLE) return;
  await cleanup();
  await suiteLock.release();
});

beforeEach(async () => {
  if (!DB_AVAILABLE) return;
  await cleanup();
});

describe.skipIf(!DB_AVAILABLE)("runStubExecutor — TEST-ONLY post-approval driver (D-13)", () => {
  it("succeeded path: claims → executing → succeeded + one execution row + full audit chain", async () => {
    const { runStubExecutor } = await import("@/lib/queue/stub-executor");
    const id = await seedApproved();

    const result = await runStubExecutor("succeeded");

    expect(result).toEqual({ id });
    expect(await stateOf(id)).toBe("succeeded");

    const execs = await executionsFor(id);
    expect(execs).toHaveLength(1);
    expect(execs[0].outcome).toBe("succeeded");
    expect(execs[0].executedAt).not.toBeNull();

    // The full transition chain is auditable: approved→claimed→executing→succeeded.
    const chain = await auditChain(id);
    expect(chain).toEqual(["claimed", "executing", "succeeded"]);
  });

  it("failed path: claims → executing → failed + one execution row outcome 'failed'", async () => {
    const { runStubExecutor } = await import("@/lib/queue/stub-executor");
    const id = await seedApproved();

    const result = await runStubExecutor("failed");

    expect(result).toEqual({ id });
    expect(await stateOf(id)).toBe("failed");

    const execs = await executionsFor(id);
    expect(execs).toHaveLength(1);
    expect(execs[0].outcome).toBe("failed");

    const chain = await auditChain(id);
    expect(chain).toEqual(["claimed", "executing", "failed"]);
  });

  it("returns null when there is no approved row to claim", async () => {
    const { runStubExecutor } = await import("@/lib/queue/stub-executor");
    // no seed
    expect(await runStubExecutor("succeeded")).toBeNull();
  });
});
