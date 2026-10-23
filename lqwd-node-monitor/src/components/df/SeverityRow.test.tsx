import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SeverityRow } from "@/components/df/SeverityRow";
import { CategoryIcon } from "@/components/df/CategoryIcon";
import { severityAccent, severityText, type Severity } from "@/components/df/Severity";
import { feeMsatToSat, formatSats } from "@/lib/format/units";

// =====================================================
// SeverityRow.test.tsx — condensed one-line record (D-R5/D-R6)
// =====================================================
// Asserts the row matches the approved sketch `.child` grammar: a leading NEUTRAL
// category icon (or the legacy square dot), a SINGLE label, and a right-pinned
// severity-colored STATE word — no layer chip, and no note that echoes the label. A
// sat-valued note matches the AFM-002 `formatSats` output (never a raw integer).

const SEVERITIES: Severity[] = ["critical", "warning", "watch", "healthy", "stale"];

describe("SeverityRow", () => {
  it("renders the label + severity-colored status in every state", () => {
    for (const sev of SEVERITIES) {
      const html = renderToStaticMarkup(
        createElement(SeverityRow, {
          sev,
          id: `node-${sev}`,
          status: "state",
          statusSev: sev,
        }),
      );
      expect(html).toContain(`node-${sev}`);
      // the right-pinned status carries the severityText color for this state
      expect(html).toContain(severityText[sev]);
    }
  });

  it("uses a 2px SQUARE accent dot when NO category icon (legacy), never round/sev-label", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityRow, { sev: "critical", id: "lqwd-rtr-04" }),
    );
    expect(html).toContain("rounded-[2px]");
    expect(html).toContain(severityAccent.critical);
    expect(html).not.toContain("rounded-full");
    expect(html).not.toContain("open →");
    expect(html).not.toContain("CRITICAL");
  });

  it("leads with a NEUTRAL category icon (no square dot) and renders NO layer chip", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityRow, {
        sev: "warning",
        id: "Address List Sync",
        icon: createElement(CategoryIcon, { category: "service" }),
        // deprecated layer chip must be a no-op — never rendered
        kind: "services",
        status: "stale 6h",
        statusSev: "stale",
      }),
    );
    // the category glyph leads
    expect(html).toContain("<svg");
    // no legacy square severity dot when an icon leads
    expect(html).not.toContain("rounded-[2px]");
    // the layer `kind` chip is gone
    expect(html).not.toContain("services");
  });

  it("SUPPRESSES the note when it string-equals the label (kills the echo)", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityRow, {
        sev: "warning",
        id: "Address List Sync",
        note: "Address List Sync",
      }),
    );
    // the label appears exactly ONCE — the echoed note is dropped
    expect(html.split("Address List Sync").length - 1).toBe(1);
  });

  it("keeps a note that DIFFERS from the label", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityRow, {
        sev: "warning",
        id: "lqwd-rtr-04",
        note: "2 HTLCs at risk",
      }),
    );
    expect(html).toContain("lqwd-rtr-04");
    expect(html).toContain("2 HTLCs at risk");
  });

  it("renders as a next/link click-through when href is given", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityRow, {
        sev: "warning",
        id: "18 channels need a fee raise",
        href: "/deadbeef/fees",
        status: "fees →",
      }),
    );
    expect(html).toContain("<a");
    expect(html).toContain("/deadbeef/fees");
  });

  it("renders a sat-valued note via formatSats (no raw integer)", () => {
    const feeMsat = 1_234_567_000; // → 1,234,567 sats
    const formatted = formatSats(feeMsatToSat(feeMsat));
    expect(formatted).toBe("1,234,567");

    const html = renderToStaticMarkup(
      createElement(SeverityRow, {
        sev: "warning",
        id: "lqwd-rtr-02",
        note: `routing fee ${formatted} sats`,
      }),
    );
    expect(html).toContain("1,234,567");
    expect(html).not.toContain("1234567");
  });

  it("drops optional columns cleanly when omitted", () => {
    const html = renderToStaticMarkup(
      createElement(SeverityRow, { sev: "watch", id: "host-03" }),
    );
    expect(html).toContain("host-03");
    // still a valid, throw-free render with only the label + legacy dot
    expect(html).toContain("rounded-[2px]");
  });
});
