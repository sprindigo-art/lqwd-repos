// =====================================================
// Integration-suite serializer (TEST-ONLY)
// =====================================================
// Vitest runs test files in parallel forks. The QUEUE-04 integration suites
// (claim.test.ts, stub-executor.test.ts) both exercise `claimNext()`, which is
// GLOBAL by design — it claims the oldest `approved` row across ALL node_pubkeys
// (production semantics). Two suites racing the SAME shared local `nodemon` DB
// would let one suite's claim grab the other's seeded row.
//
// This helper serializes them with a Postgres SESSION-LEVEL advisory lock held
// on a RESERVED connection (so the lock survives across the suite's many
// queries). Each suite calls acquireSuiteLock() in beforeAll and releases it in
// afterAll, so they run one-at-a-time. Production code never locks — this exists
// purely to make the shared-DB integration suites deterministic.

const SUITE_LOCK_KEY = 8240604; // shared key across the queue integration suites

export interface SuiteLock {
  release: () => Promise<void>;
}

/**
 * Acquire the shared advisory lock on a dedicated (reserved) connection and
 * return a releaser. Blocks until the sibling suite (if running) releases.
 */
export async function acquireSuiteLock(): Promise<SuiteLock> {
  const { dbNodemon } = await import("@/lib/db/nodemon");
  // postgres.js: reserve() pins one connection so the session-level advisory
  // lock persists for the whole suite rather than bouncing across the pool.
  const reserved = await dbNodemon.$client.reserve();
  await reserved`SELECT pg_advisory_lock(${SUITE_LOCK_KEY})`;
  return {
    release: async () => {
      try {
        await reserved`SELECT pg_advisory_unlock(${SUITE_LOCK_KEY})`;
      } finally {
        // Return the connection to the pool.
        reserved.release();
      }
    },
  };
}
