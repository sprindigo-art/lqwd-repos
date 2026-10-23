import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ServiceWhyAccordion,
  NO_REASON_FALLBACK,
  type ServiceWhyAccordionProps,
} from "@/components/df/ServiceWhyAccordion";

// =====================================================
// ServiceWhyAccordion.test.tsx — the honest why-panel for a not-green service row
// =====================================================
// DEP-FREE per the LOCKED client-component convention (RESEARCH §H): renderToStaticMarkup
// from react-dom/server under vitest `environment: "node"` + a `defaultOpen` prop so the
// expanded panel renders in static markup for assertions. NO jsdom / @testing-library
// (see TwoAxisPip.test.tsx + NodeFeeEnqueue.test.tsx). The load-bearing invariant: when
// the probe supplies detail it shows verbatim; when detail is NULL (the live LND fleet)
// it renders an HONEST fallback + error_count + last-success age, never a fabricated cause.

const NOW = Date.parse("2026-07-20T12:00:00Z");
const min = (m: number) => m * 60 * 1000;

/** Full props with a trigger child; overridden per case. defaultOpen so the panel is in markup. */
function baseProps(
  overrides: Partial<ServiceWhyAccordionProps> = {},
): ServiceWhyAccordionProps {
  return {
    detail: null,
    detectionMethod: null,
    errorCount: 0,
    lastSuccessAt: null,
    functioningStale: false,
    collectorStale: false,
    nowMs: NOW,
    defaultOpen: true,
    children: createElement("div", null, "TRIGGER-ROW"),
    ...overrides,
  };
}

const render = (overrides: Partial<ServiceWhyAccordionProps> = {}) =>
  renderToStaticMarkup(createElement(ServiceWhyAccordion, baseProps(overrides)));

describe("ServiceWhyAccordion", () => {
  it("always renders the trigger children", () => {
    const html = render({ defaultOpen: false });
    expect(html).toContain("TRIGGER-ROW");
  });

  it("(a) shows the probe detail VERBATIM when present", () => {
    const html = render({ detail: "probe: rpc timeout to lnd", detectionMethod: "systemd" });
    expect(html).toContain("probe: rpc timeout to lnd");
    // detection_method surfaces as a chip
    expect(html).toContain("systemd");
    // and it does NOT show the honest fallback when a real reason exists
    expect(html).not.toContain(NO_REASON_FALLBACK);
  });

  it("(b) detail=null → HONEST fallback + error_count + a last-success value (no fabricated reason)", () => {
    const html = render({
      detail: null,
      errorCount: 9,
      lastSuccessAt: new Date(NOW - min(30)),
    });
    expect(html).toContain(NO_REASON_FALLBACK);
    // the real error_count is surfaced
    expect(html).toContain("9");
    // and a humanized last-success age (30 min old → "…ago")
    expect(html).toContain("ago");
  });

  it("(c) lastSuccessAt=null → last-success reads 'never', not a fake timestamp / not '0s ago'", () => {
    const html = render({ lastSuccessAt: null });
    expect(html).toContain("never");
    expect(html).not.toContain("0s ago");
  });

  it("humanizes a real lastSuccessAt Date into an '…ago' age string", () => {
    const html = render({ lastSuccessAt: new Date(NOW - min(5)) });
    expect(html).toContain("5m ago");
    expect(html).not.toContain("never");
  });

  it("(d) functioningStale=true renders a functioning-stale indicator", () => {
    const html = render({ functioningStale: true });
    expect(html.toLowerCase()).toContain("functioning-stale");
  });

  it("(d) collectorStale=true renders a collector-stale indicator", () => {
    const html = render({ collectorStale: true });
    expect(html.toLowerCase()).toContain("collector-stale");
  });

  it("neither stale indicator renders when both flags are false", () => {
    const html = render({ functioningStale: false, collectorStale: false });
    expect(html.toLowerCase()).not.toContain("functioning-stale");
    expect(html.toLowerCase()).not.toContain("collector-stale");
  });

  it("collapsed (defaultOpen=false) does not render the why-panel content", () => {
    const html = render({ defaultOpen: false, detail: "probe: rpc timeout" });
    expect(html).not.toContain("probe: rpc timeout");
    // but the trigger is still there
    expect(html).toContain("TRIGGER-ROW");
  });
});
