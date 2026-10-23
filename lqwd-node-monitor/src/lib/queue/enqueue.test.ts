import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { buildSignedPayload, canonicalize } from "@/lib/queue/canonical";
import {
  cleanPubkeyRows,
  clearTestSecret,
  closeQueueDb,
  mkTestPubkey,
  requireNodemonDb,
  setTestSecret,
} from "@/lib/queue/test-helpers";

// DB-required tag (HARDEN-01): throws in CI without NODEMON_QUEUE_URL; local
// DB-less runs skip with a visible warning (enrolls in the CI fail-on-skip gate).
const DB_AVAILABLE = requireNodemonDb("enqueue.test.ts");

// Per-FILE pubkey namespace so this suite is parallel-safe against the shared
// nodemon DB (cleanup is scoped to this pubkey, never a global TRUNCATE).
const TEST_PUBKEY = mkTestPubkey();

// =====================================================
// QUEUE-01 — enqueue writes pending_approval + audit in ONE txn (live nodemon)
// =====================================================
// Integration suite against the REAL local `nodemon` DB. Proves: sign-once at
// enqueue (id + expires_at fixed BEFORE signing, Pitfall 2), the canonical string
// stored VERBATIM (CLAUDE.md §4), and the command + its initial audit row written
// atomically (one transaction, from_state NULL, D-04/D-08).

const VALID_PARAMS = {
  chanId: "850000000000000000",
  channelPoint: "abcd:0",
  currentPpm: 100,
  suggestedPpm: 750,
  baseFeeMsat: 1000,
  timeLockDelta: 80,
} as const;

beforeAll(() => {
  if (!DB_AVAILABLE) return;
  setTestSecret(TEST_PUBKEY);
});

afterAll(async () => {
  if (!DB_AVAILABLE) return;
  clearTestSecret(TEST_PUBKEY);
  await cleanPubkeyRows(TEST_PUBKEY);
  await closeQueueDb();
});

beforeEach(async () => {
  if (!DB_AVAILABLE) return;
  await cleanPubkeyRows(TEST_PUBKEY);
});

describe.skipIf(!DB_AVAILABLE)("enqueue (sign-once + transactional command + audit insert)", () => {
  it("writes exactly one pending_approval command row for the node", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commands } = await import("@/lib/db/schema/nodemon");

    const id = await enqueue(TEST_PUBKEY, VALID_PARAMS);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    const rows = await dbNodemon
      .select()
      .from(commands)
      .where(and(eq(commands.nodePubkey, TEST_PUBKEY), eq(commands.state, "pending_approval")));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].actionType).toBe("update_fee");
  });

  it("stores the canonical payload VERBATIM and a 64-hex signature", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commands } = await import("@/lib/db/schema/nodemon");

    const id = await enqueue(TEST_PUBKEY, VALID_PARAMS);
    const [row] = await dbNodemon.select().from(commands).where(eq(commands.id, id));

    // Reconstruct the exact signed payload the way enqueue must have — the
    // canonical(params) substring + the row's own id/expiresAt — and assert the
    // stored canonical_payload is byte-identical (verbatim, never re-serialized).
    const expectedPayload = buildSignedPayload({
      nodePubkey: TEST_PUBKEY,
      commandId: id,
      actionType: "update_fee",
      canonicalParams: canonicalize(VALID_PARAMS),
      expiresAt: row.expiresAt.toISOString(),
    });
    expect(row.canonicalPayload).toBe(expectedPayload);
    expect(row.signatureHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("writes exactly one initial audit row with from_state NULL", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commandAudit } = await import("@/lib/db/schema/nodemon");

    const id = await enqueue(TEST_PUBKEY, VALID_PARAMS);
    const audit = await dbNodemon
      .select()
      .from(commandAudit)
      .where(eq(commandAudit.commandId, id));

    expect(audit).toHaveLength(1);
    expect(audit[0].fromState).toBeNull();
    expect(audit[0].toState).toBe("pending_approval");
    expect(audit[0].actor).toBe("operator");
  });

  it("fixes expires_at app-side BEFORE signing (≈ now + TTL hours, in the future)", async () => {
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { dbNodemon } = await import("@/lib/db/nodemon");
    const { commands } = await import("@/lib/db/schema/nodemon");

    const before = Date.now();
    const id = await enqueue(TEST_PUBKEY, VALID_PARAMS);
    const [row] = await dbNodemon.select().from(commands).where(eq(commands.id, id));

    const ttlHours = Number(process.env.NODEMON_TTL_HOURS ?? 24);
    const expectedMs = before + ttlHours * 3600_000;
    const actualMs = row.expiresAt.getTime();
    // Within a generous 60s window of the computed deadline.
    expect(Math.abs(actualMs - expectedMs)).toBeLessThan(60_000);
    expect(actualMs).toBeGreaterThan(before);
  });
});
