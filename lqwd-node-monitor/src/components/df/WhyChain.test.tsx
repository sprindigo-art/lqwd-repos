import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Severity } from "@/components/df/Severity";
import { WhyChain, type WhyChainEvent } from "@/components/df/WhyChain";

// WhyChain is plain HTML (no Recharts) so it renders fully under the dep-free
// `renderToStaticMarkup` node path. It is the detection-chain timeline spine
// (DS-02): per-severity dot/connector colors, mono timestamps, event text, and a
// transparent final connector so the spine terminates cleanly. The shape test
// pins the per-severity color grammar + the last-event termination.

const EVENTS: WhyChainEvent[] = [
  { time: "14:02", text: "RPC latency exceeded 30s on host-03.", severity: "healthy" },
  { time: "14:06", text: "verificationprogress frozen across two polls.", severity: "warning" },
  { time: "14:08", text: "Chain tip unchanged → host flagged.", severity: "warning" },
  { time: "14:11", text: "channel-state queries began failing.", severity: "critical" },
  { time: "14:24", text: "3 pending HTLCs within 12 blocks → CRITICAL.", severity: "critical" },
];

describe("WhyChain (detection-chain timeline spine)", () => {
  it("renders the eyebrow, every timestamp, and every event sentence", () => {
    const html = renderToStaticMarkup(<WhyChain events={EVENTS} />);
    // plain HTML, not a Recharts wrapper
    expect(html).not.toContain("recharts");
    expect(html).toContain("Why this is flagged · detection chain");
    for (const ev of EVENTS) {
      expect(html).toContain(ev.time);
      expect(html).toContain(ev.text);
    }
  });

  it("paints per-severity dot colors from the evColors ramp", () => {
    const all: WhyChainEvent[] = (
      ["critical", "warning", "watch", "healthy", "stale"] as Severity[]
    ).map((severity, i) => ({ time: `0${i}:00`, text: `evt ${severity}`, severity }));
    const html = renderToStaticMarkup(<WhyChain events={all} />);
    // each severity contributes its distinct dot hue (prototype evColors)
    expect(html).toContain("#E0392B"); // critical
    expect(html).toContain("#C8770A"); // warning
    expect(html).toContain("#0E8C84"); // watch
    expect(html).toContain("#9AA3B4"); // healthy → neutral "info" dot
    expect(html).toContain("#A9912F"); // stale
  });

  it("terminates the spine: the last connector is transparent", () => {
    const html = renderToStaticMarkup(<WhyChain events={EVENTS} />);
    // the final event's connector must be transparent (buildTimeline last-row rule)
    expect(html).toContain("transparent");
    // a non-terminal connector still carries a tint (critical line color)
    expect(html).toContain("#F1D3CF");
  });

  it("renders a single-event chain (the lone connector is transparent)", () => {
    const html = renderToStaticMarkup(
      <WhyChain events={[{ time: "14:00", text: "first signal", severity: "watch" }]} />,
    );
    expect(html).toContain("first signal");
    expect(html).toContain("transparent");
    // watch dot present
    expect(html).toContain("#0E8C84");
  });

  it("respects a custom eyebrow label", () => {
    const html = renderToStaticMarkup(<WhyChain events={EVENTS} label="Detection log" />);
    expect(html).toContain("Detection log");
    expect(html).not.toContain("Why this is flagged · detection chain");
  });
});
