import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QueueIsland } from "@/components/overview/QueueIsland";
import type { GroupedIncident } from "@/lib/overview/incidents";
import type { OverviewFacets } from "@/lib/overview/filter";

// =====================================================
// QueueIsland.test.tsx — node child rows render their REASON (quick 260721-gqi #3)
// =====================================================
// Server-rendered via renderToStaticMarkup under the node env (no jsdom), mirroring
// SeverityCard.test.tsx. The queue AUTO-EXPANDS surviving cards when a LAYER filter is
// active, so passing `initialFacets` with an active layer set forces the nested child
// rows to paint. We assert:
//   H — a node rollup summary child shows its count phrase (`why`), not the bare name.
//   I — a raw-signal node leaf humanizes its DetectorId `why` via SIGNAL_LABELS.
//   J — bitcoind ("bitcoind") and host ("host-metrics") rows keep their hostname
//       (entityLabel) and NEVER leak their raw `why` — the reason-render is gated to
//       layer === "nodes" only.

function child(over: Partial<GroupedIncident> & Pick<GroupedIncident, "key" | "layer" | "why" | "entityLabel">): GroupedIncident {
  return {
    severity: "critical",
    stale: false,
    asOf: null,
    children: [],
    ...over,
  } as GroupedIncident;
}

const INCIDENT: GroupedIncident = {
  key: "h1",
  layer: "hosts",
  severity: "critical",
  stale: false,
  why: "4 alerts on host-alpha",
  entityLabel: "host-alpha",
  asOf: null,
  children: [
    child({
      key: "rollup:stuck_fc_past_maturity:pk",
      layer: "nodes",
      why: "17 channels · STUCK FORCE-CLOSE",
      entityLabel: "LQWD-Australia",
      count: 17,
    }),
    child({
      key: "leaf-stuck-open",
      layer: "nodes",
      why: "stuck_open",
      entityLabel: "LQWD-Australia",
    }),
    child({
      key: "bitcoind:h1",
      layer: "bitcoind",
      why: "bitcoind",
      entityLabel: "host-alpha-btc",
    }),
    child({
      key: "host:h1",
      layer: "hosts",
      severity: "stale",
      stale: true,
      why: "host-metrics",
      entityLabel: "host-alpha-metrics",
    }),
  ],
};

// A layer filter across all three layers keeps every child AND auto-expands the card.
const FACETS: OverviewFacets = { layer: ["nodes", "bitcoind", "hosts"], sev: [] };

function render(): string {
  return renderToStaticMarkup(
    createElement(QueueIsland, { incidents: [INCIDENT], initialFacets: FACETS }),
  );
}

describe("QueueIsland — node child rows carry their reason (quick 260721-gqi #3)", () => {
  it("Test H: a node rollup summary child renders its count phrase (why), not the bare node name", () => {
    const html = render();
    expect(html).toContain("17 channels · STUCK FORCE-CLOSE");
  });

  it("Test I: a raw-signal node leaf humanizes its DetectorId why via SIGNAL_LABELS, never the raw key", () => {
    const html = render();
    expect(html).toContain("STUCK OPEN");
    expect(html).not.toContain("stuck_open");
  });

  it("Test J: bitcoind + host telemetry rows keep their hostname (entityLabel) and do NOT leak their raw why", () => {
    const html = render();
    // Telemetry rows show the hostname, not the reason.
    expect(html).toContain("host-alpha-btc");
    expect(html).toContain("host-alpha-metrics");
    // The host row's raw why must NOT reach the screen (gate is layer === "nodes" only).
    expect(html).not.toContain("host-metrics");
  });

  it("keeps the card headline as the incident's entityLabel (only child rows gain their reason)", () => {
    const html = render();
    expect(html).toContain("host-alpha");
  });
});
