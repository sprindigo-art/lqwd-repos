import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RefreshControl } from "@/components/df/RefreshControl";

// =====================================================
// RefreshControl.test.tsx — SSR-safe, HONEST top-bar refresh island
// =====================================================
// Rendered via the dep-free renderToStaticMarkup path (no jsdom, no router
// context) — the SAME path the locked NavRailShell suite uses, so this asserts
// the island stays Server-render-safe (no useRouter, which throws under static
// markup). The honesty copy is under test: the control refreshes the dashboard's
// READ of the warehouse and must NOT claim to trigger collectors / poke nodes.

function render(props: Partial<Parameters<typeof RefreshControl>[0]> = {}): string {
  return renderToStaticMarkup(createElement(RefreshControl, props));
}

describe("RefreshControl — honest manual refresh button", () => {
  it("renders a button with the honest read aria-label 'Refresh data'", () => {
    expect(render()).toContain('aria-label="Refresh data"');
  });

  it("carries an honest tooltip: re-reads the warehouse, does NOT force a node collection", () => {
    const html = render();
    // honest READ framing present
    expect(html).toMatch(/re-reads the warehouse/i);
    // explicit negation — never claims to trigger collectors / poke nodes
    expect(html).toMatch(/does not force a node collection/i);
  });
});

describe("RefreshControl — auto-refresh toggle", () => {
  it("renders a role=switch toggle (aria-pressed) with the honest 'Auto · 60s' label", () => {
    const html = render();
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("Auto · 60s");
  });
});

describe("RefreshControl — keyboard focus affordance (audit B9)", () => {
  it("gives both the refresh button and the auto toggle a navy focus-visible ring", () => {
    const html = render();
    // FOCUS_RING is spread onto both controls (2 occurrences)
    expect(html.match(/focus-visible:ring-df-brand/g)?.length).toBe(2);
  });
});

describe("RefreshControl — pending visual (defaultPending test hook)", () => {
  it("disables the button and spins the icon when pending", () => {
    const html = render({ defaultPending: true });
    expect(html).toMatch(/<button[^>]*disabled/);
    expect(html).toContain("animate-spin");
  });

  it("neither disables the refresh button nor spins the icon at rest", () => {
    const html = render();
    expect(html).not.toContain("animate-spin");
  });
});
