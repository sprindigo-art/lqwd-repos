import { describe, expect, it } from "vitest";

import { buildSignedPayload, canonicalize } from "./canonical";

// =====================================================
// 18-02 — DB-less canonical-binding proof (Q1 golden property)
// =====================================================
// apply-fee (scripts/node/apply-fee) derives EVERY applied value from field 4
// of the signed canonical_payload (the canonicalize(params) substring), never
// from the independently-mutable `params` jsonb column. That defense is only
// sound if:
//   (1) canonicalize(params) byte-equals the canonicalParams embedded as
//       field 4 of the payload buildSignedPayload emits, and
//   (2) ANY mutation of params produces a different canonical string — so a
//       tampered `params` column can never masquerade as the signed bytes.
// This suite pins both properties WITHOUT a DB (pure module — 18-01's
// requireNodemonDb tagging is deliberately NOT used here; the plan's artifact
// contract is a DB-less proof, mirroring canonical.test.ts).

const PUBKEY = "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMAND_ID = "11111111-1111-1111-1111-111111111111";
const EXPIRES_AT = "2999-01-01T00:00:00.000Z";

// The frozen update_fee params shape (tests/node/seed.sql fidelity).
const params = {
  baseFeeMsat: 1000,
  chanId: "800000000000000001",
  channelPoint: "aaaa1111:0",
  currentPpm: 100,
  suggestedPpm: 250,
  timeLockDelta: 80,
};

function signedPayloadFor(p: unknown, pubkey: string = PUBKEY): string {
  return buildSignedPayload({
    nodePubkey: pubkey,
    commandId: COMMAND_ID,
    actionType: "update_fee",
    canonicalParams: canonicalize(p),
    expiresAt: EXPIRES_AT,
  });
}

/** Field 4 (index 3) of the 5-field newline-joined signed payload. */
function field4(payload: string): string {
  return payload.split("\n")[3];
}

describe("canonical binding — signed field 4 IS canonicalize(params)", () => {
  it("canonicalize(params) byte-equals field 4 of the signed payload", () => {
    const payload = signedPayloadFor(params);
    expect(field4(payload)).toBe(canonicalize(params));
  });

  it("the payload splits into exactly 5 lines — canonicalize never emits a newline", () => {
    const payload = signedPayloadFor(params);
    const lines = payload.split("\n");
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe(PUBKEY); // field 1 = nodePubkey (apply-fee's replay check)
    expect(canonicalize(params)).not.toContain("\n");
  });

  it("key-order permutation of the same params leaves field 4 byte-identical", () => {
    const permuted = {
      timeLockDelta: 80,
      suggestedPpm: 250,
      currentPpm: 100,
      channelPoint: "aaaa1111:0",
      chanId: "800000000000000001",
      baseFeeMsat: 1000,
    };
    expect(field4(signedPayloadFor(permuted))).toBe(field4(signedPayloadFor(params)));
  });

  it.each([
    ["suggestedPpm raised", { ...params, suggestedPpm: 4999 }],
    ["baseFeeMsat raised", { ...params, baseFeeMsat: 99999 }],
    ["timeLockDelta changed", { ...params, timeLockDelta: 18 }],
    ["channelPoint redirected", { ...params, channelPoint: "ffff6666:0" }],
    ["extra key injected", { ...params, injected: true }],
  ])("mutated params (%s) break the field-4 binding", (_label, tampered) => {
    const signed = field4(signedPayloadFor(params));
    // The property apply-fee relies on: a tampered `params` column can never
    // canonicalize to the signed field-4 bytes, so deriving applied values
    // from field 4 fully ignores the tamper.
    expect(canonicalize(tampered)).not.toBe(signed);
  });

  it("a dropped key also breaks the binding (truncation is not a bypass)", () => {
    const truncated = Object.fromEntries(
      Object.entries(params).filter(([k]) => k !== "timeLockDelta"),
    );
    expect(canonicalize(truncated)).not.toBe(field4(signedPayloadFor(params)));
  });
});
