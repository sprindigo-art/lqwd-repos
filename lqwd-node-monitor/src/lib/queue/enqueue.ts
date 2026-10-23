import "server-only";

import { randomUUID } from "node:crypto";

import { buildSignedPayload, canonicalize } from "@/lib/queue/canonical";
import { signPayload } from "@/lib/queue/sign";
import { ttlHours } from "@/lib/queue/ttl";
import type { UpdateFeeParams } from "@/lib/queue/bounds";

// =====================================================
// QUEUE-01 / D-04 — server-only transactional enqueue (sign once, write atomically)
// =====================================================
// The operator half of the lifecycle's first step. On CONFIRM ENQUEUE the server
// (NEVER the client — narrate.ts precedent, CLAUDE.md §5) generates the signed id +
// expires_at, signs ONCE over the canonical payload, and writes the command + its
// initial audit row in ONE transaction. Params + expires_at are immutable from here;
// approval merely flips state (D-04). The signature is the cross-phase freeze the
// Phase 7 bash verifier reproduces over the verbatim canonical_payload string.
//
// server-only + LAZY DB import (latest.ts/narrate.ts precedent, RESEARCH Pitfall 7):
// `dbNodemon` is imported INSIDE the function so a pure caller never spins a pool.

// D-11 — TTL is config-tunable (default 24h) via the shared validated reader in
// ttl.ts (WR-04): read at call time, bad env falls back to the default.

/**
 * Enqueue an `update_fee` intent as a `pending_approval` command (QUEUE-01).
 *
 * Generates `command_id` + `expires_at` app-side BEFORE signing (Pitfall 2 — the id
 * and deadline are part of the signed payload, so they must be fixed first; NEVER a
 * DB `gen_random_uuid()` default on the signed id). Stores the EXACT canonical signed
 * string verbatim (CLAUDE.md §4 — never re-serialized). Returns the command id.
 */
export async function enqueue(pubkey: string, params: UpdateFeeParams): Promise<string> {
  const commandId = randomUUID();
  // expires_at fixed BEFORE signing (D-11). A Date for the timestamptz column; its
  // ISO form is what feeds the signed payload so Phase 7 hashes the identical bytes.
  const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
  const canonicalParams = canonicalize(params);
  const payload = buildSignedPayload({
    nodePubkey: pubkey,
    commandId,
    actionType: "update_fee",
    canonicalParams,
    expiresAt: expiresAt.toISOString(),
  });
  const signatureHex = signPayload(pubkey, payload);

  const { dbNodemon } = await import("@/lib/db/nodemon");
  const { commands, commandAudit } = await import("@/lib/db/schema/nodemon");

  return dbNodemon.transaction(async (tx) => {
    await tx.insert(commands).values({
      id: commandId,
      nodePubkey: pubkey,
      actionType: "update_fee",
      params,
      canonicalPayload: payload, // VERBATIM — the exact signed string (CLAUDE.md §4)
      signatureHex,
      state: "pending_approval",
      expiresAt,
    });
    await tx.insert(commandAudit).values({
      commandId,
      fromState: null, // NULL on initial enqueue (D-08)
      toState: "pending_approval",
      actor: "operator",
    });
    return commandId;
  });
}
