import { describe, it, expect } from "vitest";
import {
  WINDOW_PRESETS,
  DEFAULT_WINDOW,
  ROW_CAP,
  PENDING_RECENCY_HOURS,
  TAB_KEYS,
  EXPORTABLE_TABS,
} from "@/lib/console/config";

// Console config shape test (NO DB, no server-only). This module is the
// phase's SINGLE tuning surface — every later plan (read modules, pages,
// export, pending UI) imports these constants. The test pins the locked
// decisions: D-01 tab order, D-05 default window, D-06 preset map,
// D-07 row cap, NODE-02 exportable set, and the A3 recency tunable.

describe("console config — the single tuning surface", () => {
  it("WINDOW_PRESETS maps exactly the four D-06 presets to bound integer days", () => {
    // Keys are URL tokens; values are the integers that get parameter-bound.
    // Never bind a user string into a SQL interval (D-06) — the key from the
    // URL selects the integer, the integer binds.
    expect(WINDOW_PRESETS).toEqual({ "24h": 1, "7d": 7, "30d": 30, "90d": 90 });
    for (const v of Object.values(WINDOW_PRESETS)) {
      expect(typeof v).toBe("number");
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it("DEFAULT_WINDOW is '7d' and is a key of WINDOW_PRESETS (D-05)", () => {
    expect(DEFAULT_WINDOW).toBe("7d");
    expect(Object.keys(WINDOW_PRESETS)).toContain(DEFAULT_WINDOW);
  });

  it("TAB_KEYS is exactly the eight console tabs in D-01 order", () => {
    expect(TAB_KEYS).toEqual([
      "scorecard",
      "channels",
      "fees",
      "liquidity",
      "forwards",
      "closes",
      "peers",
      "pending",
    ]);
  });

  it("EXPORTABLE_TABS is a subset of TAB_KEYS and covers the NODE-02 minimum set", () => {
    for (const tab of EXPORTABLE_TABS) {
      expect(TAB_KEYS).toContain(tab);
    }
    expect(EXPORTABLE_TABS).toContain("channels");
    expect(EXPORTABLE_TABS).toContain("forwards");
    expect(EXPORTABLE_TABS).toContain("closes");
    expect(EXPORTABLE_TABS).toContain("fees");
  });

  it("ROW_CAP is 500 (D-07) and PENDING_RECENCY_HOURS is 6 (A3 golden-verified)", () => {
    expect(ROW_CAP).toBe(500);
    expect(PENDING_RECENCY_HOURS).toBe(6);
  });

  it("imports cleanly in a plain node test (pure module — no server-only side effects)", () => {
    // Reaching this assertion at all proves the top-level import graph carried
    // no server-only / DB-client side effects (which would throw at import).
    expect(WINDOW_PRESETS).toBeDefined();
    expect(TAB_KEYS.length).toBe(8);
  });
});
