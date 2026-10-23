import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TTL_HOURS, expiryLabel, ttlHours } from "@/lib/queue/ttl";

// WR-04 regression: a bad NODEMON_TTL_HOURS must fall back to the default —
// NaN hours previously produced an Invalid Date whose .toISOString() threw a
// RangeError inside the channels-table Server Component render.

const ORIGINAL = process.env.NODEMON_TTL_HOURS;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NODEMON_TTL_HOURS;
  else process.env.NODEMON_TTL_HOURS = ORIGINAL;
});

describe("ttlHours (validated NODEMON_TTL_HOURS, WR-04)", () => {
  it("returns the default when unset", () => {
    delete process.env.NODEMON_TTL_HOURS;
    expect(ttlHours()).toBe(DEFAULT_TTL_HOURS);
  });

  it("honors a valid numeric override", () => {
    process.env.NODEMON_TTL_HOURS = "12";
    expect(ttlHours()).toBe(12);
  });

  it.each(["24h", "", "  ", "NaN", "Infinity"])(
    "falls back to the default on non-finite %j",
    (v) => {
      process.env.NODEMON_TTL_HOURS = v;
      expect(ttlHours()).toBe(DEFAULT_TTL_HOURS);
    },
  );

  it.each(["0", "-3"])("falls back to the default on non-positive %j", (v) => {
    process.env.NODEMON_TTL_HOURS = v;
    expect(ttlHours()).toBe(DEFAULT_TTL_HOURS);
  });
});

describe("expiryLabel (humanized expires preview, IN-05)", () => {
  it("renders relative TTL + compact UTC timestamp, never raw ISO", () => {
    delete process.env.NODEMON_TTL_HOURS;
    const label = expiryLabel(new Date("2026-07-11T03:14:07.000Z"));
    expect(label).toBe("in 24h (2026-07-11 03:14 UTC)");
    expect(label).not.toContain("T03:14");
  });

  it("echoes a valid TTL override in the relative part", () => {
    process.env.NODEMON_TTL_HOURS = "6";
    expect(expiryLabel(new Date("2026-07-11T03:14:07.000Z"))).toBe("in 6h (2026-07-11 03:14 UTC)");
  });
});
