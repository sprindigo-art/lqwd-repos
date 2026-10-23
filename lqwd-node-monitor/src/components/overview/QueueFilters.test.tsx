import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QueueFilters } from "@/components/overview/QueueFilters";
import { AiBandClient } from "@/components/overview/AiBandClient";
import type { OverviewFacets } from "@/lib/overview/filter";
import type { AiReadLine } from "@/components/df/AiReadPanel";

// =====================================================
// QueueFilters.test.tsx — navy-structural filter chips + session-scoped band dismiss
// =====================================================
// SSR-rendered via renderToStaticMarkup (the workspace dep-free render path — no
// jsdom). Mirrors AiReadPanel.test.tsx.
// OVW-05 / DS-01: the chip set renders; the ACTIVE chip carries navy STRUCTURE
// chrome (`bg-df-brand`) and NEVER a severity hue; active state reflects the
// `facets` prop. The AI band wrapper carries the verbatim built-in safety pill and
// hides only via its own dismiss control (session-scoped, no persistence — D-05).

function renderFilters(facets: OverviewFacets): string {
  return renderToStaticMarkup(createElement(QueueFilters, { facets }));
}

/** Count non-overlapping occurrences of a substring (active-chip tally). */
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe("QueueFilters", () => {
  it("renders the full layer + severity chip set", () => {
    const html = renderFilters({ layer: [], sev: [] });
    for (const label of ["All", "Hosts", "Services", "bitcoind", "Nodes", "Storage"]) {
      expect(html).toContain(`>${label}<`);
    }
    // severity chip copy comes from severityLabel (uppercase mono), not free strings
    for (const label of ["CRITICAL", "WARNING", "WATCH"]) {
      expect(html).toContain(`>${label}<`);
    }
  });

  it("marks the All chip active (navy structural chrome) when no layer facet is set", () => {
    const html = renderFilters({ layer: [], sev: [] });
    // navy structural fill is present (the All chip), and the chip is aria-pressed
    expect(html).toContain("bg-df-brand");
    expect(html).toContain('aria-pressed="true"');
  });

  it("reflects the facets prop in the active-chip count (active state is prop-driven)", () => {
    // One active layer chip (Hosts) — All is inactive, so exactly one navy fill.
    const oneLayer = renderFilters({ layer: ["hosts"], sev: [] });
    // Two active facets (Hosts + critical) — two navy fills.
    const twoFacets = renderFilters({ layer: ["hosts"], sev: ["critical"] });
    expect(count(twoFacets, "bg-df-brand")).toBe(count(oneLayer, "bg-df-brand") + 1);
    // empty facets activate the All chip instead — still exactly one navy fill.
    const none = renderFilters({ layer: [], sev: [] });
    expect(count(none, "bg-df-brand")).toBe(count(oneLayer, "bg-df-brand"));
  });

  it("never paints a chip with a severity hue — navy structure only (DS-01)", () => {
    const html = renderFilters({ layer: [], sev: ["critical", "warning", "watch"] });
    // active severity chips use the navy fill, NOT their own severity token
    expect(html).not.toContain("bg-df-critical");
    expect(html).not.toContain("bg-df-warning");
    expect(html).not.toContain("bg-df-watch");
  });

  it("toggles facet values into reload-safe query hrefs (URL is the source of truth)", () => {
    const html = renderFilters({ layer: ["hosts"], sev: [] });
    // the Services chip href ADDS services to the active hosts facet
    expect(html).toContain('href="?layer=hosts&amp;layer=services"');
    // the active Hosts chip href TOGGLES it back off (clears the query)
    expect(html).toContain('href="?"');
  });

  it("renders client <button> chips with NO navigation when onToggle is supplied (island path)", () => {
    // With an onToggle handler the chips must be client buttons that flip facet
    // state in place — never <Link> anchors — so a filter click never re-fetches.
    const html = renderToStaticMarkup(
      createElement(QueueFilters, { facets: { layer: [], sev: [] }, onToggle: () => {} }),
    );
    // buttons render for every chip (All + 5 layers + 3 severities = 9)
    expect(count(html, "<button")).toBe(9);
    // and NOT a single navigation href — the URL sync is history-only (client)
    expect(html).not.toContain("href=");
    // the chip labels still render (copy is unchanged between the two paths)
    for (const label of ["All", "Hosts", "CRITICAL"]) {
      expect(html).toContain(`>${label}<`);
    }
  });
});

const LINES: AiReadLine[] = [
  { sev: "critical", head: "host-03 bitcoind stalled. ", body: "Three nodes roll up." },
  { sev: "warning", head: "lqwd-rtr-02 fee drifted. ", body: "From peer median." },
];

describe("AiBandClient", () => {
  it("renders the verbatim built-in zero-credential safety copy", () => {
    const html = renderToStaticMarkup(createElement(AiBandClient, { lines: LINES }));
    expect(html).toContain("AI · explains &amp; ranks, never runs commands");
    expect(html).toContain("NodeMonitor runs nothing for you.");
  });

  it("passes the advisory lines through to the band", () => {
    const html = renderToStaticMarkup(createElement(AiBandClient, { lines: LINES }));
    expect(html).toContain("host-03 bitcoind stalled.");
    expect(html).toContain("Three nodes roll up.");
  });

  it("wires a session-scoped dismiss control (the band's only hide path, D-05)", () => {
    // The dismiss ✕ renders BECAUSE AiBandClient supplies onDismiss (its useState
    // setter). AiReadPanel never self-hides — when dismissed===true the wrapper
    // returns null, so the only way the band disappears is this client control.
    const html = renderToStaticMarkup(createElement(AiBandClient, { lines: LINES }));
    expect(html).toContain("Dismiss AI read");
  });

  it("renders the all-clear calm variant when allClear is set", () => {
    const html = renderToStaticMarkup(
      createElement(AiBandClient, {
        lines: [],
        allClear: true,
        calmDetail: "All 26 nodes are healthy and reporting fresh.",
      }),
    );
    expect(html).toContain("Nothing needs you right now.");
    expect(html).toContain("All 26 nodes are healthy and reporting fresh.");
  });
});
