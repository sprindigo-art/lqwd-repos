import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  EvidenceChart,
  EvidencePanel,
  deriveChartModel,
  formatAxisLabel,
} from "@/components/df/EvidenceChart";
import { DF } from "@/lib/df/tokens";

// EvidenceChart is a `"use client"` Recharts island. Recharts 3.x renders its
// SVG surface via client-side state/effects — under `renderToStaticMarkup`
// (our dep-free node test path, no jsdom) the chart body itself is intentionally
// empty (a `.recharts-wrapper` div). So the SVG-internals (line path / dashed
// threshold / band rect) are asserted against the PURE, exported
// `deriveChartModel` (the declarative grammar the Recharts tree is built from),
// while the SSR markup test covers the two paths that DO render server-side:
// the StaleChart honest-stale fallback, and the units.ts-formatted axis labels.

const SERIES = [640, 720, 830, 910, 980, 1020, 1045, 1050];

describe("deriveChartModel (chart grammar)", () => {
  it("emits a line, a dashed threshold reference, an area fill, and a peer-median band", () => {
    const model = deriveChartModel({
      series: SERIES,
      accent: DF.watch,
      threshold: { v: 90, label: "alert 90%" },
      band: { lo: 280, hi: 400, label: "peer median" },
      area: true,
    });
    if (!model) throw new Error("expected non-null chart model");

    // main 2px accent line
    expect(model.line).toEqual({ stroke: DF.watch, strokeWidth: 2 });
    // dashed neutral threshold reference line + right-aligned label
    expect(model.threshold).toMatchObject({
      v: 90,
      label: "alert 90%",
      stroke: DF.slate,
      strokeDasharray: "3 3",
    });
    // peer-median band as a translucent reference area
    expect(model.band).toMatchObject({ lo: 280, hi: 400, label: "peer median" });
    expect(model.band?.fill).toBe(`${DF.slate}1c`);
    // accent area fill at ~12% alpha (accent + "1f")
    expect(model.area).toMatchObject({ fill: `${DF.watch}1f` });
  });

  it("carries a dashed projection continuation and a last-point marker dot", () => {
    const model = deriveChartModel({
      series: SERIES,
      accent: DF.warning,
      projection: [95.5, 97, 98.5, 100],
    });
    if (!model) throw new Error("expected non-null chart model");
    expect(model.projection).toMatchObject({
      stroke: DF.warning,
      strokeDasharray: "3 3",
      opacity: 0.65,
    });
    // last-point dot uses the accent
    expect(model.lastDot).toEqual({ fill: DF.warning });
  });

  it("returns null (no line) for fewer than two points — the Sparkline guard", () => {
    expect(deriveChartModel({ series: [42], accent: DF.ok })).toBeNull();
    expect(deriveChartModel({ series: [], accent: DF.ok })).toBeNull();
  });

  it("renders a projection layer whose dashed continuation starts at the last real point", () => {
    const model = deriveChartModel({
      series: SERIES,
      accent: DF.warning,
      projection: [95.5, 97, 98.5, 100],
    })!;
    // first projection row IS the last real point (so the two segments meet)
    const lastReal = { i: SERIES.length - 1, v: SERIES[SERIES.length - 1] };
    expect(model.projection!.data[0]).toEqual(lastReal);
    // then the forecast points, x-indexed beyond the real series
    expect(model.projection!.data).toHaveLength(5);
    expect(model.projection!.data[1]).toEqual({ i: SERIES.length, v: 95.5 });
    expect(model.projection!.data[4]).toEqual({ i: SERIES.length + 3, v: 100 });
    // the x-domain extends to cover the projection points (proto N = series + proj)
    expect(model.xMax).toBe(SERIES.length + 4 - 1);
  });

  it("derives a vertical marker with a label, dashed 2 2 slate at 0.55 opacity", () => {
    const model = deriveChartModel({
      series: SERIES,
      accent: DF.critical,
      marker: { atIndex: 6, label: "lost" },
    })!;
    expect(model.marker).toEqual({
      atIndex: 6,
      label: "lost",
      stroke: DF.slate,
      strokeDasharray: "2 2",
      opacity: 0.55,
    });
  });

  it("resolves area to a 3-way mode — 'above' baselines on the threshold, 'under' on baseline", () => {
    const above = deriveChartModel({
      series: SERIES,
      accent: DF.critical,
      threshold: { v: 5, label: "alert >5m" },
      area: "above",
    })!;
    // 'above' fills only the exceedance above the threshold → baseLineValue = threshold.v
    expect(above.area).toEqual({ fill: `${DF.critical}1f`, mode: "above", baseLineValue: 5 });

    const under = deriveChartModel({ series: SERIES, accent: DF.warning, area: "under" })!;
    // 'under' fills to baseline → baseLineValue undefined (Recharts uses yMin)
    expect(under.area).toEqual({ fill: `${DF.warning}1f`, mode: "under", baseLineValue: undefined });

    // legacy boolean `true` still means "under" (backwards-compatible)
    const bool = deriveChartModel({ series: SERIES, accent: DF.ok, area: true })!;
    expect(bool.area).toMatchObject({ mode: "under" });

    // 'above' WITHOUT a threshold can't baseline on it → falls back to baseline fill
    const noThresh = deriveChartModel({ series: SERIES, accent: DF.critical, area: "above" })!;
    expect(noThresh.area).toMatchObject({ mode: "above", baseLineValue: undefined });

    // omitted area → no fill descriptor
    expect(deriveChartModel({ series: SERIES, accent: DF.ok })!.area).toBeUndefined();
  });

  it("derives a shade window with the prototype orange fill + label color", () => {
    const model = deriveChartModel({
      series: SERIES,
      accent: DF.watch,
      shade: { from: 2, to: 6, label: "fee-drift window" },
    })!;
    expect(model.shade).toEqual({
      from: 2,
      to: 6,
      label: "fee-drift window",
      fill: "#C8770A12",
      textFill: "#C8770A",
    });
  });

  it("gives the band a default 'peer median' caption when none is supplied", () => {
    const model = deriveChartModel({
      series: SERIES,
      accent: DF.watch,
      band: { lo: 280, hi: 400 },
    })!;
    expect(model.band?.label).toBe("peer median");
    expect(model.band?.stroke).toBe(DF.slate);
  });
});

describe("formatAxisLabel (time OR quantity)", () => {
  it("renders a literal time string verbatim", () => {
    expect(formatAxisLabel({ kind: "time", value: "-30m" })).toBe("-30m");
    expect(formatAxisLabel({ kind: "time", value: "now" })).toBe("now");
  });

  it("routes sat/BTC quantities through units.ts", () => {
    expect(formatAxisLabel({ kind: "sats", value: 5_000_000 })).toBe("5,000,000");
    expect(formatAxisLabel({ kind: "btc", value: 100_000_000 })).toContain(".");
  });
});

describe("EvidencePanel (SSR markup chrome)", () => {
  it("renders the evLabel, a bold colored evValue, and an evNote caption", () => {
    const html = renderToStaticMarkup(
      <EvidencePanel
        evLabel="Minutes behind chain tip · last 30 min"
        evValue="+22m"
        evValueColor={DF.critical}
        evNote="Climbing since 14:08."
      >
        <div data-testid="chart-slot" />
      </EvidencePanel>,
    );
    expect(html).toContain("Minutes behind chain tip");
    expect(html).toContain("+22m");
    // the value carries the explicit color (bold colored evValue)
    expect(html).toContain(DF.critical);
    expect(html).toContain("Climbing since 14:08.");
    // the wrapped chart slot is present
    expect(html).toContain("chart-slot");
  });

  it("falls back to the accent color for evValue when no explicit color is given", () => {
    const html = renderToStaticMarkup(
      <EvidencePanel evLabel="Outbound fee ppm vs peer band" evValue="3.1×" accent={DF.watch}>
        <div />
      </EvidencePanel>,
    );
    expect(html).toContain("3.1×");
    expect(html).toContain(DF.watch);
  });

  it("omits the note line entirely when no evNote is supplied", () => {
    const html = renderToStaticMarkup(
      <EvidencePanel evLabel="gRPC reachability" evValue="DOWN" accent={DF.critical}>
        <div />
      </EvidencePanel>,
    );
    expect(html).toContain("DOWN");
    expect(html).not.toContain("margin-top:7px");
  });
});

describe("EvidenceChart (SSR markup)", () => {
  it("falls back to the StaleChart 'NO FRESH DATA' placeholder when stale (no Recharts line)", () => {
    const html = renderToStaticMarkup(
      <EvidenceChart
        series={SERIES}
        accent={DF.watch}
        stale
        lastGoodLabel="last good 4h ago"
      />,
    );
    expect(html).toContain("NO FRESH DATA");
    expect(html).toContain("last good 4h ago");
    // honest-stale gold panel, NOT a healthy recharts line surface
    expect(html).toContain("#F7F2E4");
    expect(html).not.toContain("recharts-wrapper");
  });

  it("formats a sat-valued axis label through units.ts (no raw integer in output)", () => {
    const html = renderToStaticMarkup(
      <EvidenceChart
        series={SERIES}
        accent={DF.watch}
        axisLabels={[{ kind: "sats", value: 5_000_000 }, { kind: "sats", value: 12_500 }]}
      />,
    );
    // formatSats(5_000_000) → "5,000,000" (grouped); raw "5000000" must NOT appear
    expect(html).toContain("5,000,000");
    expect(html).not.toContain("5000000");
    expect(html).toContain("12,500");
  });

  it("renders literal TIME axis labels (the prototype's actual axis strings)", () => {
    const html = renderToStaticMarkup(
      <EvidenceChart
        series={SERIES}
        accent={DF.watch}
        axisLabels={[
          { kind: "time", value: "-30m" },
          { kind: "time", value: "-15m" },
          { kind: "time", value: "now" },
        ]}
      />,
    );
    expect(html).toContain("-30m");
    expect(html).toContain("-15m");
    expect(html).toContain("now");
  });
});
