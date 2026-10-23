import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NavRailShell, type FleetCounts, type ViewTab } from "@/components/df/NavRailShell";

// =====================================================
// NavRailShell.test.tsx — G5 top-bar operator instrumentation (gap-analysis #8)
// =====================================================
// The shell now ships the prototype's top-bar parts as reusable, props-driven
// pieces: fleet ramp + tally, view-tab toggle, live-poll pill, and the bottom
// avatar. These are SSR-rendered via renderToStaticMarkup (no jsdom — the
// workspace dep-free render path) and asserted against the static markup.
//
// DS-01 invariant under test: the ramp/tally consume the df severity TOKENS
// (bg-df-critical / text-df-warning / …), never chrome/brand for health, and the
// chrome (rail, top bar) carries no severity color. The toggle/pill/avatar are
// presentational and Server-safe (no client onClick).

const INCIDENT_COUNTS: FleetCounts = { crit: 4, warn: 1, watch: 2, ok: 19 };
const ALL_CLEAR_COUNTS: FleetCounts = { crit: 0, warn: 0, watch: 0, ok: 26 };

function render(props: Partial<Parameters<typeof NavRailShell>[0]> = {}): string {
  // JSX rather than createElement: `children` is a REQUIRED prop on
  // NavRailShellProps, so passing it positionally to createElement fails
  // typecheck, while passing it inside the props object trips
  // react/no-children-prop. JSX satisfies both.
  const { children = <div>body</div>, ...rest } = props;
  return renderToStaticMarkup(
    <NavRailShell
      active="ops"
      title="Operations Center"
      subtitle="LQWD Technologies · fleet overview"
      {...rest}
    >
      {children}
    </NavRailShell>,
  );
}

describe("NavRailShell — fleet ramp bar", () => {
  it("renders one severity-tinted segment per non-zero bucket in crit→warn→watch→ok order", () => {
    const html = render({ counts: INCIDENT_COUNTS });
    expect(html).toContain('data-testid="fleet-ramp"');
    // every populated bucket paints its bright NON-TEXT severity hue
    expect(html).toContain("bg-df-critical");
    expect(html).toContain("bg-df-warning");
    expect(html).toContain("bg-df-watch");
    expect(html).toContain("bg-df-ok");
    // segments are proportional widths (4/26 = 15.4%, 19/26 = 73.1%)
    expect(html).toContain("width:15.4%");
    expect(html).toContain("width:73.1%");
    // chrome must never carry a health hue on the ramp track
    expect(html).toContain("bg-df-border");
  });

  it("collapses to a solid ok strip when the fleet is all-clear (no crit/warn/watch segments)", () => {
    const html = render({ counts: ALL_CLEAR_COUNTS });
    // only the ok segment renders at full width
    expect(html).toContain('data-ramp-seg="ok"');
    expect(html).toContain("width:100.0%");
    expect(html).not.toContain('data-ramp-seg="crit"');
    expect(html).not.toContain('data-ramp-seg="warn"');
    expect(html).not.toContain('data-ramp-seg="watch"');
  });

  it("renders NO fleet summary when counts are omitted — never a fabricated all-clear (U2)", () => {
    const html = render();
    expect(html).not.toContain('data-testid="fleet-summary"');
    expect(html).not.toContain('data-testid="fleet-ramp"');
    expect(html).not.toContain('data-ramp-seg="ok"');
  });

  it("renders an empty track without NaN widths when the fleet is empty", () => {
    const html = render({ counts: { crit: 0, warn: 0, watch: 0, ok: 0 } });
    expect(html).toContain('data-testid="fleet-ramp"');
    expect(html).not.toContain("NaN");
    expect(html).not.toContain('data-ramp-seg=');
  });
});

describe("NavRailShell — tally counts", () => {
  it("renders each count in its severity TEXT hue with the bucket label", () => {
    const html = render({ counts: INCIDENT_COUNTS });
    expect(html).toContain("text-df-critical");
    expect(html).toContain("text-df-warning");
    expect(html).toContain("text-df-watch");
    // ok uses the AA-text role, NOT the non-text bg hue, for its number text
    expect(html).toContain("text-df-ok-text");
    // the literal counts + labels appear
    expect(html).toContain("crit");
    expect(html).toContain("warn");
    expect(html).toContain("watch");
    expect(html).toContain(">4<");
    expect(html).toContain(">19<");
    // tabular numerals so counts don't jitter as they tick
    expect(html).toContain("tabular-nums");
  });

  it("reflects the all-clear counts (0 crit / 0 warn / 0 watch / 26 ok)", () => {
    const html = render({ counts: ALL_CLEAR_COUNTS });
    expect(html).toContain(">26<");
    // three zeros for crit/warn/watch
    expect(html).toContain(">0<");
  });

  it("can hide the fleet ramp + tally entirely on non-fleet pages", () => {
    const html = render({ showFleetSummary: false, counts: INCIDENT_COUNTS });
    expect(html).not.toContain('data-testid="fleet-summary"');
    expect(html).not.toContain('data-testid="fleet-ramp"');
  });
});

describe("NavRailShell — view-tab toggle", () => {
  // The toggle is DELIBERATELY default-off (overview-specific; every other
  // surface hides it) — these fixtures opt in via showViewToggle.
  it("defaults to the Mid-incident / All clear segmented control", () => {
    const html = render({ showViewToggle: true });
    expect(html).toContain('data-testid="view-toggle"');
    expect(html).toContain("Mid-incident");
    expect(html).toContain("All clear");
    expect(html).toContain("Preview");
    // first tab is active by default
    expect(html).toContain('data-view-tab="incident"');
    expect(html).toMatch(/data-view-tab="incident" data-active="true"/);
  });

  it("marks the segment matching activeView as selected (active chip + aria-selected)", () => {
    const html = render({ showViewToggle: true, activeView: "allclear" });
    // the allclear segment is the active chip (attribute order-independent)
    expect(html).toMatch(/<span role="tab" aria-selected="true" data-view-tab="allclear" data-active="true"/);
    // the inactive incident tab must NOT be the active chip
    expect(html).not.toMatch(/data-view-tab="incident" data-active="true"/);
    // active segment lifts onto the white chip with a shadow
    expect(html).toContain("bg-df-surface");
    expect(html).toContain("shadow-df-rest");
  });

  it("renders Links (Server-safe navigation) when a tab supplies an href", () => {
    const tabs: ViewTab[] = [
      { key: "incident", label: "Mid-incident", href: "/?view=incident" },
      { key: "allclear", label: "All clear", href: "/?view=allclear" },
    ];
    const html = render({ showViewToggle: true, viewTabs: tabs, activeView: "incident" });
    expect(html).toContain('href="/?view=incident"');
    expect(html).toContain('href="/?view=allclear"');
  });

  it("accepts a custom leading label and can hide the toggle", () => {
    const labeled = render({ showViewToggle: true, viewLabel: "View" });
    expect(labeled).toContain("View");
    const hidden = render({ showViewToggle: false });
    expect(hidden).not.toContain('data-testid="view-toggle"');
  });
});

describe("NavRailShell — live-poll pill", () => {
  it("renders 'Live · polled Ns ago' with a seconds age and a green ring dot", () => {
    const html = render({ pollAgeSeconds: 4 });
    expect(html).toContain('data-testid="live-poll-pill"');
    expect(html).toContain("Live");
    expect(html).toContain("polled");
    expect(html).toContain("4s");
    // the status dot uses the ok hue (green), never a chrome/brand color
    expect(html).toContain("bg-df-ok");
  });

  it("formats minute- and hour-scale ages compactly", () => {
    expect(render({ pollAgeSeconds: 125 })).toContain("2m");
    expect(render({ pollAgeSeconds: 7200 })).toContain("2h");
  });

  it("clamps negative / non-finite ages to 0s (never renders a negative age)", () => {
    // assert against the pill's own bolded age node, not the whole shell markup
    // (Tailwind classes like `mb-5` legitimately contain "-5").
    const html = render({ pollAgeSeconds: -5 });
    expect(html).toContain('text-df-ink">0s</span>');
    expect(html).not.toContain('text-df-ink">-5');
  });

  it("renders an honest 'no data yet' stamp (never 'polled 0s ago') when no poll context exists", () => {
    const html = render();
    // U3: no pollSinceMs and no explicit demo age → NO fabricated live pill.
    expect(html).not.toContain('data-testid="live-poll-pill"');
    expect(html).not.toContain("Live · polled");
    expect(html).toContain('data-testid="poll-no-data"');
    expect(html).toContain("no data yet");
    // the honest stamp is legible content text — muted, never decorative faint
    expect(html).toMatch(/data-testid="poll-no-data"[^>]*text-df-muted/);
  });

  it("can be hidden entirely via showLivePill", () => {
    const hidden = render({ showLivePill: false });
    expect(hidden).not.toContain('data-testid="live-poll-pill"');
    expect(hidden).not.toContain('data-testid="poll-no-data"');
  });
});

describe("NavRailShell — operator nav (top-bar navigation)", () => {
  it("renders working links to the triage/approval surfaces so / is not a dead-end", () => {
    const html = render();
    expect(html).toContain('data-testid="operator-nav"');
    // the four default operator destinations (the home surface reads "Home")
    expect(html).toContain("Home");
    expect(html).toContain("Inbox");
    expect(html).toContain("Pending");
    expect(html).toContain("Queue");
    // each is a real navigation target
    expect(html).toContain('href="/inbox"');
    expect(html).toContain('href="/pending"');
    expect(html).toContain('href="/queue"');
  });

  it("underlines the active surface (df-brand) matching the shell active key", () => {
    const html = render({ active: "ops" });
    // the active item carries the brand affordance (text + underline)
    expect(html).toContain("text-df-brand");
    expect(html).toContain("bg-df-brand");
    // Ops Center is marked current
    expect(html).toContain('aria-current="page"');
  });

  it("renders a count badge ONLY when a real open-count is supplied (never fabricated)", () => {
    const withCount = render({
      opsNav: [
        { key: "ops", label: "Ops Center", href: "/" },
        { key: "inbox", label: "Inbox", href: "/inbox", count: 3 },
        { key: "pending", label: "Pending", href: "/pending" },
      ],
    });
    // the honest count renders in the critical hue
    expect(withCount).toContain('data-testid="opsnav-count-inbox"');
    expect(withCount).toContain(">3<");
    // pending has no count → no badge fabricated
    expect(withCount).not.toContain('data-testid="opsnav-count-pending"');
  });
});

describe("NavRailShell — honest PollAge pill (replaces the fake Live pill)", () => {
  it("renders the ticking data-age (no 'Live', no green-ring dot) when pollSinceMs is given", () => {
    const html = render({ pollSinceMs: 1_700_000_000_000 });
    expect(html).toContain('data-testid="poll-age"');
    expect(html).toContain("data as of");
    // first paint is age 0s (seeded from the fetch epoch — no hydration flash)
    expect(html).toContain("0s ago");
    // the honesty invariant: no live claim, no green status-dot ring, no fake pill
    expect(html).not.toContain("Live");
    expect(html).not.toContain("shadow-[0_0_0_3px_rgba(30,158,99");
    expect(html).not.toContain('data-testid="live-poll-pill"');
  });

  it("still renders the back-compat Live pill for the gallery (no pollSinceMs)", () => {
    const html = render({ pollAgeSeconds: 4 });
    expect(html).toContain('data-testid="live-poll-pill"');
    expect(html).toContain("Live");
    expect(html).not.toContain('data-testid="poll-age"');
  });
});

describe("NavRailShell — top-bar refresh control", () => {
  it("mounts the honest RefreshControl in the top bar on the default render", () => {
    expect(render()).toContain('aria-label="Refresh data"');
  });
});

describe("NavRailShell — chrome (rail, avatar, top bar) stays severity-free", () => {
  it("renders the bottom-pinned avatar affordance on the rail", () => {
    const html = render();
    expect(html).toContain('data-testid="rail-avatar"');
    // pinned to the bottom via margin-top:auto
    expect(html).toMatch(/data-testid="rail-avatar"[^>]*mt-auto/);
  });

  it("keeps the 60px navy rail + sticky top bar and renders the identity breadcrumb", () => {
    const html = render();
    expect(html).toContain("w-[60px]");
    expect(html).toContain("bg-df-chrome");
    // Audit B4: title/subtitle are wired into a compact top-bar breadcrumb so
    // page/entity identity persists on scroll (the masthead was previously dead).
    expect(html).toContain('data-testid="breadcrumb"');
    expect(html).toContain("Operations Center");
    expect(html).toContain("LQWD Technologies · fleet overview");
    // content body still renders inside the main
    expect(html).toContain("body");
  });

  it("gives every interactive control a navy focus-visible ring (audit B9)", () => {
    const html = render();
    // rail links, operator-nav links, and the refresh buttons all spread FOCUS_RING
    expect(html).toContain("focus-visible:ring-df-brand");
  });

  it("still renders the back-compat topBarEnd slot when provided", () => {
    const html = render({
      topBarEnd: createElement("span", null, "df-* tokens"),
    });
    expect(html).toContain("df-* tokens");
  });
});
