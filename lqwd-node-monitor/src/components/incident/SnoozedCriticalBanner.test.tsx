import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SnoozedCriticalBanner } from "@/components/incident/SnoozedCriticalBanner";

// =====================================================
// SnoozedCriticalBanner.test.tsx — D-04 honesty banner (render tests)
// =====================================================
// count=0 → absent (renders nothing); count>0 → the critical-ramp banner with the
// pluralized UI-SPEC copy, count in tabular-nums, and NO dismiss control.

describe("SnoozedCriticalBanner", () => {
  it("renders nothing when no criticals are snoozed", () => {
    const html = renderToStaticMarkup(createElement(SnoozedCriticalBanner, { count: 0 }));
    expect(html).toBe("");
  });

  it("renders the pluralized critical-ramp banner when count > 0", () => {
    const html = renderToStaticMarkup(createElement(SnoozedCriticalBanner, { count: 2 }));
    expect(html).toContain("2");
    expect(html).toContain("snoozed critical incidents — muted, not resolved");
    // wears the critical severity ramp (state surface), never navy
    expect(html).toContain("df-critical");
    expect(html).toContain("tabular-nums");
  });

  it("uses the singular noun when exactly one critical is snoozed", () => {
    const html = renderToStaticMarkup(createElement(SnoozedCriticalBanner, { count: 1 }));
    expect(html).toContain("snoozed critical incident — muted, not resolved");
    expect(html).not.toContain("incidents —");
  });

  it("has no dismiss affordance (non-dismissible, D-04)", () => {
    const html = renderToStaticMarkup(createElement(SnoozedCriticalBanner, { count: 3 }));
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Dismiss");
  });
});
