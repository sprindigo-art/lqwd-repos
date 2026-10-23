import { beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================
// QUEUE / D-11 + D-01 — enqueueAndApprove + withdrawCommand server actions (unit)
// =====================================================
// enqueueAndApprove collapses the two-step enqueue→approve into one deliberate
// operator gesture (Option-A) while PRESERVING the full audit trail
// ∅ → pending_approval → approved. It is explicitly NOT auto-approve-on-enqueue and
// NOT a queue bypass: it calls enqueue() (signs ONCE server-side, lands
// pending_approval) then approve(id, staleAck) (flips → approved, actor operator).
// The client sends { pubkey, params, staleAck } ONLY — never an HMAC/signature.
//
// This suite MOCKS the server-only write path (`@/lib/queue/enqueue` +
// `@/lib/queue/transitions`) so it exercises the ACTION COMPOSITION (bounds gate,
// sign-once ordering, staleAck flow, error mapping) deterministically — the live
// transactional writes are covered by enqueue.test.ts / withdraw.test.ts.

const GOOD_PUBKEY = "02" + "a".repeat(64);

const VALID_PARAMS = {
  chanId: "850000000000000000",
  channelPoint: "abcd:0",
  currentPpm: 100,
  suggestedPpm: 750,
  baseFeeMsat: 1000,
  timeLockDelta: 80,
} as const;

const NEW_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// Records the ORDER of write-path calls to prove ∅→pending→approved sequencing.
const callOrder: string[] = [];

const enqueueMock = vi.fn(async (_pubkey: string, _params: unknown) => {
  callOrder.push("enqueue");
  return NEW_ID;
});
const approveMock = vi.fn(async (_id: string, _staleAck: boolean) => {
  callOrder.push("approve");
});
const withdrawMock = vi.fn(async (_id: string) => {
  callOrder.push("withdraw");
});

vi.mock("@/lib/queue/enqueue", () => ({
  enqueue: (pubkey: string, params: unknown) => enqueueMock(pubkey, params),
}));
vi.mock("@/lib/queue/transitions", () => ({
  approve: (id: string, staleAck: boolean) => approveMock(id, staleAck),
  withdraw: (id: string) => withdrawMock(id),
}));

beforeEach(() => {
  // Clear call HISTORY only — keep the base implementations (which record callOrder
  // and resolve the happy-path values). A per-test `mockRejectedValueOnce` overrides
  // a single call without wiping the recording implementation.
  callOrder.length = 0;
  enqueueMock.mockClear();
  approveMock.mockClear();
  withdrawMock.mockClear();
});

describe("enqueueAndApprove (audit-preserving one-click enqueue+approve, D-11)", () => {
  it("calls enqueue() ONCE (signs once) then approve(id, staleAck) — landing at approved", async () => {
    const { enqueueAndApprove } = await import("@/app/actions/queue");
    const result = await enqueueAndApprove({ pubkey: GOOD_PUBKEY, params: VALID_PARAMS, staleAck: false });

    expect(result).toEqual({ ok: true, id: NEW_ID });
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    expect(enqueueMock).toHaveBeenCalledWith(GOOD_PUBKEY, VALID_PARAMS);
    expect(approveMock).toHaveBeenCalledTimes(1);
    expect(approveMock).toHaveBeenCalledWith(NEW_ID, false);
  });

  it("preserves the ∅ → pending_approval → approved audit trail (enqueue THEN approve, in order)", async () => {
    const { enqueueAndApprove } = await import("@/app/actions/queue");
    await enqueueAndApprove({ pubkey: GOOD_PUBKEY, params: VALID_PARAMS, staleAck: false });
    // enqueue writes ∅→pending_approval; approve writes pending_approval→approved.
    // Order proves this is NOT an insert-at-approved bypass.
    expect(callOrder).toEqual(["enqueue", "approve"]);
  });

  it("flows the client's staleAck into approve() (recorded as staleAcknowledged)", async () => {
    const { enqueueAndApprove } = await import("@/app/actions/queue");
    await enqueueAndApprove({ pubkey: GOOD_PUBKEY, params: VALID_PARAMS, staleAck: true });
    expect(approveMock).toHaveBeenCalledWith(NEW_ID, true);
  });

  it("re-validates params with the bounds gate: out-of-bounds ppm rejected BEFORE any signing", async () => {
    const { enqueueAndApprove } = await import("@/app/actions/queue");
    const result = await enqueueAndApprove({
      pubkey: GOOD_PUBKEY,
      params: { ...VALID_PARAMS, suggestedPpm: 99999 }, // over the 5000 ceiling
      staleAck: false,
    });
    expect(result.ok).toBe(false);
    // Rejected pre-sign: enqueue() (which signs) never ran.
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid pubkey at the server-side gate", async () => {
    const { enqueueAndApprove } = await import("@/app/actions/queue");
    const result = await enqueueAndApprove({ pubkey: "not-a-pubkey", params: VALID_PARAMS, staleAck: false });
    expect(result.ok).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("accepts { pubkey, params, staleAck } ONLY — an HMAC/signature field is rejected (never accepted client-side)", async () => {
    const { enqueueAndApprove } = await import("@/app/actions/queue");
    // Attempt to smuggle a client-supplied signature: the strict schema rejects it.
    const result = await enqueueAndApprove({
      pubkey: GOOD_PUBKEY,
      params: VALID_PARAMS,
      staleAck: false,
      signatureHex: "deadbeef",
    } as never);
    expect(result.ok).toBe(false);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("maps an approve() lost-race throw to the transition error copy", async () => {
    approveMock.mockRejectedValueOnce(new Error("THIS COMMAND IS NO LONGER PENDING APPROVAL"));
    const { enqueueAndApprove } = await import("@/app/actions/queue");
    const result = await enqueueAndApprove({ pubkey: GOOD_PUBKEY, params: VALID_PARAMS, staleAck: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no longer pending approval/i);
  });
});

describe("withdrawCommand (D-01 operator undo action)", () => {
  it("calls withdraw(id) and returns ok on success", async () => {
    const { withdrawCommand } = await import("@/app/actions/queue");
    const result = await withdrawCommand({ id: NEW_ID });
    expect(result).toEqual({ ok: true });
    expect(withdrawMock).toHaveBeenCalledWith(NEW_ID);
  });

  it("maps a thrown already-claimed lost-race to transitionErrorCopy", async () => {
    withdrawMock.mockRejectedValueOnce(
      new Error("THIS APPROVED INTENT WAS ALREADY CLAIMED — too late to withdraw"),
    );
    const { withdrawCommand } = await import("@/app/actions/queue");
    const result = await withdrawCommand({ id: NEW_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/already claimed/i);
  });

  it("rejects a non-uuid id at the input gate", async () => {
    const { withdrawCommand } = await import("@/app/actions/queue");
    const result = await withdrawCommand({ id: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(withdrawMock).not.toHaveBeenCalled();
  });
});
