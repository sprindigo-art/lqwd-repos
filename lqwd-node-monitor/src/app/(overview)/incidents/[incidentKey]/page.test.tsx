import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { GroupedIncident } from "@/lib/overview/incidents";

// =====================================================
// incidents/[incidentKey]/page.test.tsx — INC-01 D-10 render contract
// =====================================================
// Proves the Incident Detail RSC composes the regions in the A1 two-column DOM
// order — reading spine (status header → AI read → why-chain → grouped children)
// followed by the blast-radius sticky rail — that a host-only incident (no blast
// targets) omits the blast region, and that
// the header severity chip carries a severity-ramp class (never navy).
//
// SSR-only: the async Server Component is awaited to its element, then rendered
// with `renderToStaticMarkup` (no jsdom). The shell + the two server-backed reads
// + the client-action modules are mocked so the render exercises only composition.

// The nav shell renders its children verbatim — the region-order assertions run
// against the composed body, not the rail chrome.
vi.mock("@/components/df/NavRailShell", () => ({
  NavRailShell: ({ children }: { children: React.ReactNode }) => children,
}));

// Server-backed reads — the page selects ONE incident from this set by `.key`.
const fixtures: Record<string, GroupedIncident> = {};
vi.mock("@/lib/overview/load-incidents", () => ({
  loadIncidents: vi.fn(async () => Object.values(fixtures)),
}));
vi.mock("@/lib/db/read/incident-tracking", () => ({
  loadActiveTracking: vi.fn(async () => []),
}));

// Client-action modules the composed client components import — mocked so their
// server-only DB/LLM graph never loads under node.
vi.mock("@/app/actions/incident-tracking", () => ({
  ackIncident: vi.fn(),
  assignIncident: vi.fn(),
  snoozeIncident: vi.fn(),
  unsnoozeIncident: vi.fn(),
}));
vi.mock("@/app/actions/narrate-incident", () => ({
  narrateIncident: vi.fn(async () => ({ ok: false, error: "mocked" })),
}));

import IncidentDetailPage from "@/app/(overview)/incidents/[incidentKey]/page";

/** A child leaf helper (engine-order preserved by the assembler). */
function child(over: Partial<GroupedIncident>): GroupedIncident {
  return {
    key: "node:aaa",
    layer: "nodes",
    severity: "warning",
    stale: false,
    why: "channel state degraded",
    entityLabel: "lqwd-rtr-04",
    asOf: new Date("2026-07-20T14:08:00Z"),
    children: [],
    ...over,
  };
}

/** Render the page for a given key to its static SSR markup. */
async function renderPage(incidentKey: string): Promise<string> {
  const element = await IncidentDetailPage({ params: Promise.resolve({ incidentKey }) });
  return renderToStaticMarkup(element);
}

describe("IncidentDetailPage — D-10 region order", () => {
  it("emits the regions in status→AI→why-chain→children (spine) then blast (rail) DOM order", async () => {
    fixtures["host-03"] = {
      key: "host-03",
      layer: "hosts",
      severity: "critical",
      stale: false,
      why: "2 alerts on host-03",
      entityLabel: "host-03",
      asOf: new Date("2026-07-20T14:08:00Z"),
      children: [
        child({ key: "node:aaa", severity: "critical", why: "force-close risk" }),
        child({
          key: "service:host-03:bitcoind",
          layer: "services",
          severity: "warning",
          entityLabel: "bitcoind",
          why: "running but not functioning",
        }),
      ],
    };

    const html = await renderPage("host-03");

    const iHeader = html.indexOf("CRITICAL"); // status-header severity chip
    const iAi = html.indexOf("AI read"); // AI-read region eyebrow
    const iWhy = html.indexOf("Detection chain"); // why-chain region eyebrow
    const iBlast = html.indexOf("Blast radius"); // blast-radius region eyebrow
    const iChildren = html.indexOf("Grouped child alerts"); // grouped-children eyebrow

    for (const idx of [iHeader, iAi, iWhy, iBlast, iChildren]) {
      expect(idx).toBeGreaterThan(-1);
    }
    // A1 two-column layout: the reading spine (status→AI→why-chain→children) comes
    // first in DOM order; the blast-radius instrument lives in the sticky right rail
    // rendered AFTER the spine (it still reads top-right visually via the grid).
    expect(iHeader).toBeLessThan(iAi);
    expect(iAi).toBeLessThan(iWhy);
    expect(iWhy).toBeLessThan(iChildren);
    expect(iChildren).toBeLessThan(iBlast);
  });

  it("header severity chip carries a severity-ramp class (never navy)", async () => {
    fixtures["host-03"] = {
      key: "host-03",
      layer: "hosts",
      severity: "critical",
      stale: false,
      why: "2 alerts on host-03",
      entityLabel: "host-03",
      asOf: new Date("2026-07-20T14:08:00Z"),
      children: [child({ key: "node:aaa", severity: "critical", why: "force-close risk" })],
    };

    const html = await renderPage("host-03");
    // The chip wears the critical ramp accent — a severity class, not navy chrome.
    expect(html).toContain("bg-df-critical");
  });

  it("omits the blast-radius region for a host-only incident (no blast targets)", async () => {
    // A fee-summary-only incident: buildBlastTargets excludes fee children, so
    // there are zero impacted targets → the blast region is omitted entirely.
    fixtures["host-07"] = {
      key: "host-07",
      layer: "hosts",
      severity: "warning",
      stale: false,
      why: "1 alert on host-07",
      entityLabel: "host-07",
      asOf: new Date("2026-07-20T14:08:00Z"),
      children: [
        child({
          key: "fee:raise:pk",
          severity: "warning",
          entityLabel: "lqwd-rtr-09",
          why: "2 channels need a fee raise",
          asOf: null,
          count: 2,
          href: "/pk/fees",
          feeKind: "raise",
        }),
      ],
    };

    const html = await renderPage("host-07");

    // Why-chain still renders (fee child is an event); blast region is absent.
    expect(html.indexOf("Detection chain")).toBeGreaterThan(-1);
    expect(html.indexOf("Grouped child alerts")).toBeGreaterThan(-1);
    expect(html.indexOf("Blast radius")).toBe(-1);
  });
});
