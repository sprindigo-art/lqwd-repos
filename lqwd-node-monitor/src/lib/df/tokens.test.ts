import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DF } from "@/lib/df/tokens";

// Read the canonical CSS once. tokens.ts is the SSR-safe mirror; this test proves
// the mirror never drifts from globals.css (DS-01 parity guarantee).
const globalsCss = readFileSync(
  fileURLToPath(new URL("../../app/globals.css", import.meta.url)),
  "utf8",
);

// CSS var-name (e.g. `--color-df-ok-text`) → DF key (e.g. `okText`).
function cssVarToKey(varName: string): string {
  // strip the leading `--{color|radius|shadow}-df-` namespace prefix
  const bare = varName.replace(/^--(?:color|radius|shadow)-df-/, "");
  return bare.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// Extract every df-* color/radius/shadow var NAME declared in globals.css.
function cssDfVarNames(): string[] {
  const matches = globalsCss.matchAll(/(--(?:color|radius|shadow)-df-[a-z-]+)\s*:/g);
  return [...matches].map((m) => m[1]);
}

describe("DF token mirror — CSS↔TS parity", () => {
  const cssVars = cssDfVarNames();
  const cssKeys = new Set(cssVars.map(cssVarToKey));
  const tsKeys = new Set(Object.keys(DF));

  it("declares at least the full df-* surface in globals.css", () => {
    // sanity: the extraction found the block (guards against a silent empty match)
    expect(cssVars.length).toBeGreaterThanOrEqual(30);
  });

  it("every globals.css df-* var has a matching DF key (no missing mirror)", () => {
    const missing = [...cssKeys].filter((k) => !tsKeys.has(k));
    expect(missing).toEqual([]);
  });

  it("every DF key maps to a real globals.css df-* var (no orphan TS keys)", () => {
    const orphans = [...tsKeys].filter((k) => !cssKeys.has(k));
    expect(orphans).toEqual([]);
  });

  it("color values are identical between CSS and DF (1:1 value parity)", () => {
    for (const varName of cssVars) {
      if (!varName.startsWith("--color-df-")) continue;
      const re = new RegExp(`${varName}\\s*:\\s*(#[0-9A-Fa-f]{6})`);
      const m = globalsCss.match(re);
      if (!m) continue; // var() indirection (fonts) — colors are hex literals
      const key = cssVarToKey(varName) as keyof typeof DF;
      expect(DF[key]?.toUpperCase()).toBe(m[1].toUpperCase());
    }
  });
});

describe("severity ramp is set-disjoint from chrome/brand navy", () => {
  const chromeBrand = new Set([DF.chrome.toUpperCase(), DF.brand.toUpperCase()]);
  const ramp = [
    DF.critical,
    DF.warning,
    DF.watch,
    DF.ok,
    DF.okText,
    DF.staleDot,
    DF.staleText,
  ];

  it("no severity hue equals #13284F (chrome) or #1A3C79 (brand)", () => {
    for (const hue of ramp) {
      expect(chromeBrand.has(hue.toUpperCase())).toBe(false);
    }
  });
});
