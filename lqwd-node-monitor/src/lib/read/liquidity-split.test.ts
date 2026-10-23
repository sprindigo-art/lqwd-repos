import { describe, expect, it } from "vitest";

import { aggregateLiquidity, aggregateLiquidityByPeer } from "@/lib/read/liquidity-split";
import type { ChannelBaseline } from "@/lib/read/latest";

// =====================================================
// liquidity-split.test.ts — the G4 capacity-weighted aggregators (pure)
// =====================================================
// The behavioral lock for the Node-Detail liquidity gauge math: a capacity-weighted
// local/remote split derived from ChannelBaseline[] in one pure pass, aggregate AND
// per-peer. `localShare` is HONEST — null (never 0 or NaN) when there is no routable
// liquidity, so the gauge can render an empty state instead of a fake centered 50%.
// DEP-FREE per RESEARCH §H — plain node, no DB, no clock.

/** A minimal ChannelBaseline fixture; only the fields the aggregator reads matter. */
function chan(overrides: Partial<ChannelBaseline> = {}): ChannelBaseline {
  return {
    chanId: "chan-1",
    channelPoint: "cp:0",
    peerPubkey: "a".repeat(66),
    capacity: 1_000_000,
    localBalance: 500_000,
    remoteBalance: 500_000,
    currentPpm: 100,
    baseFeeMsat: 1000,
    timeLockDelta: 80,
    active: true,
    timestamp: null,
    baselineStale: false,
    ...overrides,
  };
}

describe("aggregateLiquidity — capacity-weighted local/remote split", () => {
  it("(1) empty input → honest null share, zeroed sats (never 0/0 = NaN)", () => {
    const split = aggregateLiquidity([]);
    expect(split.localSat).toBe(0);
    expect(split.remoteSat).toBe(0);
    expect(split.capacitySat).toBe(0);
    expect(split.localShare).toBeNull();
  });

  it("(2) sums local/remote/capacity across rows; nulls treated as 0", () => {
    const split = aggregateLiquidity([
      chan({ capacity: 1_000_000, localBalance: 800_000, remoteBalance: 200_000 }),
      chan({ capacity: 1_000_000, localBalance: null, remoteBalance: 400_000 }),
    ]);
    expect(split.localSat).toBe(800_000);
    expect(split.remoteSat).toBe(600_000);
    expect(split.capacitySat).toBe(2_000_000);
  });

  it("(3) a local-heavy set leans local (localShare > 0.5)", () => {
    const split = aggregateLiquidity([
      chan({ capacity: 10_000_000, localBalance: 9_000_000, remoteBalance: 1_000_000 }),
      chan({ capacity: 100_000, localBalance: 60_000, remoteBalance: 40_000 }),
    ]);
    // capacity-weighting is inherent: the big local-heavy channel dominates.
    expect(split.localShare).not.toBeNull();
    expect(split.localShare as number).toBeGreaterThan(0.5);
  });

  it("(4) a remote-heavy set leans remote (localShare < 0.5)", () => {
    const split = aggregateLiquidity([
      chan({ capacity: 10_000_000, localBalance: 1_000_000, remoteBalance: 9_000_000 }),
    ]);
    expect(split.localShare as number).toBeLessThan(0.5);
  });

  it("(5) share is local/(local+remote) — zero routable balance → null", () => {
    const split = aggregateLiquidity([
      chan({ capacity: 1_000_000, localBalance: 0, remoteBalance: 0 }),
    ]);
    expect(split.localShare).toBeNull();
  });

  it("(6) does not mutate its input", () => {
    const rows = [chan()];
    const snapshot = JSON.stringify(rows);
    aggregateLiquidity(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });
});

describe("aggregateLiquidityByPeer — per-peer capacity-weighted split", () => {
  it("(1) sums per peer and counts channels", () => {
    const peerA = "a".repeat(66);
    const peerB = "b".repeat(66);
    const map = aggregateLiquidityByPeer([
      chan({ peerPubkey: peerA, capacity: 1_000_000, localBalance: 700_000, remoteBalance: 300_000 }),
      chan({ peerPubkey: peerA, capacity: 500_000, localBalance: 100_000, remoteBalance: 400_000 }),
      chan({ peerPubkey: peerB, capacity: 2_000_000, localBalance: 1_000_000, remoteBalance: 1_000_000 }),
    ]);
    const a = map.get(peerA);
    expect(a).toBeDefined();
    expect(a?.localSat).toBe(800_000);
    expect(a?.remoteSat).toBe(700_000);
    expect(a?.capacitySat).toBe(1_500_000);
    expect(a?.channelCount).toBe(2);
    expect(a?.localShare as number).toBeCloseTo(800_000 / 1_500_000, 6);

    const b = map.get(peerB);
    expect(b?.channelCount).toBe(1);
    expect(b?.localShare).toBeCloseTo(0.5, 6);
  });

  it("(2) excludes rows with a null peerPubkey (cannot attribute — honest)", () => {
    const peerA = "a".repeat(66);
    const map = aggregateLiquidityByPeer([
      chan({ peerPubkey: peerA }),
      chan({ peerPubkey: null }),
    ]);
    expect(map.size).toBe(1);
    expect(map.has(peerA)).toBe(true);
  });

  it("(3) a peer with zero routable balance gets a null share", () => {
    const peerA = "a".repeat(66);
    const map = aggregateLiquidityByPeer([
      chan({ peerPubkey: peerA, localBalance: 0, remoteBalance: 0 }),
    ]);
    expect(map.get(peerA)?.localShare).toBeNull();
  });
});
