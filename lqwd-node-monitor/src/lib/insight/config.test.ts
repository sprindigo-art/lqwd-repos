import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INSIGHT_CONFIG } from "@/lib/insight/config";

// D-13 guard tests (T-04-05 threshold-fork drift): the detector knob surface
// must never grow a fork of a scorecard-owned threshold (AP-11 close storm
// ≥50/hr, PPM-LOW <10) — those are READ from SCORECARD_CONFIG at use-sites.

const moduleSource = readFileSync(
  fileURLToPath(new URL("./config.ts", import.meta.url)),
  "utf8",
);

describe("INSIGHT_CONFIG (D-13)", () => {
  it("has both backend keys as distinct object literals", () => {
    expect(INSIGHT_CONFIG.lnd).toBeDefined();
    expect(INSIGHT_CONFIG.ldk).toBeDefined();
    // Distinct literals — retuning ldk must never mutate lnd.
    expect(INSIGHT_CONFIG.lnd).not.toBe(INSIGHT_CONFIG.ldk);
  });

  it("lnd and ldk expose identical key sets (per-backend surface, same shape)", () => {
    expect(Object.keys(INSIGHT_CONFIG.lnd).sort()).toEqual(
      Object.keys(INSIGHT_CONFIG.ldk).sort(),
    );
  });

  it("every knob is a positive finite number", () => {
    for (const backend of ["lnd", "ldk"] as const) {
      for (const [key, value] of Object.entries(INSIGHT_CONFIG[backend])) {
        expect(typeof value, `${backend}.${key}`).toBe("number");
        expect(Number.isFinite(value), `${backend}.${key} finite`).toBe(true);
        expect(value, `${backend}.${key} > 0`).toBeGreaterThan(0);
      }
    }
  });

  it("declares NO scorecard-owned fork knobs (AP-11 close storm / PPM-LOW)", () => {
    // Knob names must never reference the scorecard-owned thresholds.
    for (const backend of ["lnd", "ldk"] as const) {
      for (const key of Object.keys(INSIGHT_CONFIG[backend])) {
        expect(key, `fork knob in ${backend}`).not.toMatch(/closeStorm|ap11|ppmLow/i);
      }
    }
  });

  it("module source declares no tier1-style fork (tier1 keys live in SCORECARD_CONFIG only)", () => {
    // A fork would look like `tier1: { ... value: 50 }`. Mentions of the READ
    // path (SCORECARD_CONFIG[backend].forceClose.tier1.value) are allowed and
    // expected in the banner; a tier1 KEY DECLARATION is not.
    expect(moduleSource).not.toMatch(/tier1\s*:/);
  });

  it("documents the SCORECARD_CONFIG read path (D-13 key link)", () => {
    expect(moduleSource).toContain("SCORECARD_CONFIG");
  });

  it("is a pure module — no server-only import", () => {
    expect(moduleSource).not.toContain("server-only");
  });
});
