"use server";

import { z } from "zod";

import { updateFeeBoundsSchema, type UpdateFeeParams } from "@/lib/queue/bounds";

// =====================================================
// queue — QUEUE-01 / QUEUE-03 server actions (no public API route surface)
// =====================================================
// The ONLY way the UI writes to / flips the command queue. Defense in depth
// (T-06-17/T-06-18/T-06-20), mirroring narrate.ts:
//   - the client NEVER supplies the HMAC signature or canonical payload — it
//     sends params only; the server recomputes EVERYTHING (CLAUDE.md §5);
//   - enqueueCommand re-validates params with updateFeeBoundsSchema server-side
//     as the authoritative bounds gate (EnqueuePreview's client clamp is UX only);
//   - the pubkey is checked against the 66-hex regex before any use;
//   - the server-only queue modules (enqueue.ts / transitions.ts spin warehouse
//     pools + read the per-node secret at module load) are LAZY-imported INSIDE
//     each action, so a pure caller that merely references this module never
//     pulls the signer/DB into its import graph (narrate.ts precedent, D-12).
//   - the secret is NEVER logged (V7); thrown errors map to UI-SPEC copy.

/** Same pubkey gate as narrate.ts / the console page / buildDeepLink. */
const PUBKEY_RE = /^[0-9a-f]{66}$/;

/** Narrate.ts result shape, specialized for the enqueue write (returns the id). */
export type EnqueueResult = { ok: true; id: string } | { ok: false; error: string };

/** Narrate.ts result shape for the approve/reject flips (no payload on success). */
export type TransitionResult = { ok: true } | { ok: false; error: string };

// UI-SPEC Copywriting Contract error copy (src/.../06-UI-SPEC.md).
const MISSING_SECRET_HINT = "NO SIGNING SECRET FOR THIS NODE";
const LOST_RACE_MARKER = "NO LONGER PENDING APPROVAL";
const LOST_RACE_COPY =
  "THIS COMMAND IS NO LONGER PENDING APPROVAL — it was already approved, rejected, or expired. Reload the queue.";
// withdraw()'s clean-race copy (D-01/D-02): the node claimed the approved intent
// before the operator could pull it. Keyed off the "ALREADY CLAIMED" marker.
const CLAIMED_RACE_MARKER = "ALREADY CLAIMED";
const CLAIMED_RACE_COPY =
  "TOO LATE, ALREADY CLAIMED — the node picked up this approved fee intent before you could withdraw it. Reload the queue.";

/**
 * Map a thrown enqueue error to the UI-SPEC copy. The missing-per-node-secret
 * case gets its own actionable line (the signer throws when the env var is
 * absent); everything else is the generic "could not queue" shape. The raw
 * message is surfaced as {reason} but the secret bytes are never in it (V7).
 */
function enqueueErrorCopy(message: string): string {
  if (message.includes(MISSING_SECRET_HINT) || /signing secret|hmac secret/i.test(message)) {
    return "NO SIGNING SECRET FOR THIS NODE — set NODEMON_HMAC_SECRET_<pubkey> and retry. The intent was not queued.";
  }
  return `COULD NOT QUEUE — ${message}. Nothing was written. Try again, or check the node's HMAC secret is configured.`;
}

/** A guarded transition that matched zero rows ⇒ the row is no longer pending. */
function transitionErrorCopy(message: string): string {
  if (message.includes(LOST_RACE_MARKER)) return LOST_RACE_COPY;
  if (message.includes(CLAIMED_RACE_MARKER)) return CLAIMED_RACE_COPY;
  return `COULD NOT UPDATE — ${message}. Reload the queue.`;
}

// ── enqueue ────────────────────────────────────────────────────────────────

/** Input contract: pubkey (66-hex) + the bounds-validated update_fee params. */
const enqueueInputSchema = z
  .object({
    pubkey: z.string().regex(PUBKEY_RE, "invalid pubkey (expected 66 lowercase hex characters)"),
    params: updateFeeBoundsSchema,
  })
  .strict();

export type EnqueueInput = { pubkey: string; params: UpdateFeeParams };

/**
 * QUEUE-01 — enqueue an `update_fee` intent as a `pending_approval` row.
 * Re-validates params server-side (authoritative bounds gate); the client never
 * supplies a signature/canonicalPayload — enqueue.ts signs ONCE server-side.
 */
export async function enqueueCommand(input: EnqueueInput): Promise<EnqueueResult> {
  const parsed = enqueueInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: enqueueErrorCopy(parsed.error.issues[0]?.message ?? "invalid input") };
  }
  try {
    // Lazy server-only import: keeps the signer + DB pool out of any caller's graph.
    const { enqueue } = await import("@/lib/queue/enqueue");
    const id = await enqueue(parsed.data.pubkey, parsed.data.params);
    return { ok: true, id };
  } catch (error) {
    // Never log the secret (V7); the message itself carries no secret bytes.
    console.error("enqueueCommand failed");
    return { ok: false, error: enqueueErrorCopy(error instanceof Error ? error.message : String(error)) };
  }
}

// ── enqueueAndApprove (D-11 — one-click enqueue+approve, audit-preserving) ────

/** Input contract: enqueue input + a staleAck boolean (mirrors approveInputSchema). */
const enqueueAndApproveInputSchema = z
  .object({
    pubkey: z.string().regex(PUBKEY_RE, "invalid pubkey (expected 66 lowercase hex characters)"),
    params: updateFeeBoundsSchema,
    staleAck: z.boolean(),
  })
  .strict();

export type EnqueueAndApproveInput = { pubkey: string; params: UpdateFeeParams; staleAck: boolean };

/**
 * D-11 — collapse enqueue→approve into ONE deliberate operator gesture (Option-A)
 * while PRESERVING the full audit trail `∅ → pending_approval → approved`. It is
 * explicitly NOT auto-approve-on-enqueue and NOT a queue bypass: it calls enqueue()
 * (signs ONCE server-side, lands `pending_approval`) then approve(id, staleAck)
 * (flips → approved, actor operator, staleAck audited). The client sends
 * { pubkey, params, staleAck } ONLY — never an HMAC/signature (the strict schema
 * rejects extra fields); the server recomputes everything. Params are re-validated
 * by the SAME authoritative bounds gate BEFORE any signing. Returns the new id.
 */
export async function enqueueAndApprove(input: EnqueueAndApproveInput): Promise<EnqueueResult> {
  const parsed = enqueueAndApproveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: enqueueErrorCopy(parsed.error.issues[0]?.message ?? "invalid input") };
  }
  try {
    // Lazy server-only imports: keep the signer + DB pool out of any caller's graph.
    const { enqueue } = await import("@/lib/queue/enqueue");
    const { approve } = await import("@/lib/queue/transitions");
    const id = await enqueue(parsed.data.pubkey, parsed.data.params); // signs once → pending_approval
    await approve(id, parsed.data.staleAck); // → approved; audit trail ∅→pending→approved preserved
    return { ok: true, id };
  } catch (error) {
    // Never log the secret (V7); the message itself carries no secret bytes.
    console.error("enqueueAndApprove failed");
    const message = error instanceof Error ? error.message : String(error);
    // An approve() lost-race gets the transition copy; an enqueue/sign failure the enqueue copy.
    if (message.includes(LOST_RACE_MARKER)) return { ok: false, error: transitionErrorCopy(message) };
    return { ok: false, error: enqueueErrorCopy(message) };
  }
}

// ── enqueueBatch (INBOX-04 — bulk best-effort) ───────────────────────────────

/** One row's outcome in a bulk enqueue: the id on success, the verbatim copy on skip. */
export type BatchRowResult =
  | { ok: true; id: string; pubkey: string; chanId: string }
  | { ok: false; pubkey: string; chanId: string; error: string };

/** Best-effort tally over a bulk enqueue: per-row results + queued/skipped counts. */
export type EnqueueBatchResult = { results: BatchRowResult[]; queued: number; skipped: number };

/**
 * INBOX-04 — bulk-enqueue: loop the EXISTING per-row enqueue() once per intent,
 * each in its OWN transaction, collecting a best-effort { ok | error } tally (D-07).
 *
 * No outer transaction wraps the loop (Pitfall 1) — enqueue() is already per-row
 * transactional, so one bad row leaves every good write durable. Each row is
 * re-validated with the SAME enqueueInputSchema (authoritative bounds gate) before
 * signing, and the per-row error reuses enqueueErrorCopy verbatim so the missing-
 * secret / lost-race copy is byte-identical to the single-card path. The UI sends
 * `{pubkey, params}[]` ONLY — never a signature/canonicalPayload; enqueue() signs
 * ONCE per row server-side (CLAUDE.md §5). The secret is never logged (V7).
 */
export async function enqueueBatch(inputs: EnqueueInput[]): Promise<EnqueueBatchResult> {
  const results: BatchRowResult[] = [];
  for (const input of inputs) {
    const parsed = enqueueInputSchema.safeParse(input); // authoritative bounds gate, per row
    if (!parsed.success) {
      results.push({
        ok: false,
        pubkey: input.pubkey,
        chanId: input.params?.chanId ?? "(unknown channel)",
        error: enqueueErrorCopy(parsed.error.issues[0]?.message ?? "invalid input"),
      });
      continue;
    }
    try {
      // Lazy server-only import inside the loop: own tx; signs once per row.
      const { enqueue } = await import("@/lib/queue/enqueue");
      const id = await enqueue(parsed.data.pubkey, parsed.data.params);
      results.push({ ok: true, id, pubkey: parsed.data.pubkey, chanId: parsed.data.params.chanId });
    } catch (error) {
      // Never log the secret (V7); the message itself carries no secret bytes.
      console.error("enqueueBatch row failed");
      results.push({
        ok: false,
        pubkey: input.pubkey,
        chanId: input.params?.chanId ?? "(unknown channel)",
        error: enqueueErrorCopy(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  const queued = results.filter((r) => r.ok).length;
  return { results, queued, skipped: results.length - queued };
}

// ── approve ────────────────────────────────────────────────────────────────

const approveInputSchema = z
  .object({ id: z.string().uuid(), staleAck: z.boolean() })
  .strict();

export type ApproveInput = { id: string; staleAck: boolean };

/**
 * QUEUE-03 — approve a pending command (`pending_approval → approved`).
 * `staleAck` (D-10) is recorded to the audit row. A lost race (zero rows
 * updated) surfaces the UI-SPEC "no longer pending" copy.
 */
export async function approveCommand(input: ApproveInput): Promise<TransitionResult> {
  const parsed = approveInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `COULD NOT UPDATE — ${parsed.error.issues[0]?.message ?? "invalid input"}.` };
  }
  try {
    const { approve } = await import("@/lib/queue/transitions");
    await approve(parsed.data.id, parsed.data.staleAck);
    return { ok: true };
  } catch (error) {
    console.error("approveCommand failed");
    return { ok: false, error: transitionErrorCopy(error instanceof Error ? error.message : String(error)) };
  }
}

// ── reject ─────────────────────────────────────────────────────────────────

const rejectInputSchema = z
  .object({ id: z.string().uuid(), reason: z.string().optional() })
  .strict();

export type RejectInput = { id: string; reason?: string };

/**
 * QUEUE-03 — reject a pending command (`pending_approval → rejected`, terminal).
 * The optional D-07 `reason` is captured to audit as DATA only (never an HTML
 * sink, V5). A lost race surfaces the UI-SPEC "no longer pending" copy.
 */
export async function rejectCommand(input: RejectInput): Promise<TransitionResult> {
  const parsed = rejectInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `COULD NOT UPDATE — ${parsed.error.issues[0]?.message ?? "invalid input"}.` };
  }
  try {
    const { reject } = await import("@/lib/queue/transitions");
    await reject(parsed.data.id, parsed.data.reason);
    return { ok: true };
  } catch (error) {
    console.error("rejectCommand failed");
    return { ok: false, error: transitionErrorCopy(error instanceof Error ? error.message : String(error)) };
  }
}

// ── withdraw (D-01 — operator undo of an approved-but-unclaimed intent) ───────

const withdrawInputSchema = z.object({ id: z.string().uuid() }).strict();

export type WithdrawInput = { id: string };

/**
 * D-01 — withdraw an approved-but-unclaimed command (`approved → withdrawn`,
 * terminal). Mirrors approveCommand: the client sends `{ id }` ONLY (never a
 * signature). Calls the guarded withdraw() transition, whose `WHERE state='approved'`
 * predicate is the claim-race safety (D-02) — if the node already claimed the row,
 * withdraw() throws and this surfaces the "too late, already claimed" UI-SPEC copy.
 */
export async function withdrawCommand(input: WithdrawInput): Promise<TransitionResult> {
  const parsed = withdrawInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: `COULD NOT UPDATE — ${parsed.error.issues[0]?.message ?? "invalid input"}.` };
  }
  try {
    const { withdraw } = await import("@/lib/queue/transitions");
    await withdraw(parsed.data.id);
    return { ok: true };
  } catch (error) {
    console.error("withdrawCommand failed");
    return { ok: false, error: transitionErrorCopy(error instanceof Error ? error.message : String(error)) };
  }
}
