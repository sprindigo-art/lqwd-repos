import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// =====================================================
// QUEUE-02 — server-only HMAC signer + constant-time verify (D-12)
// =====================================================
// HMAC-SHA256 over the verbatim signed-payload string, lowercase hex. The digest
// is BYTE-IDENTICAL to `openssl dgst -sha256 -hmac "$SECRET"` over the same
// string (proven this session) — so Phase 7's bash verifier reproduces it
// without re-serializing JSON and WITHOUT base64 (RESEARCH Pitfall 1).
//
// server-only (T-06-06): reads the per-node secret from env and must NEVER reach
// a client bundle; the secret is NEVER logged (V6/V7) and NEVER stored in the
// `nodemon` DB. This module is the FORMAT/LOCATION freeze Phase 7's downloader
// mirrors (A3): the secret lives under env key `NODEMON_HMAC_SECRET_<pubkey>`.

/**
 * D-12: resolve the per-node secret from env keyed by pubkey. Fail loud (the
 * `requireEnv` voice) when missing — surfaced as the "NO SIGNING SECRET FOR THIS
 * NODE" UI error. The exact key form is frozen here for Phase 7 (A3).
 */
function secretFor(pubkey: string): string {
  const key = `NODEMON_HMAC_SECRET_${pubkey}`;
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing per-node HMAC secret env: ${key}`);
  }
  return value;
}

/**
 * Sign the verbatim payload with the per-node secret → lowercase hex digest.
 * The payload is hashed exactly as given (utf8); the caller stores it verbatim.
 */
export function signPayload(pubkey: string, payload: string): string {
  return createHmac("sha256", secretFor(pubkey)).update(payload, "utf8").digest("hex");
}

/**
 * Constant-time verify (CLAUDE.md §4): recompute the digest, compare with
 * `timingSafeEqual` after a length check (timingSafeEqual throws on unequal
 * lengths, so the length guard both prevents that throw and rejects truncated
 * hex). Returns false on any mismatch — never throws on a bad signature.
 */
export function verifyPayload(pubkey: string, payload: string, expectedHex: string): boolean {
  const actual = Buffer.from(signPayload(pubkey, payload), "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
