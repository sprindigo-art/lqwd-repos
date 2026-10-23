import { describe, it, expect } from "vitest";
import { parseDbTimestampUtc } from "@/lib/read/db-timestamp";

// WR-01 regression suite — the warehouse stores UTC wall time in
// `timestamp WITHOUT time zone` columns, and raw .execute surfaces them as
// OFFSET-LESS strings. `new Date(offset-less)` parses HOST-LOCAL (the bug:
// +7h skew on an America/Vancouver host, pushing the D-13 6h stale flag out
// to ~13h). These tests pin the UTC interpretation on offset-less input
// REGARDLESS of the host timezone the suite runs under — the Date.UTC
// expectations fail on any non-UTC host if the helper regresses to a bare
// new Date(string).

describe("parseDbTimestampUtc — offset-less warehouse strings are UTC (WR-01)", () => {
  it("parses the postgres space-separated offset-less form as UTC", () => {
    // The live-verified probe string shape: '2026-06-10 04:10:00'
    const d = parseDbTimestampUtc("2026-06-10 04:10:00");
    expect(d).toBeInstanceOf(Date);
    expect(d!.getTime()).toBe(Date.UTC(2026, 5, 10, 4, 10, 0));
  });

  it("parses a T-separated offset-less string as UTC", () => {
    const d = parseDbTimestampUtc("2026-06-10T04:10:00");
    expect(d!.getTime()).toBe(Date.UTC(2026, 5, 10, 4, 10, 0));
  });

  it("handles postgres microsecond fractions (truncated to ms) as UTC", () => {
    const d = parseDbTimestampUtc("2026-06-10 04:10:26.123456");
    expect(d!.getTime()).toBe(Date.UTC(2026, 5, 10, 4, 10, 26, 123));
  });
});

describe("parseDbTimestampUtc — explicit offsets and Dates pass through", () => {
  it("returns a Date instance unchanged (same reference)", () => {
    const real = new Date("2026-06-10T04:10:00Z");
    expect(parseDbTimestampUtc(real)).toBe(real);
  });

  it("leaves an ISO string with Z at the same instant", () => {
    const d = parseDbTimestampUtc("2026-06-10T04:10:00Z");
    expect(d!.getTime()).toBe(Date.UTC(2026, 5, 10, 4, 10, 0));
  });

  it("honors the pg-style bare '+00' suffix (restart fixture shape)", () => {
    const d = parseDbTimestampUtc("2025-03-13 04:05:06+00");
    expect(d!.getTime()).toBe(Date.UTC(2025, 2, 13, 4, 5, 6));
  });

  it("honors a non-UTC explicit offset", () => {
    const d = parseDbTimestampUtc("2026-06-10 04:10:26-07:00");
    expect(d!.getTime()).toBe(Date.UTC(2026, 5, 10, 11, 10, 26));
  });
});

describe("parseDbTimestampUtc — null and garbage", () => {
  it("keeps null as null", () => {
    expect(parseDbTimestampUtc(null)).toBeNull();
  });

  it("returns null (never an Invalid Date) for unparseable input", () => {
    expect(parseDbTimestampUtc("not-a-timestamp")).toBeNull();
    expect(parseDbTimestampUtc("")).toBeNull();
  });
});
