import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  IncidentTrackingControls,
  type IncidentTrackingState,
} from "@/components/incident/IncidentTrackingControls";

// =====================================================
// IncidentTrackingControls.test.tsx — INC-02 tracking cluster (render tests)
// =====================================================
// renderToStaticMarkup (no jsdom). Asserts the three controls render, an acked
// prop surfaces the "ack'd ·" stamp, the snooze presets are 1h/4h/24h, and NO
// severity/critical ramp class is ever applied to a control (navy affordance only).

const FRESH: IncidentTrackingState = {
  ackedAt: null,
  owner: null,
  snoozeUntil: null,
};

describe("IncidentTrackingControls", () => {
  it("renders all three controls (ack / assign / snooze presets)", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentTrackingControls, { incidentKey: "host-03", tracking: FRESH }),
    );
    expect(html).toContain("Acknowledge");
    expect(html).toContain("Assign to me");
    // snooze fixed presets
    expect(html).toContain(">1h<");
    expect(html).toContain(">4h<");
    expect(html).toContain(">24h<");
  });

  it("shows the ack'd stamp when the incident is already acknowledged", () => {
    const acked: IncidentTrackingState = {
      ackedAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
      owner: "nodemon-operator",
      snoozeUntil: null,
    };
    const html = renderToStaticMarkup(
      createElement(IncidentTrackingControls, { incidentKey: "host-03", tracking: acked }),
    );
    // React escapes the apostrophe in text nodes (&#x27;) — match the escaped form.
    expect(html).toContain("ack&#x27;d ·");
    expect(html).toContain("nodemon-operator");
  });

  it("shows a snoozed-until chip + un-snooze affordance when snoozed", () => {
    const snoozed: IncidentTrackingState = {
      ackedAt: null,
      owner: null,
      snoozeUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const html = renderToStaticMarkup(
      createElement(IncidentTrackingControls, { incidentKey: "host-03", tracking: snoozed }),
    );
    expect(html).toContain("snoozed until");
    expect(html).toContain("Un-snooze");
  });

  it("never applies a severity ramp class to a control (navy affordance only)", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentTrackingControls, { incidentKey: "host-03", tracking: FRESH }),
    );
    expect(html).not.toContain("df-critical");
    expect(html).not.toContain("df-warning");
    expect(html).not.toContain("df-watch");
  });

  it("uses tabular-nums on the snooze presets", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentTrackingControls, { incidentKey: "host-03", tracking: FRESH }),
    );
    expect(html).toContain("tabular-nums");
  });
});
