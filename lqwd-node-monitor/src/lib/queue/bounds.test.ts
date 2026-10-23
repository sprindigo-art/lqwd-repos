import { describe, expect, it } from "vitest";
import { isOperatorOverride, updateFeeBoundsSchema } from "@/lib/queue/bounds";

// =====================================================
// QUEUE-03 — update_fee bounds schema (D-03 design artifact)
// =====================================================
// PURE zod `.strict()` schema extending the FROZEN update_fee params
// (src/lib/insight/schema.ts). Bounds are PROVISIONAL [ASSUMED] — no gateway
// `Limits` struct exists; Phase 7 re-enforces the SAME bounds node-side (A1,
// FLAG FOR OPERATOR). The override detector records operator-overridden params
// (audited per D-03).

const VALID = {
  chanId: "780000x0x1",
  channelPoint: "txid:0",
  currentPpm: 100,
  suggestedPpm: 250,
  baseFeeMsat: 1000,
  timeLockDelta: 40,
};

describe("updateFeeBoundsSchema (provisional bounds [ASSUMED], strict)", () => {
  it("accepts in-range params", () => {
    expect(updateFeeBoundsSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects suggestedPpm above the provisional 5000 ceiling", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, suggestedPpm: 6000 }).success).toBe(false);
  });

  it("accepts suggestedPpm exactly at the 5000 ceiling", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, suggestedPpm: 5000 }).success).toBe(true);
  });

  it("rejects baseFeeMsat above the provisional 100000 ceiling", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, baseFeeMsat: 100001 }).success).toBe(false);
  });

  it("rejects timeLockDelta below 18 and above 2016", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, timeLockDelta: 17 }).success).toBe(false);
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, timeLockDelta: 2017 }).success).toBe(false);
  });

  it("accepts timeLockDelta at the 18 and 2016 boundaries", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, timeLockDelta: 18 }).success).toBe(true);
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, timeLockDelta: 2016 }).success).toBe(true);
  });

  it("rejects negative ppm / base", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, suggestedPpm: -1 }).success).toBe(false);
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, baseFeeMsat: -1 }).success).toBe(false);
  });

  it("rejects non-integer values", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, suggestedPpm: 250.5 }).success).toBe(false);
  });

  it("is strict — rejects unknown extra keys (field additions are breaking)", () => {
    expect(updateFeeBoundsSchema.safeParse({ ...VALID, extra: 1 }).success).toBe(false);
  });
});

describe("isOperatorOverride (D-03 audit flag)", () => {
  it("true when the edited ppm differs from the engine's suggestion", () => {
    expect(isOperatorOverride(250, 300)).toBe(true);
  });

  it("false when the edited value equals the engine's suggestion", () => {
    expect(isOperatorOverride(250, 250)).toBe(false);
  });
});
