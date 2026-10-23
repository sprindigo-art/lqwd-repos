import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LiquidityGauge, type LiquidityGaugeProps } from "@/components/node/LiquidityGauge";

// =====================================================
// LiquidityGauge.test.tsx — the G4 neutral gauge render lock
// =====================================================
// The behavioral coverage for the liquidity gauge: a local-heavy split pushes the
// thumb past centre; an empty split renders the honest-empty copy and NO thumb.
// DEP-FREE per RESEARCH §H — `renderToStaticMarkup` under `environment: "node"`, no
// jsdom / @testing-library (mirrors NodeFeeEnqueue.test.tsx).

function props(overrides: Partial<LiquidityGaugeProps> = {}): LiquidityGaugeProps {
  return {
    localSat: 500_000,
    remoteSat: 500_000,
    capacitySat: 1_000_000,
    localShare: 0.5,
    ...overrides,
  };
}

/** Extract the numeric `left:NN%` offset from a testid-tagged element's style. */
function thumbLeftPercent(html: string): number | null {
  const match = html.match(/data-testid="liquidity-thumb"[^>]*style="left:([\d.]+)%"/);
  return match ? Number(match[1]) : null;
}

describe("LiquidityGauge — lean indicator", () => {
  it("(1) a local-heavy split places the thumb past centre (> 50%)", () => {
    const html = renderToStaticMarkup(
      createElement(
        LiquidityGauge,
        props({ localSat: 900_000, remoteSat: 100_000, localShare: 0.9 }),
      ),
    );
    const left = thumbLeftPercent(html);
    expect(left).not.toBeNull();
    expect(left as number).toBeGreaterThan(50);
  });

  it("(2) a remote-heavy split places the thumb before centre (< 50%)", () => {
    const html = renderToStaticMarkup(
      createElement(
        LiquidityGauge,
        props({ localSat: 100_000, remoteSat: 900_000, localShare: 0.1 }),
      ),
    );
    const left = thumbLeftPercent(html);
    expect(left as number).toBeLessThan(50);
  });

  it("(3) renders the local share via AFM-002 formatPercent", () => {
    const html = renderToStaticMarkup(
      createElement(LiquidityGauge, props({ localSat: 900_000, remoteSat: 100_000, localShare: 0.9 })),
    );
    expect(html).toContain("90.0%");
    // sat legend routes through formatSats (thousands separators).
    expect(html).toContain("900,000");
  });
});

describe("LiquidityGauge — honest empty", () => {
  it("(1) capacitySat 0 renders the honest-empty copy and NO thumb", () => {
    const html = renderToStaticMarkup(
      createElement(
        LiquidityGauge,
        props({ localSat: 0, remoteSat: 0, capacitySat: 0, localShare: null }),
      ),
    );
    expect(html).toContain("No channel liquidity to report.");
    expect(html).not.toContain('data-testid="liquidity-thumb"');
    expect(html).toContain('data-empty="true"');
  });

  it("(2) a null share (no routable balance) also renders honest-empty", () => {
    const html = renderToStaticMarkup(
      createElement(
        LiquidityGauge,
        props({ localSat: 0, remoteSat: 0, capacitySat: 1_000_000, localShare: null }),
      ),
    );
    expect(html).toContain("No channel liquidity to report.");
    expect(html).not.toContain('data-testid="liquidity-thumb"');
  });
});

describe("LiquidityGauge — compact variant", () => {
  it("renders the sm variant with a thumb but no sat legend", () => {
    const html = renderToStaticMarkup(
      createElement(LiquidityGauge, props({ size: "sm", localShare: 0.7 })),
    );
    expect(html).toContain('data-testid="liquidity-thumb"');
    // compact omits the "local … sat / remote … sat" legend.
    expect(html).not.toContain("local 500,000 sat");
  });
});
