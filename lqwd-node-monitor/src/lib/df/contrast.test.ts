import { describe, expect, it } from "vitest";

import { DF } from "@/lib/df/tokens";

// ── WCAG 2.1 relative-luminance + contrast-ratio (pure functions, no deps) ──
// https://www.w3.org/TR/WCAG21/#dfn-relative-luminance & #dfn-contrast-ratio.
// Local implementation so the AA guarantees are proven from first principles
// against the locked token hexes — no runtime CSS, no getComputedStyle.

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

/** WCAG contrast ratio between two hex colors (≥1, order-independent). */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#FFFFFF";

const AA_TEXT = 4.5; // WCAG AA normal text
const AA_LARGE = 3.0; // WCAG AA large text (≥18pt, or ≥14pt bold) / non-text UI

describe("WCAG AA — TEXT roles ≥4.5:1 on their stated background", () => {
  it("ok-text on white ≥ 4.5:1 (5.32)", () => {
    expect(contrastRatio(DF.okText, WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("muted on white ≥ 4.5:1 (4.50 — label role, not body)", () => {
    expect(contrastRatio(DF.muted, WHITE)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("lnd on lnd-bg ≥ 4.5:1 (6.25)", () => {
    expect(contrastRatio(DF.lnd, DF.lndBg)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("ldk on ldk-bg ≥ 4.5:1 (5.14)", () => {
    expect(contrastRatio(DF.ldk, DF.ldkBg)).toBeGreaterThanOrEqual(AA_TEXT);
  });
});

describe("WCAG AA-LARGE — stale-text is a large/badge label role (≥3:1, NOT body text)", () => {
  // The locked prototype hex #A9912F is gold/amber; it physically cannot reach
  // 4.5:1 on any light surface (3.10 on white, 2.72 on its tint). Stale is a
  // no-data INDICATOR rendered as a ≥14pt bold mono badge label — so it is held
  // to the AA-large bar (3:1), and is explicitly NOT permitted as small body text.
  it("stale-text on white ≥ 3:1 (3.10 — AA-large only)", () => {
    expect(contrastRatio(DF.staleText, WHITE)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("stale-text on white is BELOW 4.5:1 (documents the small-body-text limit)", () => {
    expect(contrastRatio(DF.staleText, WHITE)).toBeLessThan(AA_TEXT);
  });
});

describe("WCAG — NON-TEXT roles (dots/accents) ≥3:1 on white", () => {
  it("ok (dot/spark) on white ≥ 3:1 (3.43)", () => {
    expect(contrastRatio(DF.ok, WHITE)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("critical (dot/icon) on white ≥ 3:1 (4.38)", () => {
    expect(contrastRatio(DF.critical, WHITE)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("warning (dot/icon) on white ≥ 3:1 (3.44)", () => {
    expect(contrastRatio(DF.warning, WHITE)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("watch (dot/icon) on white ≥ 3:1 (4.12)", () => {
    expect(contrastRatio(DF.watch, WHITE)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe("faint is DECORATIVE-only — fails both AA bars as text (misuse guard)", () => {
  it("faint on white fails 4.5:1 (text) AND 3:1 (large/non-text)", () => {
    const r = contrastRatio(DF.faint, WHITE);
    expect(r).toBeLessThan(AA_TEXT);
    expect(r).toBeLessThan(AA_LARGE);
  });
});
