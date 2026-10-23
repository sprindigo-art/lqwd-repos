import { afterEach, describe, expect, it } from "vitest";

import {
  OVERVIEW_TTL_MS,
  clearOverviewCache,
  getOverviewCache,
  setOverviewCache,
} from "@/lib/overview/overview-cache";

// =====================================================
// overview-cache.test.ts — the SINGLE-OWNER overview memo global
// =====================================================
// The overview page's 20s TTL memo used to live inline in page.tsx as a module
// global. QUICK-REFRESH relocates it here so the refreshData() server action can
// bust the SAME global (a divergent second cache would make the bust a no-op).
// These tests pin the accessor contract without touching the Next runtime — the
// promise payload type is a compile-time-only import (erased), so this file pulls
// no server-only DB/env module into its graph.

// Keep the module global clean across cases (it is process-wide by design).
afterEach(() => clearOverviewCache());

describe("overview-cache — single-owner memo accessors", () => {
  it("returns undefined when nothing is cached", () => {
    clearOverviewCache();
    expect(getOverviewCache()).toBeUndefined();
  });

  it("returns the same entry (at + promise intact) after setOverviewCache", () => {
    const promise = Promise.resolve({} as never);
    setOverviewCache(1234, promise);
    const entry = getOverviewCache();
    expect(entry?.at).toBe(1234);
    expect(entry?.promise).toBe(promise);
  });

  it("returns undefined again after clearOverviewCache", () => {
    setOverviewCache(1, Promise.resolve({} as never));
    expect(getOverviewCache()).toBeDefined();
    clearOverviewCache();
    expect(getOverviewCache()).toBeUndefined();
  });

  it("exports OVERVIEW_TTL_MS === 20_000 (the honest sub-staleness memo window)", () => {
    expect(OVERVIEW_TTL_MS).toBe(20_000);
  });
});
