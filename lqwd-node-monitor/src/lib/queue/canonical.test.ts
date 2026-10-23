import { describe, expect, it } from "vitest";
import { buildSignedPayload, canonicalize } from "@/lib/queue/canonical";

// =====================================================
// QUEUE-02 — PURE canonicalizer (the cross-phase HMAC freeze)
// =====================================================
// The canonical string produced here is hashed BYTE-IDENTICALLY by the Phase 7
// bash `openssl` verifier (CLAUDE.md §4). These tests freeze that string form:
// key-sorted, whitespace-free, stored verbatim.

describe("canonicalize (key-sorted, whitespace-free, stable)", () => {
  it("emits object keys in sorted order regardless of input ordering", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("produces no whitespace in the output", () => {
    const out = canonicalize({
      chanId: "780000x0x1",
      channelPoint: "abc:0",
      currentPpm: 100,
      suggestedPpm: 250,
      baseFeeMsat: 1000,
      timeLockDelta: 40,
    });
    expect(/\s/.test(out)).toBe(false);
  });

  it("serializes leaves via JSON.stringify (numbers + strings)", () => {
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize("hi")).toBe('"hi"');
    expect(canonicalize(null)).toBe("null");
  });

  it("recursively key-sorts nested objects and preserves array order", () => {
    expect(canonicalize({ z: { d: 1, c: 2 }, a: [3, 1, 2] })).toBe(
      '{"a":[3,1,2],"z":{"c":2,"d":1}}',
    );
  });

  it("freezes a known-vector canonical string byte-for-byte", () => {
    // FROZEN VECTOR — Phase 7's bash `openssl` hashes this exact string.
    // Changing it is a cross-phase breaking change.
    const params = {
      chanId: "780000x0x1",
      channelPoint: "txid:0",
      currentPpm: 100,
      suggestedPpm: 250,
      baseFeeMsat: 1000,
      timeLockDelta: 40,
    };
    expect(canonicalize(params)).toBe(
      '{"baseFeeMsat":1000,"chanId":"780000x0x1","channelPoint":"txid:0","currentPpm":100,"suggestedPpm":250,"timeLockDelta":40}',
    );
  });
});

describe("buildSignedPayload (newline-joined field order, D-04)", () => {
  it("joins the five fields in EXACTLY [nodePubkey, commandId, actionType, canonicalParams, expiresAt]", () => {
    const payload = buildSignedPayload({
      nodePubkey: "02aa",
      commandId: "cmd-1",
      actionType: "update_fee",
      canonicalParams: '{"a":1}',
      expiresAt: "2026-06-16T00:00:00.000Z",
    });
    expect(payload).toBe(
      ["02aa", "cmd-1", "update_fee", '{"a":1}', "2026-06-16T00:00:00.000Z"].join("\n"),
    );
  });

  it("the canonicalParams substring is reproduced verbatim (no re-serialization)", () => {
    const canonicalParams = canonicalize({ b: 2, a: 1 });
    const payload = buildSignedPayload({
      nodePubkey: "02aa",
      commandId: "cmd-1",
      actionType: "update_fee",
      canonicalParams,
      expiresAt: "2026-06-16T00:00:00.000Z",
    });
    expect(payload.split("\n")[3]).toBe(canonicalParams);
  });
});
