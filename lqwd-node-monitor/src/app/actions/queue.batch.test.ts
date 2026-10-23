import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EnqueueInput } from "@/app/actions/queue";

// =====================================================
// INBOX-04 — enqueueBatch best-effort tally + no-rollback (unit)
// =====================================================
// Proves the BATCH ORCHESTRATION contract (D-07): enqueueBatch loops the existing
// per-row enqueue() once per intent, each in its own try/catch, and collects a
// best-effort { ok | error } tally. We MOCK `@/lib/queue/enqueue`'s `enqueue` so
// the test exercises the loop/tally/skip semantics deterministically — the live
// transactional write path is already covered by enqueue.test.ts. The mock
// resolves an id for good rows and THROWS a missing-secret error for the
// secret-less node, mirroring what sign.ts throws when NODEMON_HMAC_SECRET_<pubkey>
// is absent. Asserts: verbatim missing-secret skip alongside good queued rows,
// queued/skipped correctness, an invalid-params row rejected by the per-row bounds
// gate without aborting the batch, and that one bad row never drops a sibling
// (best-effort, no outer rollback).

// A full 66-hex compressed-pubkey shape (02 + 64 hex), like the live fixture mints.
const GOOD_PUBKEY_A = "02" + "a".repeat(64);
const GOOD_PUBKEY_B = "02" + "b".repeat(64);
const SECRETLESS_PUBKEY = "02" + "c".repeat(64);

// The verbatim string sign.ts surfaces when the per-node secret env var is missing.
const MISSING_SECRET_THROWN = "NO SIGNING SECRET FOR THIS NODE";

const VALID_PARAMS = {
  chanId: "850000000000000000",
  channelPoint: "abcd:0",
  currentPpm: 100,
  suggestedPpm: 750,
  baseFeeMsat: 1000,
  timeLockDelta: 80,
} as const;

// Mock the per-row write path. enqueueBatch lazy-imports this INSIDE the loop, so
// the factory must provide `enqueue`. Good pubkeys resolve a deterministic id;
// the secret-less pubkey throws the missing-secret error (what sign.ts does).
const enqueueMock = vi.fn(async (pubkey: string, _params: unknown) => {
  if (pubkey === SECRETLESS_PUBKEY) {
    throw new Error(MISSING_SECRET_THROWN);
  }
  return `id-${pubkey.slice(0, 6)}`;
});

vi.mock("@/lib/queue/enqueue", () => ({
  enqueue: (pubkey: string, params: unknown) => enqueueMock(pubkey, params),
}));

beforeEach(() => {
  enqueueMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueBatch (best-effort tally, no outer rollback)", () => {
  it("queues good rows while a secret-less row is skipped with the verbatim missing-secret copy", async () => {
    const { enqueueBatch } = await import("@/app/actions/queue");
    const inputs: EnqueueInput[] = [
      { pubkey: GOOD_PUBKEY_A, params: { ...VALID_PARAMS, chanId: "111" } },
      { pubkey: SECRETLESS_PUBKEY, params: { ...VALID_PARAMS, chanId: "222" } },
      { pubkey: GOOD_PUBKEY_B, params: { ...VALID_PARAMS, chanId: "333" } },
    ];

    const result = await enqueueBatch(inputs);

    // Best-effort tally: good rows queued, secret-less row skipped — sibling good
    // rows are NOT dropped by the one bad row (no outer rollback).
    expect(result.results).toHaveLength(3);

    const rowA = result.results[0];
    const rowBad = result.results[1];
    const rowB = result.results[2];

    expect(rowA).toMatchObject({ ok: true, pubkey: GOOD_PUBKEY_A, chanId: "111" });
    expect(rowB).toMatchObject({ ok: true, pubkey: GOOD_PUBKEY_B, chanId: "333" });
    if (rowA.ok) expect(rowA.id).toBe("id-02aaaa");
    if (rowB.ok) expect(rowB.id).toBe("id-02bbbb");

    expect(rowBad.ok).toBe(false);
    expect(rowBad.pubkey).toBe(SECRETLESS_PUBKEY);
    expect(rowBad.chanId).toBe("222");
    if (!rowBad.ok) {
      // The verbatim UI-SPEC missing-secret copy (enqueueErrorCopy mapping).
      expect(rowBad.error).toBe(
        "NO SIGNING SECRET FOR THIS NODE — set NODEMON_HMAC_SECRET_<pubkey> and retry. The intent was not queued.",
      );
    }
  });

  it("tallies queued/skipped correctly; queued + skipped === results.length", async () => {
    const { enqueueBatch } = await import("@/app/actions/queue");
    const inputs: EnqueueInput[] = [
      { pubkey: GOOD_PUBKEY_A, params: { ...VALID_PARAMS, chanId: "111" } },
      { pubkey: SECRETLESS_PUBKEY, params: { ...VALID_PARAMS, chanId: "222" } },
      { pubkey: GOOD_PUBKEY_B, params: { ...VALID_PARAMS, chanId: "333" } },
    ];

    const result = await enqueueBatch(inputs);

    expect(result.queued).toBe(2); // only the ok rows
    expect(result.skipped).toBe(1);
    expect(result.queued + result.skipped).toBe(result.results.length);
  });

  it("rejects an invalid-params row at the per-row bounds gate WITHOUT aborting the batch", async () => {
    const { enqueueBatch } = await import("@/app/actions/queue");
    const inputs: EnqueueInput[] = [
      { pubkey: GOOD_PUBKEY_A, params: { ...VALID_PARAMS, chanId: "111" } },
      // suggestedPpm 99999 is over the bounds ceiling (5000) — server-side gate rejects.
      { pubkey: GOOD_PUBKEY_B, params: { ...VALID_PARAMS, chanId: "222", suggestedPpm: 99999 } },
    ];

    const result = await enqueueBatch(inputs);

    expect(result.results).toHaveLength(2);
    expect(result.results[0].ok).toBe(true); // good row still queued
    expect(result.results[1].ok).toBe(false); // bounds-rejected row
    expect(result.queued).toBe(1);
    expect(result.skipped).toBe(1);

    // The bounds-rejected row never reached enqueue() (rejected pre-sign).
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(GOOD_PUBKEY_A, expect.anything());
  });

  it("rejects an invalid pubkey at the per-row gate (66-hex) without aborting siblings", async () => {
    const { enqueueBatch } = await import("@/app/actions/queue");
    const inputs: EnqueueInput[] = [
      { pubkey: "not-a-pubkey", params: { ...VALID_PARAMS, chanId: "111" } },
      { pubkey: GOOD_PUBKEY_A, params: { ...VALID_PARAMS, chanId: "222" } },
    ];

    const result = await enqueueBatch(inputs);

    expect(result.results[0].ok).toBe(false);
    expect(result.results[0].pubkey).toBe("not-a-pubkey");
    expect(result.results[1].ok).toBe(true);
    expect(result.queued).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("never wraps the loop in an outer transaction — good writes are durable on partial failure", async () => {
    // The mock proves each call is independent: the secret-less throw in the
    // middle does not prevent the subsequent good row from being enqueued.
    const { enqueueBatch } = await import("@/app/actions/queue");
    const inputs: EnqueueInput[] = [
      { pubkey: SECRETLESS_PUBKEY, params: { ...VALID_PARAMS, chanId: "111" } },
      { pubkey: GOOD_PUBKEY_A, params: { ...VALID_PARAMS, chanId: "222" } },
    ];

    const result = await enqueueBatch(inputs);

    // Bad row first, good row after — the good row still committed (independent tx).
    expect(result.results[0].ok).toBe(false);
    expect(result.results[1].ok).toBe(true);
    expect(enqueueMock).toHaveBeenCalledTimes(2); // both rows attempted independently
  });

  it("returns an empty tally for an empty batch", async () => {
    const { enqueueBatch } = await import("@/app/actions/queue");
    const result = await enqueueBatch([]);
    expect(result.results).toHaveLength(0);
    expect(result.queued).toBe(0);
    expect(result.skipped).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});
