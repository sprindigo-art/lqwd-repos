import { config as loadEnv } from "dotenv";
// Load the git-ignored local env (NODEMON_QUEUE_URL) BEFORE any lazy DB import
// resolves — `dbNodemon` calls requireEnv at module load. This is the first
// DB-backed test in the suite; pure-function tests never touch a pool (Pitfall 7).
loadEnv({ path: ".env.local", quiet: true });

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { acquireSuiteLock, type SuiteLock } from "../../../test/db-suite-lock";
import { requireNodemonDb } from "@/lib/queue/test-helpers";

// DB-required tag (HARDEN-01): throws in CI without NODEMON_QUEUE_URL; local
// DB-less runs skip with a visible warning. Enrolls this file in the CI
// fail-on-skip gate (grep-discovered via this call).
const DB_AVAILABLE = requireNodemonDb("claim.test.ts");

// =====================================================
// QUEUE-04 — atomic claim + fail-closed TTL + stale-claim reaper (live nodemon)
// =====================================================
// The phase's core SAFETY proof (Success Criterion 4). Three integration cases
// against the live local `nodemon` DB:
//   1. overlapping-tick no-double-apply — two concurrent claimNext() on ONE
//      approved row → exactly one {id} and exactly one `claimed` row (Pitfall 3).
//   2. fail-closed TTL — a row past expires_at becomes `expired` and is NOT
//      claimable (D-11, Pitfall 4).
//   3. stale-claim reaper — a `claimed` row older than the timeout is rescued
//      (released back to `approved`) by an independent sweep (D-14).
// Clock is injected (now=…) so TTL/reaper run deterministically without `sleep`
// (RESEARCH §Observability — Clock control).

const NODE_PUBKEY = "02test-claim-04";
// `claimNext()` is GLOBAL by design — it claims the oldest approved row across
// ALL node_pubkeys (production semantics). Vitest runs test files in parallel
// forks, and the sibling stub-executor suite hits the SAME shared local DB,
// seeding its own approved rows — so a naive run lets one suite's claimNext grab
// the other's row. We serialize the two integration suites with a Postgres
// advisory lock held on a RESERVED connection for the whole run (test-only;
// production never locks) — see test/db-suite-lock.ts. Each suite holds the lock
// from beforeAll→afterAll, so they execute one-at-a-time against the shared
// table while staying in separate files (plan-mandated).
// Stable canonical/signature placeholders — Task 1 exercises state transitions,
// not the HMAC contract (proven in sign.test.ts). The DB columns are NOT NULL.
const CANONICAL = '{"action":"update_fee","claim-test":true}';
const SIGNATURE = "00".repeat(32);

// Lazy DB handle so the env load above runs first.
async function db() {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  return dbNodemon;
}

/**
 * Local truncate — wipe only THIS test's rows (scoped by node_pubkey) so a
 * parallel 06-03 suite sharing the DB is never disturbed. (The shared
 * test-helpers.ts truncate is owned by 06-03; we keep a minimal local
 * seed/cleanup to avoid a file-ownership conflict — see plan <note>.)
 */
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

/** Insert one command row in a chosen state with explicit timestamps. */
async function seedCommand(opts: {
  state: "pending_approval" | "approved" | "claimed";
  expiresAt: Date;
  claimedAt?: Date;
}): Promise<string> {
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
    state: opts.state,
    expiresAt: opts.expiresAt,
    claimedAt: opts.claimedAt ?? null,
  });
  return id;
}

async function stateOf(id: string): Promise<string | null> {
  const d = await db();
  const { commands } = await import("@/lib/db/schema/nodemon");
  const [row] = await d.select({ state: commands.state }).from(commands).where(eq(commands.id, id));
  return row?.state ?? null;
}

async function claimedCountFor(ids: string[]): Promise<number> {
  const d = await db();
  const { commands } = await import("@/lib/db/schema/nodemon");
  const rows = await d
    .select({ id: commands.id })
    .from(commands)
    .where(and(inArray(commands.id, ids), eq(commands.state, "claimed")));
  return rows.length;
}

const HOUR = 60 * 60 * 1000;

let suiteLock: SuiteLock;

beforeAll(async () => {
  if (!DB_AVAILABLE) return;
  // Serialize against the sibling stub-executor integration suite (shared DB).
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

// Pure (no DB): the reaper window is SINGLE-SOURCED with the node-side bash tick
// (scripts/node/check-queue) via NODEMON_CLAIMED_TIMEOUT_MS + one shared 15-min
// fallback (Q4). Guards against re-introducing the old 5-min TS default that
// diverged from the bash 15-min literal (a re-claim/double-apply window).
describe("reaper window single-source (Q4)", () => {
  const KEY = "NODEMON_CLAIMED_TIMEOUT_MS";
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[KEY];
  });
  afterAll(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("defaults to the shared 15-minute window when the env var is unset", async () => {
    const { defaultClaimedTimeoutMs, DEFAULT_CLAIMED_TIMEOUT_MS } = await import("@/lib/queue/claim");
    delete process.env[KEY];
    expect(DEFAULT_CLAIMED_TIMEOUT_MS).toBe(900_000);
    expect(defaultClaimedTimeoutMs()).toBe(900_000);
  });

  it("honors NODEMON_CLAIMED_TIMEOUT_MS (the single source shared with check-queue)", async () => {
    const { defaultClaimedTimeoutMs } = await import("@/lib/queue/claim");
    process.env[KEY] = "600000";
    expect(defaultClaimedTimeoutMs()).toBe(600_000);
  });

  it("falls back to the shared default on a non-positive/garbage value", async () => {
    const { defaultClaimedTimeoutMs, DEFAULT_CLAIMED_TIMEOUT_MS } = await import("@/lib/queue/claim");
    process.env[KEY] = "0";
    expect(defaultClaimedTimeoutMs()).toBe(DEFAULT_CLAIMED_TIMEOUT_MS);
    process.env[KEY] = "not-a-number";
    expect(defaultClaimedTimeoutMs()).toBe(DEFAULT_CLAIMED_TIMEOUT_MS);
  });
});

describe.skipIf(!DB_AVAILABLE)("claimNext — atomic single-row claim (FOR UPDATE SKIP LOCKED)", () => {
  it("claims one approved (non-expired) row and flips it to claimed + audit", async () => {
    const { claimNext } = await import("@/lib/queue/claim");
    const id = await seedCommand({ state: "approved", expiresAt: new Date(Date.now() + HOUR) });

    const result = await claimNext();

    expect(result).toEqual({ id });
    expect(await stateOf(id)).toBe("claimed");

    // claimed_at was set, and the approved→claimed audit row exists with actor 'executor'.
    const d = await db();
    const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");
    const [row] = await d.select().from(commands).where(eq(commands.id, id));
    expect(row.claimedAt).not.toBeNull();
    const audit = await d.select().from(commandAudit).where(eq(commandAudit.commandId, id));
    expect(
      audit.some(
        (a) => a.fromState === "approved" && a.toState === "claimed" && a.actor === "executor",
      ),
    ).toBe(true);
  });

  it("returns null when there is no approved row", async () => {
    const { claimNext } = await import("@/lib/queue/claim");
    await seedCommand({ state: "pending_approval", expiresAt: new Date(Date.now() + HOUR) });
    expect(await claimNext()).toBeNull();
  });

  // The no-double-apply assertion (Success Criterion 4, Pitfall 3).
  it("overlapping ticks: two concurrent claimNext() on ONE approved row → exactly one claim", async () => {
    const { claimNext } = await import("@/lib/queue/claim");
    const id = await seedCommand({ state: "approved", expiresAt: new Date(Date.now() + HOUR) });

    const [a, b] = await Promise.all([claimNext(), claimNext()]);

    const successes = [a, b].filter((r) => r !== null);
    const nulls = [a, b].filter((r) => r === null);
    // Exactly one tick won the lock; the other skipped the locked row.
    expect(successes).toHaveLength(1);
    expect(nulls).toHaveLength(1);
    expect(successes[0]).toEqual({ id });
    // The row was claimed exactly once — never twice.
    expect(await claimedCountFor([id])).toBe(1);
  });
});

describe.skipIf(!DB_AVAILABLE)("expireSweep — fail-closed TTL (D-11)", () => {
  it("marks a past-expiry approved row expired and it is no longer claimable", async () => {
    const { claimNext, expireSweep } = await import("@/lib/queue/claim");
    const now = new Date();
    const id = await seedCommand({
      state: "approved",
      expiresAt: new Date(now.getTime() - HOUR), // already past deadline
    });

    await expireSweep(now);

    expect(await stateOf(id)).toBe("expired");
    // A fail-closed expired row must NOT be returned by a subsequent claim.
    expect(await claimNext()).toBeNull();
  });

  it("expires pre-execution states but not future-dated rows", async () => {
    const { expireSweep } = await import("@/lib/queue/claim");
    const now = new Date();
    const stalePending = await seedCommand({
      state: "pending_approval",
      expiresAt: new Date(now.getTime() - HOUR),
    });
    const liveApproved = await seedCommand({
      state: "approved",
      expiresAt: new Date(now.getTime() + HOUR),
    });

    await expireSweep(now);

    expect(await stateOf(stalePending)).toBe("expired");
    expect(await stateOf(liveApproved)).toBe("approved");
  });
});

describe.skipIf(!DB_AVAILABLE)("reaperSweep — stale-claim rescue (D-14)", () => {
  it("releases a claimed row whose claimed_at is older than the timeout", async () => {
    const { reaperSweep } = await import("@/lib/queue/claim");
    const now = new Date();
    const timeoutMs = 5 * 60 * 1000; // 5-minute placeholder window
    const id = await seedCommand({
      state: "claimed",
      expiresAt: new Date(now.getTime() + HOUR),
      claimedAt: new Date(now.getTime() - 10 * 60 * 1000), // claimed 10 min ago → stale
    });

    await reaperSweep(now, timeoutMs);

    // Reaper rescues the orphaned claim — back to 'approved' (re-claimable) per the
    // documented release choice (state.ts permits claimed→approved for reaper release).
    expect(await stateOf(id)).toBe("approved");
  });

  it("leaves a fresh claim untouched", async () => {
    const { reaperSweep } = await import("@/lib/queue/claim");
    const now = new Date();
    const timeoutMs = 5 * 60 * 1000;
    const id = await seedCommand({
      state: "claimed",
      expiresAt: new Date(now.getTime() + HOUR),
      claimedAt: new Date(now.getTime() - 60 * 1000), // claimed 1 min ago → fresh
    });

    await reaperSweep(now, timeoutMs);

    expect(await stateOf(id)).toBe("claimed");
  });
});
