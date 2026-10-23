import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AiReadPanel,
  AI_ALL_CLEAR_LEAD,
  type AiReadLine,
} from "@/components/df/AiReadPanel";

// =====================================================
// AiReadPanel.test.tsx — verbatim safety copy + inert text + ranked structure
// =====================================================
// T-10-04: the verbatim zero-credential safety label is rendered (grepped exact).
// T-10-03 / V14: a fixture advisory string containing <script> renders ESCAPED
// (React escaping — no live tag in output, no HTML sink).
// G3: numbered priority ranks + bold-lead/muted-body split + all-clear variant.
// (The optional ✕ dismiss control is an onClick affordance — it only renders when
// `onDismiss` is supplied; the SSR string tests below omit it so output is stable.)

const LINES: AiReadLine[] = [
  {
    sev: "critical",
    head: "host-03 chain backend stalled. ",
    body: "Three node alerts clear with it.",
  },
  {
    sev: "warning",
    head: "lqwd-rtr-02 fee policy drifted. ",
    body: "From peer median.",
  },
  { sev: "watch", head: "addressBalances service up. ", body: "But not functioning." },
];

describe("AiReadPanel", () => {
  it("renders the verbatim zero-credential safety copy", () => {
    const html = renderToStaticMarkup(createElement(AiReadPanel, { lines: LINES }));
    // exact spoofing-mitigation label (React escapes the `&` to `&amp;`)
    expect(html).toContain("AI · explains &amp; ranks, never runs commands");
    // exact zero-credential footnote
    expect(html).toContain("NodeMonitor runs nothing for you.");
  });

  it("sits on the navy bg-df-chrome surface", () => {
    const html = renderToStaticMarkup(createElement(AiReadPanel, { lines: LINES }));
    expect(html).toContain("bg-df-chrome");
  });

  it("renders advisory text as inert escaped plain text (no HTML sink)", () => {
    const injection: AiReadLine[] = [
      {
        sev: "critical",
        head: "<script>alert('x')</script> ",
        body: "pretend advisory <b>bold</b>",
      },
    ];
    const html = renderToStaticMarkup(createElement(AiReadPanel, { lines: injection }));
    // the angle brackets are escaped — NOT a live <script> tag
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>alert");
    // body markup is escaped too
    expect(html).toContain("&lt;b&gt;bold");
    // whitespace-pre-wrap proves inert plain-text rendering
    expect(html).toContain("whitespace-pre-wrap");
  });

  it("renders numbered priority ranks with per-severity accent squares", () => {
    const html = renderToStaticMarkup(createElement(AiReadPanel, { lines: LINES }));
    // ordinals 1/2/3 appear (the ranked-priority tags)
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
    // each rank square carries its severity accent class
    expect(html).toContain("bg-df-critical");
    expect(html).toContain("bg-df-warning");
    expect(html).toContain("bg-df-watch");
  });

  it("splits each line into a bold lead head and a muted body", () => {
    const html = renderToStaticMarkup(createElement(AiReadPanel, { lines: LINES }));
    // the bold-white lead clause
    expect(html).toContain("host-03 chain backend stalled.");
    expect(html).toContain("font-semibold");
    // the muted continuation body
    expect(html).toContain("Three node alerts clear with it.");
  });

  it("still renders legacy single-string `text` lines as the body (back-compat)", () => {
    const legacy: AiReadLine[] = [
      { sev: "warning", text: "legacy advisory line with no head/body split." },
    ];
    const html = renderToStaticMarkup(createElement(AiReadPanel, { lines: legacy }));
    expect(html).toContain("legacy advisory line with no head/body split.");
  });

  it("renders the all-clear calm variant with the verbatim lead", () => {
    const html = renderToStaticMarkup(
      createElement(AiReadPanel, {
        lines: [],
        allClear: true,
        calmDetail: "All 26 nodes are healthy and reporting fresh.",
      }),
    );
    // the frozen all-clear lead sentence
    expect(html).toContain(AI_ALL_CLEAR_LEAD);
    expect(html).toContain("Nothing needs you right now.");
    // the continuation detail
    expect(html).toContain("All 26 nodes are healthy and reporting fresh.");
    // calm mode shows no numbered ranks
    expect(html).not.toContain(">1<");
    // safety framing still present in calm mode
    expect(html).toContain("AI · explains &amp; ranks, never runs commands");
    expect(html).toContain("NodeMonitor runs nothing for you.");
  });

  it("omits the dismiss control when no onDismiss is supplied", () => {
    const html = renderToStaticMarkup(createElement(AiReadPanel, { lines: LINES }));
    expect(html).not.toContain("Dismiss AI read");
  });
});
