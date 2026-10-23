import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BlastRadius, type BlastTarget } from "@/components/df/BlastRadius";

// BlastRadius is pure df-token HTML (rebuilt from the fixed-width SVG that clipped
// labels — audit A2), so it renders fully under the dep-free `renderToStaticMarkup`
// node path. It is the root-cause containment view (DS-02): a root card fans out to
// N impacted instrument rows, each colored by its OWN severity (A3) with a neutral
// layer type-tag (C2) and an explicit severity word (A8). The shape test pins that
// structure + the 1..N target scaling + the severity/layer treatment.

const THREE: BlastTarget[] = [
  { name: "lqwd-rtr-04", note: "2 HTLCs at risk", sev: "critical", layer: "nodes" },
  { name: "lqwd-rtr-09", note: "channel state stale", sev: "warning", layer: "services" },
  { name: "lqwd-lsp-02", note: "1 HTLC at risk", sev: "watch", layer: "nodes" },
];

describe("BlastRadius (root-cause → impacted-nodes containment view)", () => {
  it("renders the root card, eyebrow, host status, and root-severity tint", () => {
    const html = renderToStaticMarkup(
      <BlastRadius
        host="host-03"
        hostStatus="bitcoind stalled"
        rootSev="critical"
        targets={THREE}
      />,
    );
    // responsive HTML, not a fixed SVG and not Recharts
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("recharts");
    expect(html).toContain("host-03");
    expect(html).toContain("bitcoind stalled");
    expect(html).toContain("ROOT CAUSE · FIX HERE");
    // root card is tinted by the passed severity via the canonical ramp
    expect(html).toContain("border-df-critical-border");
  });

  it("renders one instrument row per target, colored by its OWN severity (not all-red)", () => {
    const html = renderToStaticMarkup(
      <BlastRadius host="host-03" hostStatus="bitcoind stalled" rootSev="watch" targets={THREE} />,
    );
    for (const t of THREE) {
      expect(html).toContain(t.name);
      expect(html).toContain(t.note);
    }
    // each severity present — a WATCH incident is NOT rendered as an all-red tree
    expect(html).toContain("bg-df-critical");
    expect(html).toContain("bg-df-warning");
    expect(html).toContain("bg-df-watch");
    // explicit severity WORD accompanies the color (A8)
    expect(html).toContain("CRITICAL");
    expect(html).toContain("WARNING");
    expect(html).toContain("WATCH");
  });

  it("shows a layer type-tag per target so shared names are disambiguated (C2)", () => {
    const html = renderToStaticMarkup(
      <BlastRadius host="LQWD-Canada" hostStatus="fee crash" rootSev="critical" targets={THREE} />,
    );
    expect(html).toContain("NODE");
    expect(html).toContain("SERVICE");
  });

  it("truncates long labels/notes safely with a title fallback (no clipping)", () => {
    const long: BlastTarget[] = [
      {
        name: "lqwd-canada-super-long-entity-name",
        note: "declared but never reported — a very long note that must not clip",
        sev: "critical",
        layer: "services",
      },
    ];
    const html = renderToStaticMarkup(
      <BlastRadius host="host-01" hostStatus="down" rootSev="critical" targets={long} />,
    );
    expect(html).toContain("truncate");
    // full text preserved on hover via title
    expect(html).toContain('title="declared but never reported');
  });

  it("scales to a single target with a singular aria label", () => {
    const html = renderToStaticMarkup(
      <BlastRadius
        host="host-06"
        hostStatus="lnd crashed"
        rootSev="critical"
        targets={[{ name: "lqwd-rtr-07", note: "gRPC down", sev: "critical", layer: "nodes" }]}
      />,
    );
    expect(html).toContain("host-06");
    expect(html).toContain("lqwd-rtr-07");
    expect(html).toContain("affecting 1 node");
    expect(html).not.toContain("affecting 1 nodes");
  });

  it("scales to many targets — one row each", () => {
    const many: BlastTarget[] = Array.from({ length: 6 }, (_, i) => ({
      name: `node-${i}`,
      note: `${i} HTLC at risk`,
      sev: "critical" as const,
      layer: "nodes" as const,
    }));
    const html = renderToStaticMarkup(
      <BlastRadius host="host-09" hostStatus="disk full" rootSev="critical" targets={many} />,
    );
    const rows = html.match(/<li /g) ?? [];
    expect(rows).toHaveLength(6);
    for (const t of many) expect(html).toContain(t.name);
  });

  it("renders a neutral row when a caller supplies no per-target severity", () => {
    const html = renderToStaticMarkup(
      <BlastRadius
        host="host-03"
        hostStatus="stalled"
        targets={[{ name: "svc-x", note: "impacted" }]}
      />,
    );
    // neutral dot, no severity word
    expect(html).toContain("bg-df-faint");
    expect(html).not.toContain("CRITICAL");
  });

  it("respects a custom root-cause label", () => {
    const html = renderToStaticMarkup(
      <BlastRadius
        host="host-03"
        hostStatus="stalled"
        rootSev="critical"
        targets={THREE}
        rootCauseLabel="ORIGIN · START HERE"
      />,
    );
    expect(html).toContain("ORIGIN · START HERE");
    expect(html).not.toContain("ROOT CAUSE · FIX HERE");
  });
});
