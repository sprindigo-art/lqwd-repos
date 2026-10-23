import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// =====================================================
// QUEUE / D-01+D-02 — withdraw() guarded approved → withdrawn (pure/DB-free)
// =====================================================
// withdraw() is the operator undo for the minutes-long approved-but-unclaimed
// window. Like approve()/reject() it is one `dbNodemon.transaction`:
//   UPDATE commands SET state='withdrawn' WHERE id=? AND state='approved' RETURNING id
//     ← the claim-race guard (D-02); 0 rows ⇒ throw "already claimed"
//   INSERT command_audit{ from:'approved', to:'withdrawn', actor:'operator' }
// This suite is DB-FREE: it MOCKS the tx layer (`@/lib/db/nodemon`) and drives the
// guarded UPDATE's `.returning()` to 1 row (success) or 0 rows (already claimed),
// so it exercises the flip/guard/audit logic without a live nodemon. It spies the
// real drizzle `eq` to PROVE the predicate departs from 'approved' (NOT the module
// FROM_STATE 'pending_approval'), and mocks `canTransition` to prove the
// defense-in-depth guard.

// ── mocks ────────────────────────────────────────────────────────────────────

// Defense-in-depth guard: mutable so one test can flip it false.
let canTransitionResult = true;
vi.mock("@/lib/queue/state", () => ({
  canTransition: () => canTransitionResult,
}));

// Spy the real drizzle `eq` (keep every other export) to record the column/value
// pairs the guarded UPDATE builds — this is how we prove state='approved'.
const eqCalls: Array<[unknown, unknown]> = [];
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      eqCalls.push([col, val]);
      return actual.eq(col as never, val as never);
    },
  };
});

// The guarded UPDATE's returned rows — [] simulates an already-claimed row.
let returningRows: Array<{ id: string }> = [];

// Captured writes from inside the transaction.
let capturedSetVals: unknown;
let capturedAuditVals: Record<string, unknown> | undefined;

const transactionMock = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
  const tx = {
    update: () => ({
      set: (vals: unknown) => {
        capturedSetVals = vals;
        return {
          where: () => ({
            returning: async () => returningRows,
          }),
        };
      },
    }),
    insert: () => ({
      values: async (vals: Record<string, unknown>) => {
        capturedAuditVals = vals;
      },
    }),
  };
  return cb(tx);
});

vi.mock("@/lib/db/nodemon", () => ({
  dbNodemon: {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => transactionMock(cb),
  },
}));

const ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  canTransitionResult = true;
  returningRows = [{ id: ID }];
  capturedSetVals = undefined;
  capturedAuditVals = undefined;
  eqCalls.length = 0;
  transactionMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withdraw (guarded approved → withdrawn + audit)", () => {
  it("flips approved → withdrawn: sets state, guarded UPDATE returns a row", async () => {
    const { withdraw } = await import("@/lib/queue/transitions");
    await expect(withdraw(ID)).resolves.toBeUndefined();
    expect(capturedSetVals).toEqual({ state: "withdrawn" });
  });

  it("guards the UPDATE on state='approved' — NOT the module FROM_STATE 'pending_approval' (D-02)", async () => {
    const { withdraw } = await import("@/lib/queue/transitions");
    await withdraw(ID);

    // The guarded predicate compared state to 'approved' …
    expect(eqCalls.some(([, val]) => val === "approved")).toBe(true);
    // … and NEVER to 'pending_approval' (that is approve()/reject()'s from-state).
    expect(eqCalls.some(([, val]) => val === "pending_approval")).toBe(false);
    // … and pinned the id.
    expect(eqCalls.some(([, val]) => val === ID)).toBe(true);
  });

  it("writes a command_audit row { from:'approved', to:'withdrawn', actor:'operator' }", async () => {
    const { withdraw } = await import("@/lib/queue/transitions");
    await withdraw(ID);
    expect(capturedAuditVals).toMatchObject({
      commandId: ID,
      fromState: "approved",
      toState: "withdrawn",
      actor: "operator",
    });
  });

  it("throws the already-claimed lost-race error when the guarded UPDATE matches 0 rows (D-02)", async () => {
    returningRows = []; // node already claimed the approved row
    const { withdraw } = await import("@/lib/queue/transitions");
    await expect(withdraw(ID)).rejects.toThrow(/already claimed/i);
    // No audit row is written on a lost race.
    expect(capturedAuditVals).toBeUndefined();
  });

  it("defense-in-depth: throws an illegal-transition error if canTransition('approved','withdrawn') is false", async () => {
    canTransitionResult = false;
    const { withdraw } = await import("@/lib/queue/transitions");
    await expect(withdraw(ID)).rejects.toThrow(/illegal transition/i);
    // The guard trips BEFORE any DB work.
    expect(transactionMock).not.toHaveBeenCalled();
  });
});
