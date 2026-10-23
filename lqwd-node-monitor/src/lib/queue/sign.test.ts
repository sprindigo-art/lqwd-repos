import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSignedPayload } from "@/lib/queue/canonical";
import { signPayload, verifyPayload } from "@/lib/queue/sign";

// =====================================================
// QUEUE-02 — server-only HMAC signer + constant-time verify
// =====================================================
// The digest is BYTE-IDENTICAL to `openssl dgst -sha256 -hmac` over the verbatim
// canonical payload string (proven this session; NO base64 round-trip — Pitfall
// 1). The per-node secret resolves from env `NODEMON_HMAC_SECRET_<pubkey>`
// (D-12), server-only, never DB/client. `server-only` is aliased to a no-op stub
// under vitest (vitest.config.ts), so these run under plain node.

const PUBKEY = "02aabbcc";
const SECRET = "test-secret-abc";
const SECRET_ENV = `NODEMON_HMAC_SECRET_${PUBKEY}`;

// The exact payload + frozen known-vector digest. The digest was cross-checked
// against `openssl dgst -sha256 -hmac "$SECRET"` over this verbatim string —
// byte-identical (73ff602a…). NO base64 anywhere in the round-trip.
const PAYLOAD = buildSignedPayload({
  nodePubkey: PUBKEY,
  commandId: "cmd-1",
  actionType: "update_fee",
  canonicalParams: '{"a":1}',
  expiresAt: "2026-06-16T00:00:00.000Z",
});
const KNOWN_VECTOR = "73ff602a39483b190adc76998c2e3eef37438dde68c6e9cb1d1e3e6049d84ecf";

beforeEach(() => {
  process.env[SECRET_ENV] = SECRET;
});
afterEach(() => {
  delete process.env[SECRET_ENV];
});

describe("signPayload (lowercase hex HMAC-SHA256, per-node secret)", () => {
  it("matches the frozen known-vector digest (byte-identical to openssl)", () => {
    expect(signPayload(PUBKEY, PAYLOAD)).toBe(KNOWN_VECTOR);
  });

  it("produces a lowercase 64-char hex digest", () => {
    expect(signPayload(PUBKEY, PAYLOAD)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws a descriptive error when the per-node secret env is missing", () => {
    delete process.env[SECRET_ENV];
    expect(() => signPayload(PUBKEY, PAYLOAD)).toThrow(SECRET_ENV);
  });
});

describe("verifyPayload (constant-time timingSafeEqual)", () => {
  it("accepts a matching signature", () => {
    const sig = signPayload(PUBKEY, PAYLOAD);
    expect(verifyPayload(PUBKEY, PAYLOAD, sig)).toBe(true);
  });

  it("rejects a single-byte-tampered signature", () => {
    const sig = signPayload(PUBKEY, PAYLOAD);
    // flip the last hex nibble
    const lastChar = sig.slice(-1);
    const flipped = sig.slice(0, -1) + (lastChar === "0" ? "1" : "0");
    expect(verifyPayload(PUBKEY, PAYLOAD, flipped)).toBe(false);
  });

  it("rejects a length-mismatched hex (truncated digest)", () => {
    const sig = signPayload(PUBKEY, PAYLOAD);
    expect(verifyPayload(PUBKEY, PAYLOAD, sig.slice(0, -2))).toBe(false);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const sig = signPayload(PUBKEY, PAYLOAD);
    expect(verifyPayload(PUBKEY, PAYLOAD + "x", sig)).toBe(false);
  });
});
