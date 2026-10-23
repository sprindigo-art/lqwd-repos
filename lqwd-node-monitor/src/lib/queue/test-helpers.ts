import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";

// =====================================================
// QUEUE-01/03 — live-nodemon integration test fixture
// =====================================================
// The enqueue/approve suites write to the REAL local `nodemon` queue DB (the only
// Drizzle-owned RW DB, D-08). These helpers (a) load the git-ignored `.env.local`
// so `NODEMON_QUEUE_URL` resolves under vitest (vitest has no Next runtime / dotenv
// auto-load), (b) mint a per-FILE TEST pubkey + per-node HMAC secret so the sign
// path runs, and (c) clean ONLY that file's own rows between tests. PURE-of-Next,
// but DOES touch the DB — only import from integration (`*.test.ts`) suites that
// already expect a live nodemon, never from a unit test.
//
// ISOLATION (no global TRUNCATE): vitest runs test FILES in parallel by default, and
// enqueue.test.ts + approve.test.ts share ONE physical nodemon DB. A global
// `TRUNCATE` from one file would wipe rows the other just inserted (cross-file race).
// Instead each file owns a unique random pubkey and cleanup is scoped to that pubkey,
// so the two suites are fully parallel-safe against the single shared DB.

// Load `.env.local` (NODEMON_QUEUE_URL etc.) once at module import. `override:false`
// so a value already in the process env (CI secret) wins over the file.
loadEnv({ path: ".env.local", override: false });

/**
 * DB-REQUIRED SUITE GUARD (HARDEN-01, T-18-01) — the single tagging convention
 * for every suite that needs a live nodemon Postgres. Call ONCE at module top:
 *
 *   const DB_AVAILABLE = requireNodemonDb("claim.test.ts");
 *   describe.skipIf(!DB_AVAILABLE)("…", () => { … });
 *
 * and early-return from any top-level beforeAll/afterAll/beforeEach hooks when
 * `!DB_AVAILABLE`. Behavior:
 *   - CI (`process.env.CI` set) with no NODEMON_QUEUE_URL → THROWS. A DB-gated
 *     safety proof must never silently no-op in the deploy-gating pipeline; the
 *     module-load throw turns the whole vitest run red.
 *   - Local DB-less run → returns false with a VISIBLE console warning so the
 *     pure suites (canonical/sign/bounds/state/ttl/withdraw) still run green.
 *
 * The CI fail-on-skip gate (.github/workflows/ci.yml) auto-discovers DB-tagged
 * files by grepping for `requireNodemonDb(` and fails the job if ANY test in
 * such a file reports a non-executed status (skipped/todo/pending/disabled).
 * Downstream plans adding DB-integration tests MUST route through this guard —
 * that is what enrolls them in the gate.
 */
export function requireNodemonDb(suiteName: string): boolean {
  if (process.env.NODEMON_QUEUE_URL) return true;
  if (process.env.CI) {
    throw new Error(
      `[db-required] ${suiteName}: NODEMON_QUEUE_URL is unset in CI. ` +
        "DB-gated queue safety proofs MUST execute in the pipeline (HARDEN-01) — " +
        "provision the ephemeral nodemon Postgres (see .github/workflows/ci.yml).",
    );
  }
  console.warn(
    `[db-required] SKIPPING ${suiteName}: no NODEMON_QUEUE_URL in the local env ` +
      "(.env.local). The DB-integration proofs did NOT run — CI is the gate.",
  );
  return false;
}

/**
 * Mint a per-FILE TEST node pubkey — a full 66-hex compressed-secp256k1 shape
 * (02-prefix + 64 hex), matching the frozen `NODEMON_HMAC_SECRET_<pubkey>` env-key
 * suffix rule (.env.example A3). Each test file calls this ONCE at module top so its
 * rows live in a private namespace and scoped cleanup never touches a sibling file's
 * data. The 64-hex body is derived from a random 32-byte buffer.
 */
export function mkTestPubkey(): string {
  // Deterministic-shape, unique-value: 02 + 64 random hex chars.
  let body = "";
  while (body.length < 64) body += Math.floor(Math.random() * 16).toString(16);
  return "02" + body.slice(0, 64);
}

/** Any 32+ byte hex test secret — the value is irrelevant to the queue logic. */
export const TEST_HMAC_SECRET =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

/**
 * Install the per-node HMAC secret into the process env under the frozen key so
 * `signPayload(pubkey, …)` resolves it (D-12). Call in `beforeAll` with the file's
 * pubkey.
 */
export function setTestSecret(pubkey: string): void {
  process.env[`NODEMON_HMAC_SECRET_${pubkey}`] = TEST_HMAC_SECRET;
}

/** Remove the file's test secret from env. Call in `afterAll` to avoid env bleed. */
export function clearTestSecret(pubkey: string): void {
  delete process.env[`NODEMON_HMAC_SECRET_${pubkey}`];
}

/**
 * Delete ONLY the given pubkey's queue rows (commands + their audit + execution
 * rows) so the file starts each test from an empty namespace WITHOUT disturbing a
 * concurrently-running sibling file's rows. Audit/execution rows are removed first
 * (FK + the audit table has no pubkey of its own — it is reached via command_id).
 * Lazy-imports `dbNodemon` so this module never pulls the server-only DB client into
 * a pure unit test's graph (RESEARCH Pitfall 7).
 */
export async function cleanPubkeyRows(pubkey: string): Promise<void> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  await dbNodemon.execute(sql`
    DELETE FROM command_audit
     WHERE command_id IN (SELECT id FROM commands WHERE node_pubkey = ${pubkey})
  `);
  await dbNodemon.execute(sql`
    DELETE FROM command_executions
     WHERE command_id IN (SELECT id FROM commands WHERE node_pubkey = ${pubkey})
  `);
  await dbNodemon.execute(sql`DELETE FROM commands WHERE node_pubkey = ${pubkey}`);
}

/** Close the pooled nodemon connection so vitest exits cleanly (no hanging handle). */
export async function closeQueueDb(): Promise<void> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  // postgres.js client is reachable via the drizzle session; end via the raw client.
  const client = (dbNodemon as unknown as {
    $client?: { end?: (opts?: { timeout?: number }) => Promise<void> };
  }).$client;
  if (client?.end) await client.end({ timeout: 5 });
}

/**
 * Seed one `commands` row in a given state for the transition tests (approve/reject
 * operate on an existing pending_approval row). Returns the generated command id.
 * The signed-payload fields are filled with deterministic placeholders — these tests
 * exercise the STATE FLIP, not signature verification (that is sign.test.ts).
 */
export async function seedCommand(pubkey: string, state: string): Promise<string> {
  const { randomUUID } = await import("node:crypto");
  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands } = await import("@/lib/db/schema/nodemon");
  const id = randomUUID();
  await dbNodemon.insert(commands).values({
    id,
    nodePubkey: pubkey,
    actionType: "update_fee",
    params: { chanId: "1x1x1", suggestedPpm: 500 },
    canonicalPayload: `seed\n${id}\nupdate_fee\n{"suggestedPpm":500}\nseed`,
    signatureHex: "0".repeat(64),
    // The seed state may be any enum value; cast through the drizzle column type.
    state: state as never,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
  });
  return id;
}
