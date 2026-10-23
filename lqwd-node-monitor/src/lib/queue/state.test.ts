import { describe, expect, it } from "vitest";
import { canTransition, isExpired, LEGAL } from "@/lib/queue/state";

// =====================================================
// QUEUE-01/03 — pure state-transition table + clock-injectable TTL
// =====================================================
// PURE module (no DB/env). The transition table is the lost-update guard: every
// flip is `UPDATE … WHERE state=<expected>`; canTransition() pins the legal
// edges. isExpired() mirrors freshness.isStale(now=…) for deterministic tests.

describe("canTransition (legal edges only)", () => {
  it("allows pending_approval → approved", () => {
    expect(canTransition("pending_approval", "approved")).toBe(true);
  });

  it("allows pending_approval → rejected and → expired", () => {
    expect(canTransition("pending_approval", "rejected")).toBe(true);
    expect(canTransition("pending_approval", "expired")).toBe(true);
  });

  it("allows approved → claimed and → expired", () => {
    expect(canTransition("approved", "claimed")).toBe(true);
    expect(canTransition("approved", "expired")).toBe(true);
  });

  it("allows approved → withdrawn (D-01 operator undo)", () => {
    expect(canTransition("approved", "withdrawn")).toBe(true);
  });

  it("REJECTS pending_approval → withdrawn (only approved may withdraw — D-01/D-02)", () => {
    expect(canTransition("pending_approval", "withdrawn")).toBe(false);
  });

  it("REJECTS any exit from terminal withdrawn (withdrawn → approved)", () => {
    expect(LEGAL.withdrawn).toEqual([]);
    expect(canTransition("withdrawn", "approved")).toBe(false);
  });

  it("REJECTS approved → pending_approval (no backward flip)", () => {
    expect(canTransition("approved", "pending_approval")).toBe(false);
  });

  it("allows claimed → executing and the reaper release/fail edges", () => {
    expect(canTransition("claimed", "executing")).toBe(true);
    expect(canTransition("claimed", "approved")).toBe(true); // reaper release
    expect(canTransition("claimed", "failed")).toBe(true); // reaper fail
  });

  it("allows executing → succeeded | failed", () => {
    expect(canTransition("executing", "succeeded")).toBe(true);
    expect(canTransition("executing", "failed")).toBe(true);
  });

  it("rejects any transition OUT of a terminal state", () => {
    for (const terminal of ["succeeded", "failed", "rejected", "expired", "withdrawn"] as const) {
      expect(LEGAL[terminal]).toEqual([]);
      expect(canTransition(terminal, "approved")).toBe(false);
    }
  });

  it("rejects an unknown from-state", () => {
    expect(canTransition("not_a_state", "approved")).toBe(false);
  });

  it("rejects an illegal far-jump (pending_approval → executing)", () => {
    expect(canTransition("pending_approval", "executing")).toBe(false);
  });
});

describe("isExpired (clock-injectable TTL, fail-closed)", () => {
  const now = new Date("2026-06-16T12:00:00.000Z");

  it("true when expiresAt is strictly before the injected now", () => {
    expect(isExpired("2026-06-16T11:59:59.999Z", now)).toBe(true);
  });

  it("false when expiresAt is in the future", () => {
    expect(isExpired("2026-06-16T12:00:00.001Z", now)).toBe(false);
  });

  it("false exactly AT the deadline (not yet past)", () => {
    expect(isExpired("2026-06-16T12:00:00.000Z", now)).toBe(false);
  });

  it("accepts a Date expiresAt as well as an ISO string", () => {
    expect(isExpired(new Date("2026-06-16T11:00:00.000Z"), now)).toBe(true);
  });
});
