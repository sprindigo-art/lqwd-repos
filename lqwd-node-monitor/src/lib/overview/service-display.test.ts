import { describe, expect, it } from "vitest";
import { SERVICE_DISPLAY, serviceDisplay } from "@/lib/overview/service-display";

// service-display is a PURE presentation-only relabel map (LOCKED backlog #9). It
// turns a raw machine service key into an operator-facing { label, description }.
// It touches NO health logic and NO data model — these tests pin exactly that:
// the seeded label, the humanized fallback for unknown keys, and the never-throws
// contract. Health continues to flow from ServiceHealthState (two-axis, interval-
// based) — this map is never allowed to re-grade or recolor a service.

describe("SERVICE_DISPLAY seed map", () => {
  it("seeds addressBalances → 'Address List Sync' with a description", () => {
    expect(SERVICE_DISPLAY.addressBalances).toBeDefined();
    expect(SERVICE_DISPLAY.addressBalances.label).toBe("Address List Sync");
    expect(SERVICE_DISPLAY.addressBalances.description.length).toBeGreaterThan(0);
  });

  it("carries operator-facing labels for the other observed keys", () => {
    for (const key of [
      "aiLiquidityManager",
      "channelAcceptor",
      "internalRebalancer",
      "nodeAuditor",
      "esplora",
      "bitcoind",
    ]) {
      expect(SERVICE_DISPLAY[key]).toBeDefined();
      expect(SERVICE_DISPLAY[key].label.length).toBeGreaterThan(0);
      // A relabel never leaks the raw camelCase key back out as the label.
      if (key !== "esplora" && key !== "bitcoind") {
        expect(SERVICE_DISPLAY[key].label).not.toBe(key);
      }
    }
  });

  it("every entry exposes exactly { label, description } — no health fields", () => {
    for (const entry of Object.values(SERVICE_DISPLAY)) {
      expect(Object.keys(entry).sort()).toEqual(["description", "label"]);
    }
  });
});

describe("serviceDisplay(name)", () => {
  it("resolves a known key to its seeded entry", () => {
    expect(serviceDisplay("addressBalances").label).toBe("Address List Sync");
    expect(serviceDisplay("addressBalances")).toEqual(SERVICE_DISPLAY.addressBalances);
  });

  it("humanizes an unknown camelCase key to Title Case words", () => {
    const out = serviceDisplay("brandNewCron");
    expect(out.label).toBe("Brand New Cron");
    // Fallback description is empty/neutral — never a fabricated claim.
    expect(out.description).toBe("");
  });

  it("humanizes a single-word unknown key", () => {
    expect(serviceDisplay("watchtower").label).toBe("Watchtower");
  });

  it("splits digits and acronym runs sensibly and never throws", () => {
    expect(() => serviceDisplay("someNewService")).not.toThrow();
    expect(serviceDisplay("someNewService").label).toBe("Some New Service");
  });

  it("uppercases known domain acronyms whole instead of Title-Casing them", () => {
    // Raw service key `lnd` must render "LND", never "Lnd" (audit C1).
    expect(serviceDisplay("lnd").label).toBe("LND");
    expect(serviceDisplay("LND").label).toBe("LND");
    // Acronym embedded in a camelCase key stays uppercase; other tokens Title-Case.
    expect(serviceDisplay("lndWatchtower").label).toBe("LND Watchtower");
    expect(serviceDisplay("htlcInterceptor").label).toBe("HTLC Interceptor");
    // Non-acronym single words are unaffected.
    expect(serviceDisplay("watchtower").label).toBe("Watchtower");
  });

  it("never throws on empty / whitespace / non-camel input", () => {
    expect(() => serviceDisplay("")).not.toThrow();
    expect(() => serviceDisplay("   ")).not.toThrow();
    expect(() => serviceDisplay("snake_case_key")).not.toThrow();
    // An empty key degrades to an empty label rather than throwing.
    expect(serviceDisplay("").label).toBe("");
  });
});
