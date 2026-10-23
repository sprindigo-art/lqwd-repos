import "server-only";

// =====================================================
// QUEUE-04 — TEST-ONLY stub executor (claimed→executing→succeeded|failed)
// =====================================================
// D-13 CONSTRAINT — TEST-SUITE ONLY. This driver advances the post-approval
// states in Phase 6 (the real on-node executor does so in Phase 7). There is
// deliberately NO operator "simulate" control and NO UI mount anywhere in the
// app — a throwaway "simulate execution" button was explicitly REJECTED
// (RESEARCH Anti-Patterns / Deferred Ideas, T-06-16). The plan's grep gate
// proves no `src/app` / `src/components` import of this module.
//
// runStubExecutor(outcome): claim one approved row (claimNext — the same atomic
// FOR UPDATE SKIP LOCKED primitive), then flip claimed→executing→outcome via
// guarded transactional flips (`UPDATE … WHERE id=? AND state=<expected>`) each
// paired with a command_audit row, and INSERT one command_executions row. The
// guard makes each flip idempotent and surfaces a lost race as a no-op.

import { and, eq, sql } from "drizzle-orm";
import { claimNext } from "@/lib/queue/claim";

type Outcome = "succeeded" | "failed";

/**
 * Drive one approved command through the post-approval state chain. Returns the
 * claimed command `{ id }`, or `null` when there is no approved row to claim.
 *
 * TEST-ONLY (D-13) — never mounted in the UI; no operator simulate control.
 */
export async function runStubExecutor(outcome: Outcome): Promise<{ id: string } | null> {
  const claimed = await claimNext();
  if (!claimed) return null;

  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit, commandExecutions } = await import("@/lib/db/schema/nodemon");
  const { id } = claimed;

  // claimed → executing (guarded flip + audit).
  await dbNodemon.transaction(async (tx) => {
    await tx
      .update(commands)
      .set({ state: "executing" })
      .where(and(eq(commands.id, id), eq(commands.state, "claimed")));
    await tx.insert(commandAudit).values({
      commandId: id,
      fromState: "claimed",
      toState: "executing",
      actor: "executor",
    });
  });

  // executing → outcome (guarded flip + audit) AND the execution row, atomically.
  await dbNodemon.transaction(async (tx) => {
    await tx
      .update(commands)
      .set({ state: outcome })
      .where(and(eq(commands.id, id), eq(commands.state, "executing")));
    await tx.insert(commandAudit).values({
      commandId: id,
      fromState: "executing",
      toState: outcome,
      actor: "executor",
    });
    await tx.insert(commandExecutions).values({
      commandId: id,
      outcome,
      detail: `stub-executor: ${outcome}`,
      executedAt: sql`now()`,
    });
  });

  return { id };
}
