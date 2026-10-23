import { describe, expect, it } from "vitest";
import {
  applyFreshnessCutoff,
  STALENESS_CUTOFF_DAYS,
  STALENESS_CUTOFF_MS,
} from "@/lib/overview/freshness-cutoff";

// freshness-cutoff.ts is the PURE 30-day staleness ELIMINATOR (backlog #8,
// LOCKED). Any entity with NO data present in the last 30 days — a null stamp
// (never reported) OR a stamp older than 30 days — is treated as gone (unlikely
// to return) and DROPPED before incident assembly and vitals rollup (OVW-01 /
// OVW-03). This is the deliberate fix for the 1000+ STALE flood from long-dead
// nodes; it is NOT the honest no-data display path (that still applies to
// entities WITHIN the window via D-08). The filter is generic and pure: same
// (items, stampOf, now) yields the same surviving set — no DB, no mutation.

interface Entity {
  id: string;
  stamp: Date | null;
}

const NOW = Date.UTC(2026, 5, 30); // fixed clock so tests are deterministic
const daysAgo = (n: number): Date => new Date(NOW - n * 24 * 60 * 60 * 1000);

const stampOf = (e: Entity): Date | null => e.stamp;

describe("STALENESS_CUTOFF constants", () => {
  it("locks the window at 30 days", () => {
    expect(STALENESS_CUTOFF_DAYS).toBe(30);
  });

  it("derives the ms window from the day constant", () => {
    expect(STALENESS_CUTOFF_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("applyFreshnessCutoff (backlog #8 — LOCKED)", () => {
  it("DROPS an entity with a null stamp (no data ever = gone — LOCKED)", () => {
    const items: Entity[] = [{ id: "never", stamp: null }];
    expect(applyFreshnessCutoff(items, stampOf, NOW)).toEqual([]);
  });

  it("DROPS an entity 31 days old (older than the 30-day window)", () => {
    const items: Entity[] = [{ id: "dead", stamp: daysAgo(31) }];
    expect(applyFreshnessCutoff(items, stampOf, NOW)).toEqual([]);
  });

  it("KEEPS an entity 29 days old (within the window)", () => {
    const items: Entity[] = [{ id: "live", stamp: daysAgo(29) }];
    expect(applyFreshnessCutoff(items, stampOf, NOW)).toEqual(items);
  });

  it("KEEPS an entity exactly at the boundary (age == window is inclusive)", () => {
    const items: Entity[] = [{ id: "edge", stamp: new Date(NOW - STALENESS_CUTOFF_MS) }];
    expect(applyFreshnessCutoff(items, stampOf, NOW)).toEqual(items);
  });

  it("defaults maxAgeMs to the 30-day window when omitted", () => {
    const survive: Entity[] = [{ id: "in", stamp: daysAgo(29) }];
    const drop: Entity[] = [{ id: "out", stamp: daysAgo(31) }];
    // third+fourth args omitted → default window; nowMs pinned via a live stamp
    // relative to Date.now() would flake, so assert the boundary math instead.
    expect(applyFreshnessCutoff([...survive, ...drop], stampOf, NOW)).toEqual(survive);
    // and the default nowMs path returns a subset without throwing
    const result = applyFreshnessCutoff([{ id: "recent", stamp: new Date() }], stampOf);
    expect(result).toHaveLength(1);
  });

  it("mixes null, fresh and stale — keeps only the fresh survivors in input order", () => {
    const items: Entity[] = [
      { id: "a-fresh", stamp: daysAgo(1) },
      { id: "b-null", stamp: null },
      { id: "c-stale", stamp: daysAgo(45) },
      { id: "d-fresh", stamp: daysAgo(15) },
    ];
    const survivors = applyFreshnessCutoff(items, stampOf, NOW);
    expect(survivors.map((e) => e.id)).toEqual(["a-fresh", "d-fresh"]);
  });

  it("never mutates the input array (returns a new array, original preserved)", () => {
    const items: Entity[] = [
      { id: "keep", stamp: daysAgo(2) },
      { id: "drop", stamp: daysAgo(90) },
    ];
    const snapshot = [...items];
    const result = applyFreshnessCutoff(items, stampOf, NOW);
    expect(items).toEqual(snapshot); // input untouched
    expect(items).toHaveLength(2);
    expect(result).not.toBe(items); // new array reference
  });

  it("preserves input order among survivors (no re-sorting)", () => {
    const items: Entity[] = [
      { id: "z", stamp: daysAgo(3) },
      { id: "m", stamp: daysAgo(1) },
      { id: "a", stamp: daysAgo(2) },
    ];
    const survivors = applyFreshnessCutoff(items, stampOf, NOW);
    expect(survivors.map((e) => e.id)).toEqual(["z", "m", "a"]);
  });

  it("empty input yields empty output", () => {
    expect(applyFreshnessCutoff([], stampOf, NOW)).toEqual([]);
  });
});
