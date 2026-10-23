import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SeverityCard } from "@/components/df/SeverityCard";
import { SeverityHeroCard } from "@/components/df/SeverityHeroCard";
import type { Severity } from "@/components/df/Severity";
import type { WhyChainEvent } from "@/components/df/WhyChain";
import type { AiReadLine } from "@/components/df/AiReadPanel";

// =====================================================
// SeverityCard.test.tsx — render/shape smoke (10-G6 rebuild)
// =====================================================
// Server Component → renderToStaticMarkup under the node env (no jsdom). Asserts
// the ENRICHED standard card renders in all 7 modes (default + 5 severities +
// loading/no-evidence) without throwing, and that the full v2 composition (icon
// tile + sev chip + evidence panel + meta row + expand drawer) paints. The hero
// variant gets its own shape assertions.
//
// CHART CAVEAT: EvidenceChart's Recharts SVG renders client-side only — under
// `renderToStaticMarkup` only the surrounding CARD CHROME (evidence-panel label/
// value, blast-radius SVG, why-chain spine, AI band) is asserted, never the
// Recharts `<svg>` plot. That is the documented SSR contract of these primitives.

const SEVERITIES: Severity[] = ["critical", "warning", "watch", "healthy", "stale"];

const TIMELINE: WhyChainEvent[] = [
  { time: "14:02", text: "Chain tip unchanged for 3 polls.", severity: "critical" },
  { time: "14:08", text: "host-03 flagged — bitcoind stalled.", severity: "critical" },
];

const AI_LINES: AiReadLine[] = [
  { sev: "critical", head: "host-03 bitcoind stalled. ", body: "3 nodes roll up to one host." },
];

describe("SeverityCard (standard)", () => {
  it("renders the default (no explicit body) without throwing", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, { sev: "healthy", title: "lqwd-rtr-01" }),
    );
    expect(html).toContain("lqwd-rtr-01");
  });

  it("renders every severity state without throwing", () => {
    for (const sev of SEVERITIES) {
      const html = renderToStaticMarkup(
        createElement(SeverityCard, { sev, title: `node-${sev}`, why: "evidence body" }),
      );
      expect(html).toContain(`node-${sev}`);
    }
  });

  it("renders the loading/skeleton mode (no children) without throwing", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, { sev: "watch", title: "loading…" }),
    );
    expect(html).toContain("loading");
  });

  it("renders the back-compat body slot (v1 header-strip shape)", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, { sev: "warning", title: "host-07", body: "fee drift detected" }),
    );
    expect(html).toContain("fee drift detected");
  });

  it("critical state paints the critical accent/tint token class, a sev chip, and an icon", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, { sev: "critical", title: "host-03", why: "chain stalled" }),
    );
    // critical tint + accent token classes (tint surface + accent bar/chip)
    expect(html).toContain("bg-df-critical-tint");
    expect(html).toContain("bg-df-critical");
    // the sev chip label (white-on-accent pill)
    expect(html).toContain("CRITICAL");
    // lucide renders an <svg> element for the severity icon tile
    expect(html).toContain("<svg");
  });

  it("renders the meta row (impl tag + freshness + expand toggle)", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, {
        sev: "warning",
        title: "host-07",
        why: "fee drift",
        impl: "lnd",
        freshness: { asOf: new Date("2026-06-24T13:42:00Z"), stale: false, now: new Date("2026-06-24T13:42:04Z") },
        onToggle: () => {},
        expandLabel: "Why-chain",
      }),
    );
    // ImplTag two-part label
    expect(html).toContain("Routing · LND");
    // FreshnessChip relative age
    expect(html).toContain("data fresh");
    // expand toggle copy
    expect(html).toContain("Why-chain");
  });

  it("renders the inline evidence panel chrome (label + value)", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, {
        sev: "critical",
        title: "host-03",
        why: "chain stalled",
        evidence: {
          evLabel: "Minutes behind chain tip",
          evValue: "+22m",
          series: [0, 4, 9, 14, 22],
          accent: "#E0392B",
        },
      }),
    );
    // evidence-panel CHROME (label + value) renders SSR even though the Recharts
    // plot does not — assert the surrounding chrome, not the SVG.
    expect(html).toContain("Minutes behind chain tip");
    expect(html).toContain("+22m");
  });

  it("renders the expand drawer (why-chain + AI read + children) when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, {
        sev: "critical",
        title: "host-03",
        why: "chain stalled",
        expanded: true,
        timeline: TIMELINE,
        aiLines: AI_LINES,
        childAlerts: [
          { sev: "critical", node: "lqwd-rtr-04", kind: "HTLC", note: "2 HTLCs at risk", detail: "last good 22m ago" },
        ],
        childrenLabel: "3 grouped node alerts",
      }),
    );
    // why-chain timeline event text
    expect(html).toContain("host-03 flagged");
    // AI-read band safety label (built-in)
    expect(html).toContain("never runs commands");
    // grouped child row
    expect(html).toContain("lqwd-rtr-04");
    expect(html).toContain("2 HTLCs at risk");
    expect(html).toContain("3 grouped node alerts");
  });

  it("does NOT render the drawer when collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, {
        sev: "critical",
        title: "host-03",
        why: "chain stalled",
        expanded: false,
        timeline: TIMELINE,
      }),
    );
    expect(html).not.toContain("host-03 flagged");
  });

  it("renders the childrenFooter AFTER the child rows when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, {
        sev: "warning",
        title: "host-07",
        why: "elevated load",
        expanded: true,
        childAlerts: [{ sev: "warning", node: "svc-a", status: "warn", statusSev: "warning" }],
        childrenFooter: createElement("button", { type: "button" }, "show 3 more"),
      }),
    );
    expect(html).toContain("svc-a");
    expect(html).toContain("show 3 more");
    // the footer renders AFTER the child row in source order
    expect(html.indexOf("svc-a")).toBeLessThan(html.indexOf("show 3 more"));
  });

  it("does NOT render the childrenFooter when collapsed", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityCard, {
        sev: "warning",
        title: "host-07",
        expanded: false,
        childAlerts: [{ sev: "warning", node: "svc-a" }],
        childrenFooter: createElement("button", { type: "button" }, "show 3 more"),
      }),
    );
    expect(html).not.toContain("show 3 more");
  });
});

describe("SeverityHeroCard", () => {
  it("renders the minimal hero (title only) without throwing", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityHeroCard, { title: "bitcoind on host-03 stalled" }),
    );
    expect(html).toContain("bitcoind on host-03 stalled");
    // default eyebrow + default critical chip
    expect(html).toContain("Top priority");
    expect(html).toContain("CRITICAL");
  });

  it("renders root-cause chip + fresh indicator + narrative + meta chips", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityHeroCard, {
        title: "bitcoind on host-03 stalled — 22 min behind chain tip",
        rootCauseChip: "ROOT CAUSE · 3 nodes roll up",
        freshLabel: "data fresh · 4s",
        narrative: "The chain backend stopped advancing at 14:02.",
        metaChips: ["bitcoind · host-03", "flagged 14:08 · 22m ago"],
      }),
    );
    expect(html).toContain("ROOT CAUSE · 3 nodes roll up");
    expect(html).toContain("data fresh · 4s");
    expect(html).toContain("stopped advancing");
    expect(html).toContain("bitcoind · host-03");
    expect(html).toContain("flagged 14:08 · 22m ago");
  });

  it("renders the evidence sparkline panel chrome", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityHeroCard, {
        title: "host-03 stalled",
        evidence: {
          evLabel: "Minutes behind chain tip · +22m",
          evValue: "+22m",
          evNote: "Climbing since 14:08 · alert at +15m",
          series: [0, 4, 9, 14, 22],
          accent: "#E0392B",
          area: "above",
          threshold: { v: 15, label: "alert" },
        },
      }),
    );
    // evidence-panel chrome (label + value + note) — NOT the Recharts SVG plot.
    expect(html).toContain("Minutes behind chain tip · +22m");
    expect(html).toContain("Climbing since 14:08");
  });

  it("renders the BLAST RADIUS diagram + resolution callout", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityHeroCard, {
        title: "host-03 stalled",
        blast: {
          host: "host-03",
          hostStatus: "bitcoind stalled",
          note: "one host outage → 3 nodes on it",
          targets: [
            { name: "lqwd-rtr-04", note: "2 HTLCs at risk" },
            { name: "lqwd-rtr-09", note: "channel state stale" },
          ],
          resolution: "Restart bitcoind on host-03 and all 3 nodes clear automatically.",
        },
      }),
    );
    // BlastRadius is pure SVG — renders fully SSR.
    expect(html).toContain("Blast radius");
    expect(html).toContain("host-03");
    expect(html).toContain("bitcoind stalled");
    expect(html).toContain("lqwd-rtr-04");
    expect(html).toContain("ROOT CAUSE · FIX HERE");
    expect(html).toContain("Restart bitcoind on host-03");
  });

  it("renders the expand grid (why-chain + AI grouping + children) when expanded", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityHeroCard, {
        title: "host-03 stalled",
        expanded: true,
        timeline: TIMELINE,
        aiLines: AI_LINES,
        childAlerts: [{ sev: "critical", node: "lqwd-rtr-04", kind: "HTLC", note: "2 HTLCs at risk" }],
        childrenLabel: "3 grouped node alerts · clear when host-03 recovers",
      }),
    );
    expect(html).toContain("host-03 flagged");
    expect(html).toContain("AI grouping");
    expect(html).toContain("lqwd-rtr-04");
    expect(html).toContain("3 grouped node alerts");
  });

  it("renders every severity state for the hero without throwing", () => {
    for (const sev of SEVERITIES) {
      const html = renderToStaticMarkup(
        createElement(SeverityHeroCard, { sev, title: `hero-${sev}` }),
      );
      expect(html).toContain(`hero-${sev}`);
    }
  });
});
