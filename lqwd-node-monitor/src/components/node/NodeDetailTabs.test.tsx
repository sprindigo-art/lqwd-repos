import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NodeDetailTabs, type NodeDetailTab } from "@/components/node/NodeDetailTabs";

// =====================================================
// NodeDetailTabs.test.tsx — the shared sub-nav render lock (G1/G2)
// =====================================================
// Locks the four-surface contract: all four hrefs are emitted, and the `active` tab
// (and ONLY that tab) carries the navy structural active marker. DEP-FREE —
// `renderToStaticMarkup` under `environment: "node"` (mirrors NodeFeeEnqueue.test.tsx).

const PUBKEY = "0".repeat(66);

function render(active: NodeDetailTab, counts?: { channels?: number; peers?: number }) {
  return renderToStaticMarkup(
    createElement(NodeDetailTabs, { pubkey: PUBKEY, active, counts }),
  );
}

describe("NodeDetailTabs — the four-surface nav contract", () => {
  it("(1) emits all four sub-route hrefs", () => {
    const html = render("overview");
    expect(html).toContain(`href="/${PUBKEY}"`);
    expect(html).toContain(`href="/${PUBKEY}/channels"`);
    expect(html).toContain(`href="/${PUBKEY}/peers"`);
    expect(html).toContain(`href="/${PUBKEY}/forwards"`);
  });

  it("(2) marks the active tab (and only it) with aria-current + data-active", () => {
    const html = render("channels");
    // the channels tab is active… (React may emit aria-current before data-tab)
    expect(html).toMatch(/data-tab="channels"[^>]*data-active="true"/);
    expect(html).toMatch(/aria-current="page"[^>]*data-tab="channels"/);
    // …and no other tab is.
    expect(html).not.toMatch(/data-tab="overview"[^>]*data-active="true"/);
    expect(html).not.toMatch(/data-tab="peers"[^>]*data-active="true"/);
    expect(html).not.toMatch(/data-tab="forwards"[^>]*data-active="true"/);
    // exactly one active marker rendered.
    expect((html.match(/data-active="true"/g) ?? []).length).toBe(1);
  });

  it("(3) the active marker uses the navy structural token (df-brand), not a severity hue", () => {
    const html = render("peers");
    expect(html).toContain("text-df-brand");
    expect(html).toContain("bg-df-brand"); // the underline
  });

  it("(4) renders honest counts beside labels only when supplied", () => {
    const withCounts = render("overview", { channels: 12, peers: 8 });
    expect(withCounts).toMatch(/data-testid="tab-count-channels"[^>]*>12</);
    expect(withCounts).toMatch(/data-testid="tab-count-peers"[^>]*>8</);

    // omitted counts render no badge at all (never a fabricated 0).
    const noCounts = render("overview");
    expect(noCounts).not.toContain('data-testid="tab-count-channels"');
    expect(noCounts).not.toContain('data-testid="tab-count-peers"');
  });
});
