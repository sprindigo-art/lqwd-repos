import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TwoAxisPip } from "@/components/df/TwoAxisPip";

// =====================================================
// TwoAxisPip.test.tsx — green-only-when-both + G4 tile fidelity
// =====================================================
// Asserts the combined health pip is green/healthy ONLY when both running AND
// functioning are true; the "up but dead" state (running, not functioning) renders
// a DISTINCT alarming treatment — red tile chrome + a PULSING alarm dot + a red
// "Functioning" box; the two axes are BOXED inset sub-panels (not inline spans);
// and the divided footer carries a "last run" row. Numerics render without throwing.

describe("TwoAxisPip", () => {
  it("renders green/healthy ONLY when both running and functioning", () => {
    const html = renderToStaticMarkup(
      createElement(TwoAxisPip, { running: true, functioning: true }),
    );
    expect(html).toContain("HEALTHY");
    // healthy status chip wears the green tint
    expect(html).toContain("bg-df-ok-tint");
    expect(html).toContain("bg-df-ok");
    // healthy tile uses the green left accent bar, NOT the critical one
    expect(html).toContain("border-l-df-ok");
    // a healthy pip must NOT carry the up-but-dead label
    expect(html).not.toContain("UP · NOT HEALTHY");
    // and the healthy alarm dot does NOT pulse
    expect(html).not.toContain("animate-[v2pulse");
  });

  it("renders a distinct, PULSING alarm state for up-but-dead (running, not functioning)", () => {
    const html = renderToStaticMarkup(
      createElement(TwoAxisPip, { running: true, functioning: false }),
    );
    expect(html).toContain("UP · NOT HEALTHY");
    // red tile chrome — critical left accent bar + tint
    expect(html).toContain("border-l-df-critical");
    expect(html).toContain("bg-df-critical-tint");
    // the alarm dot PULSES via the v2pulse keyframe
    expect(html).toContain("animate-[v2pulse_1.5s_infinite]");
    // the up-but-dead tile is NOT the healthy green left bar
    expect(html).not.toContain("border-l-df-ok");
  });

  it("renders the two axes as BOXED inset sub-panels with captions", () => {
    const html = renderToStaticMarkup(
      createElement(TwoAxisPip, { running: true, functioning: false }),
    );
    // bordered inset boxes (rounded-lg + border), not inline spans
    expect(html).toContain("rounded-lg");
    // both axis captions present
    expect(html).toContain("Running");
    expect(html).toContain("Functioning");
    // the failing Functioning box is red-tinted
    expect(html).toContain("bg-df-critical-tint");
    // passing Running box uses the neutral inset wash
    expect(html).toContain("bg-df-surface-sub");
  });

  it("renders DOWN with a pulsing alarm dot when not running", () => {
    const html = renderToStaticMarkup(
      createElement(TwoAxisPip, { running: false, functioning: false }),
    );
    expect(html).toContain("DOWN");
    expect(html).toContain("border-l-df-critical");
    expect(html).toContain("animate-[v2pulse_1.5s_infinite]");
    expect(html).not.toContain("border-l-df-ok");
  });

  it("renders the last-run footer row (red when failed) + heartbeat + errors", () => {
    const html = renderToStaticMarkup(
      createElement(TwoAxisPip, {
        running: true,
        functioning: false,
        name: "addressBalances",
        heartbeat: "stale 41m",
        lastRun: "failed 41m ago",
        errorCount: 14,
      }),
    );
    // last-run row present and red on failure
    expect(html).toContain("last run");
    expect(html).toContain("failed 41m ago");
    expect(html).toContain("text-df-critical");
    // last heartbeat row, gold when stale
    expect(html).toContain("last heartbeat");
    expect(html).toContain("stale 41m");
    expect(html).toContain("text-df-stale-text");
    // errors row
    expect(html).toContain("errors · 1h");
    expect(html).toContain("14");
    // service name header
    expect(html).toContain("addressBalances");
  });

  it("renders a healthy last-run (non-failed) without the red color", () => {
    const html = renderToStaticMarkup(
      createElement(TwoAxisPip, {
        running: true,
        functioning: true,
        heartbeat: "8s ago",
        lastRun: "2m ago · ok",
        errorCount: 0,
      }),
    );
    expect(html).toContain("2m ago · ok");
    expect(html).toContain("8s ago");
    // a non-failed last run is muted, not critical-colored on its value
    expect(html).toContain("text-df-muted");
  });
});

// =====================================================
// SVC-01 lock — three-way combinedState precedence + up-but-dead distinctness
// =====================================================
// The load-bearing SVC-01 invariant: green ONLY when both axes; the three combined
// states (HEALTHY / UP·NOT HEALTHY / DOWN) are mutually distinct in the rendered
// output so up-but-dead can never be mistaken for HEALTHY nor collapsed into DOWN.
// TwoAxisPip source is LOCKED — this suite PINS the precedence, it does not change it.

describe("TwoAxisPip — three-way precedence + up-but-dead distinctness (SVC-01 lock)", () => {
  const render = (running: boolean, functioning: boolean) =>
    renderToStaticMarkup(createElement(TwoAxisPip, { running, functioning }));

  it("running && functioning → HEALTHY / ok=true (green ONLY when both)", () => {
    const html = render(true, true);
    expect(html).toContain("HEALTHY");
    // HEALTHY is the ok=true state: green accent + green chip, no pulse.
    expect(html).toContain("border-l-df-ok");
    expect(html).toContain("bg-df-ok-tint");
    expect(html).not.toContain("animate-[v2pulse");
    // and it carries NEITHER of the two failure labels.
    expect(html).not.toContain("UP · NOT HEALTHY");
    // "DOWN" must not appear as the status label for a healthy tile.
    expect(html).not.toMatch(/>[\s]*DOWN/);
  });

  it("running && !functioning → UP · NOT HEALTHY / ok=false, distinct from HEALTHY", () => {
    const html = render(true, false);
    expect(html).toContain("UP · NOT HEALTHY");
    // ok=false chrome — NOT the healthy green accent.
    expect(html).not.toContain("border-l-df-ok");
    expect(html).toContain("border-l-df-critical");
    // it is the up-but-dead state, NOT the DOWN state.
    expect(html).not.toMatch(/>[\s]*DOWN/);
    // it must not be mislabeled HEALTHY.
    expect(html).not.toContain(">HEALTHY");
  });

  it("!running → DOWN / ok=false, distinct from up-but-dead", () => {
    const html = render(false, false);
    expect(html).toContain("DOWN");
    expect(html).not.toContain("border-l-df-ok");
    expect(html).toContain("border-l-df-critical");
    // DOWN is NOT the up-but-dead label.
    expect(html).not.toContain("UP · NOT HEALTHY");
    expect(html).not.toContain(">HEALTHY");
  });

  it("the up-but-dead tile carries the red Functioning box + pulsing alarm dot (load-bearing SVC-01 signal)", () => {
    const html = render(true, false);
    // the Functioning axis box is red-tinted (the failing-axis treatment)…
    expect(html).toContain("bg-df-critical-tint");
    expect(html).toContain("Functioning");
    // …the Running box stays neutral (the process IS up)…
    expect(html).toContain("bg-df-surface-sub");
    // …and the alarm dot PULSES so the up-but-dead state reads unmistakably.
    expect(html).toContain("animate-[v2pulse_1.5s_infinite]");
  });

  it("green appears ONLY for running&&functioning across the full truth table", () => {
    // The precedence table proven in one place: only the (true,true) corner is green.
    expect(render(true, true)).toContain("border-l-df-ok");
    expect(render(true, false)).not.toContain("border-l-df-ok");
    expect(render(false, true)).not.toContain("border-l-df-ok");
    expect(render(false, false)).not.toContain("border-l-df-ok");
  });
});
