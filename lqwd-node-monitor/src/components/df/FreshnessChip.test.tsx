import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FreshnessChip } from "@/components/df/FreshnessChip";

// =====================================================
// FreshnessChip.test.tsx — honest shape-distinct stale + relative age (G4)
// =====================================================
// DS-01: stale must be shape-distinct (square dot r2px + dashed border +
// text-df-stale-text) and NEVER render a green/ok dot; `asOf === null` is an
// honest "no data yet" early-return; fresh renders the round fresh dot. The label
// is a RELATIVE age ("4s ago", "4m ago") — never an absolute UTC stamp.

// Deterministic reference "now" so the relative-age delta is stable in CI.
const NOW = new Date("2026-06-23T14:02:00Z");
const FOUR_S_AGO = new Date("2026-06-23T14:01:56Z"); // → "4s ago"
const FORTY_ONE_M_AGO = new Date("2026-06-23T13:21:00Z"); // → "41m ago"

describe("FreshnessChip", () => {
  it("renders the shape-distinct stale treatment (square dot + dashed + gold text)", () => {
    const html = renderToStaticMarkup(
      createElement(FreshnessChip, { asOf: FORTY_ONE_M_AGO, stale: true, now: NOW }),
    );
    // square dot — radius 2px (rounded-[2px]), NOT rounded-full
    expect(html).toContain("rounded-[2px]");
    // dashed border
    expect(html).toContain("border-dashed");
    // gold stale text role
    expect(html).toContain("text-df-stale-text");
    // STALE label present
    expect(html).toContain("STALE");
    // relative age, not an absolute UTC stamp
    expect(html).toContain("41m ago");
    expect(html).not.toContain("2026-06-23");
    // and crucially NO green ok dot for stale
    expect(html).not.toContain("bg-df-ok");
  });

  it("honestly renders 'no data yet' when asOf is null", () => {
    const html = renderToStaticMarkup(
      createElement(FreshnessChip, { asOf: null, stale: false }),
    );
    expect(html).toContain("no data yet");
    // no fresh/stale dot in the no-data state
    expect(html).not.toContain("rounded-[2px]");
    expect(html).not.toContain("border-dashed");
  });

  it("renders the round fresh dot + relative age when not stale", () => {
    const html = renderToStaticMarkup(
      createElement(FreshnessChip, { asOf: FOUR_S_AGO, stale: false, now: NOW }),
    );
    expect(html).toContain("rounded-full");
    expect(html).toContain("bg-df-ok");
    expect(html).toContain("data fresh");
    // relative recency, not an absolute UTC wall-clock stamp
    expect(html).toContain("4s ago");
    expect(html).not.toContain("2026-06-23");
    // a fresh chip is NOT the square-dot stale shape
    expect(html).not.toContain("rounded-[2px]");
  });

  it("humanizes the age across s/m/h/d buckets and clamps future to 0s", () => {
    const cases: Array<[string, string]> = [
      ["2026-06-23T14:01:56Z", "4s ago"],
      ["2026-06-23T13:58:00Z", "4m ago"],
      ["2026-06-23T10:02:00Z", "4h ago"],
      ["2026-06-19T14:02:00Z", "4d ago"],
      ["2026-06-23T14:05:00Z", "0s ago"], // future → clamped, never negative
    ];
    for (const [iso, expected] of cases) {
      const html = renderToStaticMarkup(
        createElement(FreshnessChip, { asOf: new Date(iso), stale: false, now: NOW }),
      );
      expect(html).toContain(expected);
    }
  });
});
