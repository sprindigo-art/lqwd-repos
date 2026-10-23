import { z } from "zod";

// =====================================================
// QUEUE-03 / D-03 — update_fee bounds schema (Phase 6 design artifact)
// =====================================================
// Extends the FROZEN update_fee params (src/lib/insight/schema.ts lines 99-113)
// with operator-confirmed min/max bounds. PURE module — no server-side guard/DB/env —
// so the same schema runs client-side for instant UX feedback AND server-side as the
// authoritative gate (defense in depth); the node-side executor re-enforces these
// identical values a THIRD time (3rd of 3 enforcement points: client + server + node).
//
// Bounds are operator-CONFIRMED and FROZEN per D-11:
//   suggestedPpm  : 0 … 5000      frozen D-11
//   baseFeeMsat   : 0 … 100_000   frozen D-11
//   timeLockDelta : 18 … 2016     frozen D-11
//
// Keep `.strict()` at the object level like every level in schema.ts (line 28):
// field additions are breaking changes by design.

export const updateFeeBoundsSchema = z
  .object({
    chanId: z.string().min(1),
    channelPoint: z.string().min(1),
    currentPpm: z.number().int().nonnegative(),
    suggestedPpm: z.number().int().min(0).max(5000), // frozen D-11
    baseFeeMsat: z.number().int().min(0).max(100_000), // frozen D-11
    timeLockDelta: z.number().int().min(18).max(2016), // frozen D-11
  })
  .strict();

/** The bounds-validated update_fee params shape (inferred from the schema). */
export type UpdateFeeParams = z.infer<typeof updateFeeBoundsSchema>;

/**
 * D-03 audit flag: true when the operator-edited value differs from the
 * engine's deterministic suggestion — the audit row records the command as
 * operator-overridden when this is true.
 */
export function isOperatorOverride(suggestedValue: number, editedValue: number): boolean {
  return editedValue !== suggestedValue;
}
