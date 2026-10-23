import { describe, expect, it } from "vitest";
import { TAB_KEYS, type TabKey, type WindowKey } from "@/lib/console/config";
import { FLEET_PENDING_LINK, buildDeepLink } from "@/lib/insight/deeplink";

const VALID_PUBKEY = "a".repeat(66); // 66 lowercase hex chars

describe("buildDeepLink (D-04 / T-04-04)", () => {
  it("builds a relative console-tab path from a valid pubkey + whitelisted tab", () => {
    const link = buildDeepLink(VALID_PUBKEY, "closes");
    expect(link).toBe(`/${VALID_PUBKEY}/closes`);
    expect(link.startsWith("/")).toBe(true);
    expect(link).not.toContain("//");
    expect(link).not.toContain(":");
    expect(link).not.toContain("http");
  });

  it("accepts every whitelisted tab", () => {
    for (const tab of TAB_KEYS) {
      expect(buildDeepLink(VALID_PUBKEY, tab)).toBe(`/${VALID_PUBKEY}/${tab}`);
    }
  });

  it("appends the window param when a whitelisted window key is provided", () => {
    expect(buildDeepLink(VALID_PUBKEY, "fees", "7d")).toBe(`/${VALID_PUBKEY}/fees?window=7d`);
    expect(buildDeepLink(VALID_PUBKEY, "forwards", "90d")).toBe(
      `/${VALID_PUBKEY}/forwards?window=90d`,
    );
  });

  it("throws on a 65-char pubkey", () => {
    expect(() => buildDeepLink("a".repeat(65), "closes")).toThrow(/invalid pubkey/);
  });

  it("throws on uppercase hex", () => {
    expect(() => buildDeepLink("A".repeat(66), "closes")).toThrow(/invalid pubkey/);
  });

  it("throws on injection strings before any path is built", () => {
    const injections = [
      "javascript:alert(1)",
      "../../../etc/passwd",
      `${"a".repeat(66)}/../admin`,
      "%6a%61%76%61%73%63%72%69%70%74:alert(1)",
      `https://evil.example/${"a".repeat(40)}`,
    ];
    for (const bad of injections) {
      expect(() => buildDeepLink(bad, "closes")).toThrow(/invalid pubkey/);
    }
  });

  it("throws on non-whitelisted tabs", () => {
    for (const badTab of ["admin", "", "closes?x=1", "javascript:alert(1)"]) {
      expect(() => buildDeepLink(VALID_PUBKEY, badTab as TabKey)).toThrow(/not in TAB_KEYS/);
    }
  });

  it("throws on non-whitelisted window keys", () => {
    for (const badWindow of ["1d", "constructor", "javascript:alert(1)", ""]) {
      expect(() => buildDeepLink(VALID_PUBKEY, "fees", badWindow as WindowKey)).toThrow(
        /not a WINDOW_PRESETS key/,
      );
    }
  });

  it("exports the fleet pending link constant", () => {
    expect(FLEET_PENDING_LINK).toBe("/pending");
  });
});
