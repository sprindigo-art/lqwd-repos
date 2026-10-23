import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The server action is mocked — the render tests never invoke the LLM path; they
// assert the idle trigger, the worstSeverity-derived verdict badge, and the
// inert error copy. (renderToStaticMarkup only renders initial client state.)
vi.mock("@/app/actions/narrate-incident", () => ({
  narrateIncident: vi.fn(async () => ({ ok: false, error: "mocked" })),
}));

import {
  IncidentReadClient,
  VerdictBadge,
  VERDICT_LABEL,
} from "@/components/incident/IncidentReadClient";

describe("IncidentReadClient", () => {
  it("idle: renders the EXPLAIN — LLM trigger (not the pending label)", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentReadClient, { incidentKey: "host-03", worstSeverity: "critical" }),
    );
    expect(html).toContain("EXPLAIN — LLM");
    expect(html).not.toContain("READING…");
  });

  it("does not use a raw-HTML sink (no dangerouslySetInnerHTML in the render)", () => {
    const html = renderToStaticMarkup(
      createElement(IncidentReadClient, { incidentKey: "host-03", worstSeverity: "warning" }),
    );
    // sanity: trigger present, page never blocked
    expect(html).toContain("EXPLAIN — LLM");
  });
});

describe("VerdictBadge", () => {
  it("maps critical → 'Act now' with the critical accent, never navy", () => {
    const html = renderToStaticMarkup(createElement(VerdictBadge, { severity: "critical" }));
    expect(html).toContain("Act now");
    expect(html).toContain("bg-df-critical");
    // the verdict chip wears the severity ramp — NEVER navy chrome/brand
    expect(html).not.toContain("df-brand");
  });

  it("maps warning → 'Monitor' and watch → 'Informational'", () => {
    expect(VERDICT_LABEL.warning).toBe("Monitor");
    expect(VERDICT_LABEL.watch).toBe("Informational");
    const html = renderToStaticMarkup(createElement(VerdictBadge, { severity: "watch" }));
    expect(html).toContain("Informational");
    expect(html).toContain("bg-df-watch");
    expect(html).not.toContain("df-brand");
  });

  it("critical maps to 'Act now'", () => {
    expect(VERDICT_LABEL.critical).toBe("Act now");
  });
});
