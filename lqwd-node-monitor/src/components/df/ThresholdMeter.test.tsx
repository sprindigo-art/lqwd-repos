import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThresholdMeter } from "@/components/df/ThresholdMeter";
import { severityAccent, type Severity } from "@/components/df/Severity";

// =====================================================
// ThresholdMeter.test.tsx — the D-03 severity fill meter (Phase 14)
// =====================================================
// Presentation-pure contract: the fill color comes ONLY from the caller-supplied
// `sev` prop via `severityAccent[sev]` — the meter NEVER derives severity from
// pct (the 12-10 lesson). Honest-stale (DS-01/D-06): stale renders the gold
// dashed/hatched df-stale-* track with NO severity fill — a meter can never
// paint green or red off old data. pct clamps to [0,100]; a11y is role="meter"
// + aria-valuenow/min/max + aria-label.

const RAMP_SEVS: Severity[] = ["critical", "warning", "watch", "healthy"];

describe("ThresholdMeter", () => {
  it("paints the fill with severityAccent[sev] for each ramp severity", () => {
    for (const sev of RAMP_SEVS) {
      const html = renderToStaticMarkup(
        createElement(ThresholdMeter, { pct: 62, sev, label: `${sev} meter` }),
      );
      // the ONE sanctioned sev→class path — bg-df-critical / -warning / -watch / -ok
      expect(html).toContain(severityAccent[sev]);
    }
  });

  it("renders fill width equal to pct literally", () => {
    const html = renderToStaticMarkup(
      createElement(ThresholdMeter, { pct: 82, sev: "warning", label: "disk usage" }),
    );
    expect(html).toContain("width:82%");
    expect(html).toContain('aria-valuenow="82"');
  });

  it("clamps pct to [0,100]: 0 → 0%, 100 → 100%, 140 → 100%, -5 → 0%", () => {
    const cases: Array<[number, string, string]> = [
      [0, "width:0%", 'aria-valuenow="0"'],
      [100, "width:100%", 'aria-valuenow="100"'],
      [140, "width:100%", 'aria-valuenow="100"'],
      [-5, "width:0%", 'aria-valuenow="0"'],
    ];
    for (const [pct, width, valuenow] of cases) {
      const html = renderToStaticMarkup(
        createElement(ThresholdMeter, { pct, sev: "healthy", label: "cpu" }),
      );
      expect(html).toContain(width);
      expect(html).toContain(valuenow);
    }
  });

  it("stale renders the gold dashed track with NO severity fill — never green/red off old data", () => {
    const html = renderToStaticMarkup(
      createElement(ThresholdMeter, { pct: 82, sev: "critical", stale: true, label: "mem" }),
    );
    // gold df-stale-* track treatment, dashed/hatched
    expect(html).toContain("border-dashed");
    expect(html).toContain("df-stale");
    // NO ramp fill class of any severity may appear on a stale meter
    for (const sev of RAMP_SEVS) {
      expect(html).not.toContain(severityAccent[sev]);
    }
    // and no proportional fill width either
    expect(html).not.toContain("width:82%");
  });

  it("exposes role='meter' with aria-valuenow/min/max and an aria-label", () => {
    const html = renderToStaticMarkup(
      createElement(ThresholdMeter, { pct: 45, sev: "watch", label: "CPU usage" }),
    );
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="45"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-label="CPU usage"');
  });

  it("falls back to a sensible default aria-label when label is omitted", () => {
    const html = renderToStaticMarkup(createElement(ThresholdMeter, { pct: 45, sev: "watch" }));
    expect(html).toContain("aria-label=");
  });

  it("merges className last via cn()", () => {
    const html = renderToStaticMarkup(
      createElement(ThresholdMeter, { pct: 45, sev: "watch", label: "cpu", className: "mt-2" }),
    );
    expect(html).toContain("mt-2");
  });
});
