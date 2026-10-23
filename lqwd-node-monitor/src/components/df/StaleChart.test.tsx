import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StaleChart } from "@/components/df/StaleChart";

// StaleChart is pure SVG (no Recharts) so it renders fully under the dep-free
// `renderToStaticMarkup` node path. It is the honest-stale fallback (DS-01):
// it must show the verbatim "NO FRESH DATA" + a last-good timestamp and must
// NEVER imply a fresh/healthy reading (no green line, no accent stroke).

describe("StaleChart (honest-stale placeholder)", () => {
  it("renders the hatched panel with verbatim 'NO FRESH DATA' and a last-good timestamp", () => {
    const html = renderToStaticMarkup(
      <StaleChart width={188} height={58} lastGoodLabel="last good 22m ago" />,
    );
    expect(html).toContain("NO FRESH DATA");
    expect(html).toContain("last good 22m ago");
    // locked prototype hatch fill + stripe + border colors
    expect(html).toContain("#F7F2E4"); // panel fill
    expect(html).toContain("#D9D2BC"); // diagonal stripes
    expect(html).toContain("#8A7426"); // bold NO-FRESH-DATA gold
    // it is an SVG (not a Recharts wrapper)
    expect(html).toContain("<svg");
    expect(html).not.toContain("recharts");
  });

  it("never renders a healthy/green evidence line", () => {
    const html = renderToStaticMarkup(<StaleChart width={188} height={58} />);
    // no ok/healthy green, no <polyline>/<path> evidence line
    expect(html).not.toContain("#1E9E63"); // DF.ok green
    expect(html).not.toContain("<polyline");
    expect(html).not.toContain("<path");
    // default copy present
    expect(html).toContain("last good 4h ago");
  });

  it("uses a unique clip id when given an idSuffix (no cross-chart collision)", () => {
    const html = renderToStaticMarkup(<StaleChart width={100} height={40} idSuffix="-b" />);
    expect(html).toContain('id="stale-clip-b"');
    expect(html).toContain('url(#stale-clip-b)');
  });
});
