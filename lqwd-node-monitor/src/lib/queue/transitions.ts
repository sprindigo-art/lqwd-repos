import "server-only";

import { and, eq } from "drizzle-orm";

import { canTransition } from "@/lib/queue/state";

// =====================================================
// QUEUE-03 — server-only approve/reject transitions (guarded flip + audit)
// =====================================================
// The operator decision step. Each transition is one `dbNodemon.transaction`:
//   UPDATE commands SET state=<to> WHERE id=? AND state='pending_approval'
//     RETURNING id           ← the lost-update guard (T-06-08); 0 rows ⇒ throw
//   INSERT command_audit{ from, to, actor, … }   ← no flip without a trail (T-06-09)
// The `WHERE state='pending_approval'` predicate makes the flip idempotent: a second
// approve/reject (already-flipped, or another tab won the race) updates 0 rows and
// throws the "no longer pending" error. approve records the D-10 stale-ack; reject
// captures the optional D-07 free-text reason as DATA only (never an HTML sink, V5).
//
// server-only + LAZY DB import (Pitfall 7) — `dbNodemon` resolved inside each fn.

// The single source state every operator transition legally departs from (D-08).
const FROM_STATE = "pending_approval" as const;

// UI-SPEC error copy surfaced when the guarded UPDATE matches zero rows — the row
// was already approved/rejected/expired or claimed by a concurrent operator.
const LOST_RACE_ERROR = "THIS COMMAND IS NO LONGER PENDING APPROVAL";

// withdraw() has its OWN lost-race copy (interfaces §caveat): the failure mode is
// "the node already claimed this approved intent", not "no longer pending". Contains
// the "ALREADY CLAIMED" marker that transitionErrorCopy() maps to the D-01 clean-race
// copy. withdraw departs from "approved" — NOT the module FROM_STATE.
const WITHDRAW_CLAIMED_ERROR = "THIS APPROVED INTENT WAS ALREADY CLAIMED — too late to withdraw";

/**
 * Approve a pending command (QUEUE-03). Flips `pending_approval → approved` only;
 * `staleAck` records the operator's D-10 acknowledgement (true when they overrode
 * the stale-data gate) into the audit row. Throws `LOST_RACE_ERROR` if the row is no
 * longer pending (zero rows updated — the lost-race guard, T-06-08).
 */
export async function approve(id: string, staleAck: boolean): Promise<void> {
  // Defense in depth: the legal edge is pinned in the pure transition table too.
  if (!canTransition(FROM_STATE, "approved")) {
    throw new Error("illegal transition: pending_approval → approved");
  }

  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  await dbNodemon.transaction(async (tx) => {
    const updated = await tx
      .update(commands)
      .set({ state: "approved" })
      .where(and(eq(commands.id, id), eq(commands.state, FROM_STATE)))
      .returning({ id: commands.id });
    if (updated.length === 0) throw new Error(LOST_RACE_ERROR);

    await tx.insert(commandAudit).values({
      commandId: id,
      fromState: FROM_STATE,
      toState: "approved",
      actor: "operator",
      staleAcknowledged: staleAck, // D-10 — recorded into the trail
    });
  });
}

/**
 * Reject a pending command (QUEUE-03, terminal). Flips `pending_approval → rejected`
 * only; `reason` (optional, D-07) is captured into the audit row as free text when
 * provided — stored/rendered as DATA, never an HTML/markdown sink (V5). Throws
 * `LOST_RACE_ERROR` if the row is no longer pending (lost-race guard).
 */
export async function reject(id: string, reason?: string): Promise<void> {
  if (!canTransition(FROM_STATE, "rejected")) {
    throw new Error("illegal transition: pending_approval → rejected");
  }

  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  await dbNodemon.transaction(async (tx) => {
    const updated = await tx
      .update(commands)
      .set({ state: "rejected" })
      .where(and(eq(commands.id, id), eq(commands.state, FROM_STATE)))
      .returning({ id: commands.id });
    if (updated.length === 0) throw new Error(LOST_RACE_ERROR);

    await tx.insert(commandAudit).values({
      commandId: id,
      fromState: FROM_STATE,
      toState: "rejected",
      actor: "operator",
      reason: reason ?? null, // D-07 — optional, null when omitted
    });
  });
}

/**
 * Withdraw an approved-but-unclaimed command (D-01, terminal). The operator undo
 * for the minutes-long approved window BEFORE the node claims it. Flips
 * `approved → withdrawn` ONLY — it departs from the literal `"approved"`, NOT the
 * module `FROM_STATE` ('pending_approval'). The `WHERE state='approved'` predicate
 * IS the claim-race safety (D-02): if the node already claimed the row
 * (`approved → claimed`), zero rows match and this throws the "already claimed"
 * lost-race error, so a withdraw can never race an in-flight node claim.
 */
export async function withdraw(id: string): Promise<void> {
  // Defense in depth: the legal edge is pinned in the pure transition table too.
  if (!canTransition("approved", "withdrawn")) {
    throw new Error("illegal transition: approved → withdrawn");
  }

  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  await dbNodemon.transaction(async (tx) => {
    const updated = await tx
      .update(commands)
      .set({ state: "withdrawn" })
      .where(and(eq(commands.id, id), eq(commands.state, "approved"))) // claim-race safety (D-02)
      .returning({ id: commands.id });
    if (updated.length === 0) throw new Error(WITHDRAW_CLAIMED_ERROR);

    await tx.insert(commandAudit).values({
      commandId: id,
      fromState: "approved",
      toState: "withdrawn",
      actor: "operator",
    });
  });
}
