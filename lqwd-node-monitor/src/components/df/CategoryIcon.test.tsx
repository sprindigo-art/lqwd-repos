import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CategoryIcon,
  categoryFor,
  categoryIcon,
  type CategoryKind,
} from "@/components/df/CategoryIcon";

// =====================================================
// CategoryIcon.test.tsx — presentation-only category mapping (D-R5)
// =====================================================
// Asserts the (layer, feeKind) → CategoryKind mapping (incl. feeKind precedence),
// that every kind has a lucide glyph, and that the rendered glyph is a SINGLE
// neutral-hue <svg> — never a severity color (T-12-14-03) and never an action.

const KINDS: CategoryKind[] = [
  "node",
  "service",
  "host",
  "storage",
  "chain",
  "fee-raise",
  "fee-lower",
];

describe("categoryFor", () => {
  it("maps each incident layer to its category kind", () => {
    expect(categoryFor("nodes")).toBe("node");
    expect(categoryFor("services")).toBe("service");
    expect(categoryFor("hosts")).toBe("host");
    expect(categoryFor("storage")).toBe("storage");
    expect(categoryFor("bitcoind")).toBe("chain");
  });

  it("lets feeKind WIN over the layer (fee-raise / fee-lower precedence)", () => {
    expect(categoryFor("nodes", "raise")).toBe("fee-raise");
    expect(categoryFor("nodes", "lower")).toBe("fee-lower");
    // precedence holds even when the layer alone would map elsewhere
    expect(categoryFor("services", "raise")).toBe("fee-raise");
    expect(categoryFor("hosts", "lower")).toBe("fee-lower");
  });
});

describe("categoryIcon map", () => {
  it("has a lucide icon component for every category kind", () => {
    for (const k of KINDS) {
      expect(categoryIcon[k]).toBeDefined();
    }
  });
});

describe("CategoryIcon", () => {
  it("renders a single NEUTRAL-hue glyph, never a severity color", () => {
    const html = renderToStaticMarkup(createElement(CategoryIcon, { category: "service" }));
    // exactly one lucide <svg>
    expect(html.split("<svg").length - 1).toBe(1);
    // neutral, presentation-only hue
    expect(html).toContain("text-df-faint");
    expect(html).toContain("aria-hidden");
    // NEVER a severity text/accent color
    expect(html).not.toContain("text-df-critical");
    expect(html).not.toContain("text-df-warning");
    expect(html).not.toContain("text-df-watch");
    expect(html).not.toContain("bg-df-critical");
  });

  it("renders each category as exactly one glyph without throwing", () => {
    for (const k of KINDS) {
      const html = renderToStaticMarkup(createElement(CategoryIcon, { category: k }));
      expect(html.split("<svg").length - 1).toBe(1);
    }
  });
});
