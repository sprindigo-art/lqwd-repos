import { describe, it, expect } from "vitest";
import { parsePageParam, slicePage, DEFAULT_PAGE_SIZE } from "@/lib/console/paginate";

// Pure pagination util — no DB, no Date, never throws. Mirrors filter.ts's
// "invalid silently widens to the safe default" contract (V5 / T-13-11-01): a
// bad ?page never errors, it clamps to a valid page. slicePage is a pure array
// slice. These cases lock the whitelist-clamp behavior BEFORE the impl exists.

describe("parsePageParam clamp contract", () => {
  it("non-numeric raw → page 1, offset 0", () => {
    const r = parsePageParam("abc", { total: 120 });
    expect(r.page).toBe(1);
    expect(r.offset).toBe(0);
  });

  it("undefined raw → page 1, offset 0", () => {
    const r = parsePageParam(undefined, { total: 120 });
    expect(r.page).toBe(1);
    expect(r.offset).toBe(0);
  });

  it("null raw → page 1, offset 0", () => {
    const r = parsePageParam(null, { total: 120 });
    expect(r.page).toBe(1);
    expect(r.offset).toBe(0);
  });

  it("<= 0 raw → page 1", () => {
    expect(parsePageParam("0", { total: 120 }).page).toBe(1);
    expect(parsePageParam("-5", { total: 120 }).page).toBe(1);
  });

  it("non-integer raw → page 1", () => {
    expect(parsePageParam("2.5", { total: 120 }).page).toBe(1);
  });

  it("overflow raw → clamps to pageCount", () => {
    const r = parsePageParam("999", { total: 120, pageSize: 50 });
    expect(r.page).toBe(3); // ceil(120/50) = 3
    expect(r.pageCount).toBe(3);
    expect(r.offset).toBe(100); // (3 - 1) * 50
  });

  it("total 0 → page 1, pageCount 1, offset 0", () => {
    const r = parsePageParam(null, { total: 0 });
    expect(r.page).toBe(1);
    expect(r.pageCount).toBe(1);
    expect(r.offset).toBe(0);
  });

  it("mid-range page → correct offset", () => {
    const r = parsePageParam("2", { total: 120, pageSize: 50 });
    expect(r.page).toBe(2);
    expect(r.offset).toBe(50);
    expect(r.pageSize).toBe(50);
  });

  it("defaults pageSize to DEFAULT_PAGE_SIZE when omitted", () => {
    const r = parsePageParam("1", { total: 10 });
    expect(r.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("never throws on hostile input", () => {
    expect(() => parsePageParam("'; DROP TABLE x; --", { total: 5 })).not.toThrow();
    expect(() => parsePageParam("Infinity", { total: 5 })).not.toThrow();
    expect(() => parsePageParam("NaN", { total: 5 })).not.toThrow();
  });
});

describe("slicePage pure slice", () => {
  const items = Array.from({ length: 10 }, (_, i) => i);

  it("returns the items for the requested page", () => {
    expect(slicePage(items, 1, 4)).toEqual([0, 1, 2, 3]);
    expect(slicePage(items, 2, 4)).toEqual([4, 5, 6, 7]);
    expect(slicePage(items, 3, 4)).toEqual([8, 9]);
  });

  it("empty array when page is beyond range", () => {
    expect(slicePage(items, 99, 4)).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const copy = [...items];
    slicePage(items, 2, 4);
    expect(items).toEqual(copy);
  });
});
