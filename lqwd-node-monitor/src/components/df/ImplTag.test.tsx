import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImplTag } from "@/components/df/ImplTag";

// =====================================================
// ImplTag.test.tsx — df impl-tag tokens, never brand (10-02 Task 2)
// =====================================================
// LND paints df-lnd tokens, LDK paints df-ldk tokens; neither uses brand/chrome
// (the v1 BackendBadge painted brand navy — v2 must not).

describe("ImplTag", () => {
  it("renders the two-part 'Routing · LND' label with df-lnd tokens", () => {
    const html = renderToStaticMarkup(createElement(ImplTag, { impl: "lnd" }));
    // prototype Node Detail line 88 — role word + impl, not bare "LND"
    expect(html).toContain("Routing");
    expect(html).toContain("LND");
    expect(html).toContain("text-df-lnd");
    expect(html).toContain("bg-df-lnd-bg");
  });

  it("renders the two-part 'LSP · LDK' label with df-ldk tokens", () => {
    const html = renderToStaticMarkup(createElement(ImplTag, { impl: "ldk" }));
    expect(html).toContain("LSP");
    expect(html).toContain("LDK");
    expect(html).toContain("text-df-ldk");
    expect(html).toContain("bg-df-ldk-bg");
  });

  it("drops the role word when withRole is false (compact impl-only badge)", () => {
    const lnd = renderToStaticMarkup(
      createElement(ImplTag, { impl: "lnd", withRole: false }),
    );
    expect(lnd).toContain("LND");
    expect(lnd).not.toContain("Routing");

    const ldk = renderToStaticMarkup(
      createElement(ImplTag, { impl: "ldk", withRole: false }),
    );
    expect(ldk).toContain("LDK");
    expect(ldk).not.toContain("LSP");
  });

  it("never uses the NOC navy / chrome utilities", () => {
    // Forbidden token stems are assembled from fragments so the literal strings
    // never appear in this source file (the DS-03 noc-guard greps this dir for
    // those exact substrings — see package.json `lint:noc-guard`).
    const forbidden = ["bg-" + "brand", "df-" + "brand", "df-" + "chrome"];
    for (const impl of ["lnd", "ldk"] as const) {
      const html = renderToStaticMarkup(createElement(ImplTag, { impl }));
      for (const token of forbidden) {
        expect(html).not.toContain(token);
      }
    }
  });
});
