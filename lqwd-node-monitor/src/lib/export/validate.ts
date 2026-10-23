import { SuggestedActionSchema } from "@/lib/insight/schema";

// =====================================================
// validateActionForExport — Phase 5 EXPORT-01 AC3 / PENDING-03 (T-05-01, T-05-03)
// =====================================================
// Pure module: no server-only imports, no DB, no env — test-imported and safe
// anywhere (mirrors deeplink.ts discipline).
//
// EXPORT-01 AC3 ("params validated against strict type/range before rendering —
// no injection"). RESEARCH Pattern 1: validate-before-interpolate, two gates:
//   Gate 1 — re-parse against the FROZEN SuggestedActionSchema (shape/type).
//   Gate 2 — per-field HARD format regexes on every value that enters a command
//            string (these are the values that reach a node shell).
// Unlike deeplink.ts (which THROWS — a detector passing garbage is a bug), a
// failed export validation returns the project `{ ok, reason? }` result and the
// UI renders the honest WITHHELD state downstream — it is not a crash.

/** channel_point = `<64-hex-txid>:<output-index>` (also used for sweep outpoints). */
export const CHANNEL_POINT_RE = /^[0-9a-f]{64}:\d{1,5}$/;
/** A bitcoin txid — exactly 64 lowercase hex chars. */
export const TXID_RE = /^[0-9a-f]{64}$/;
/** A node pubkey — exactly 66 lowercase hex chars (same gate as deeplink.ts). */
export const PUBKEY_RE = /^[0-9a-f]{66}$/;
/** A short-channel-id rendered as a decimal string (1..20 digits). */
export const CHAN_ID_RE = /^\d{1,20}$/;

/** True only for a strictly-positive JS-safe integer. */
function isPositiveSafeInt(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0;
}

/**
 * SOFT-clamp a suggested fee rate to the honest valid window: an integer in
 * 1..5000 sat/vByte, else null (the builder routes null to the "no suggested
 * rate" state — never withholds the export over a bad rate).
 */
export function safeSatPerVbyte(n: number | null): number | null {
  if (n === null) return null;
  if (!Number.isSafeInteger(n)) return null;
  if (n < 1 || n > 5000) return null;
  return n;
}

type ValidateResult = { ok: true } | { ok: false; reason: string };

/**
 * Gate an insight card's suggestedAction for command export. Returns ok:true
 * only when the action type is exportable AND every command-bound param passes
 * its HARD format gate. SOFT fields (chanId, suggestedSatPerVbyte) never
 * withhold — the builder degrades them gracefully (RESEARCH A2).
 */
export function validateActionForExport(action: unknown): ValidateResult {
  // Gate 1 — frozen-schema re-parse (shape + type). Failure short-circuits
  // before any value is touched.
  const parsed = SuggestedActionSchema.safeParse(action);
  if (!parsed.success) return { ok: false, reason: "schema parse failed" };

  const a = parsed.data;

  // Gate 2 — per-type HARD format checks (BEFORE any value enters a command).
  switch (a.type) {
    case "close_channel": {
      // channelPoint is the executable identifier — HARD gate.
      // chanId is SOFT (A2): builders verify CHAN_ID_RE themselves and fall back
      // to --chan_point, so a non-decimal chanId must NOT withhold the export.
      if (!CHANNEL_POINT_RE.test(a.params.channelPoint)) {
        return { ok: false, reason: "close_channel: invalid channelPoint format" };
      }
      return { ok: true };
    }
    case "rebalance": {
      if (!PUBKEY_RE.test(a.params.partnerPubkey)) {
        return { ok: false, reason: "rebalance: invalid partnerPubkey format" };
      }
      if (!isPositiveSafeInt(a.params.amountSat)) {
        return { ok: false, reason: "rebalance: amountSat must be a positive safe integer" };
      }
      return { ok: true };
    }
    case "remediate_pending": {
      // outpointTxid / channelPoint are HARD when present; suggestedSatPerVbyte
      // is SOFT (routed through safeSatPerVbyte downstream, never withholds).
      if (a.params.outpointTxid !== null && !TXID_RE.test(a.params.outpointTxid)) {
        return { ok: false, reason: "remediate_pending: invalid outpointTxid format" };
      }
      if (a.params.channelPoint !== null && !CHANNEL_POINT_RE.test(a.params.channelPoint)) {
        return { ok: false, reason: "remediate_pending: invalid channelPoint format" };
      }
      return { ok: true };
    }
    // T-05-03 — update_fee/investigate are NEVER exported (project D3: fees are
    // the Phase 6 queue prong). Structurally non-exportable here.
    case "update_fee":
    case "investigate":
      return { ok: false, reason: "action type not exportable" };
  }
}
