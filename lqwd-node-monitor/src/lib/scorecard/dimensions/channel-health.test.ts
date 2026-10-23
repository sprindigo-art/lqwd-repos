import { describe, it, expect } from "vitest";
import { channelHealthFromNodeInfo } from "@/lib/scorecard/dimensions/channel-health";
import type { LatestNodeInfoRow } from "@/lib/read/node-info";

// Channel-health pure-transform tests (NO DB). Table-driven over plain
// LatestNodeInfoRow literals — the module has zero database imports, so the
// math is exercised directly. Reference values from RESEARCH §Dimension Map
// row 4 (Canada: 487 active / 86 inactive).

function row(overrides: Partial<LatestNodeInfoRow>): LatestNodeInfoRow {
  return {
    pubkey: "02abc",
    alias: null,
    active_channels: null,
    inactive_channels: null,
    pending_channels: null,
    num_peers: null,
    local_channel_balance: null,
    remote_channel_balance: null,
    timestamp: null,
    ...overrides,
  };
}

describe("channelHealthFromNodeInfo (pure)", () => {
  it("computes the Canada reference: 487 active / 86 inactive → raw ≈ 0.1501", () => {
    const asOf = new Date("2026-06-09T12:00:00Z");
    const result = channelHealthFromNodeInfo([
      row({ pubkey: "canada", active_channels: 487, inactive_channels: 86, timestamp: asOf }),
    ]);
    const canada = result.get("canada");
    expect(canada).toBeDefined();
    expect(canada!.raw).not.toBeNull();
    expect(Math.abs(canada!.raw! - 0.1501)).toBeLessThan(0.0001);
    expect(canada!.asOf).toBe(asOf);
    expect(canada!.extras).toEqual({ activeChannels: 487, inactiveChannels: 86 });
  });

  it("returns raw null (not 0) when the denominator is 0 (0 active / 0 inactive)", () => {
    const result = channelHealthFromNodeInfo([
      row({ pubkey: "empty", active_channels: 0, inactive_channels: 0 }),
    ]);
    expect(result.get("empty")!.raw).toBeNull();
  });

  it("coerces null channel counts to 0 (null/null → raw null, extras zeros)", () => {
    const result = channelHealthFromNodeInfo([
      row({ pubkey: "nulls", active_channels: null, inactive_channels: null }),
    ]);
    const nulls = result.get("nulls")!;
    expect(nulls.raw).toBeNull();
    expect(nulls.extras).toEqual({ activeChannels: 0, inactiveChannels: 0 });
  });

  it("coerces a single null side to 0 (10 active / null inactive → raw 0)", () => {
    const result = channelHealthFromNodeInfo([
      row({ pubkey: "oneside", active_channels: 10, inactive_channels: null }),
    ]);
    expect(result.get("oneside")!.raw).toBe(0);
  });

  it("returns a Map keyed by pubkey (one entry per input row)", () => {
    const result = channelHealthFromNodeInfo([
      row({ pubkey: "a", active_channels: 5, inactive_channels: 5 }),
      row({ pubkey: "b", active_channels: 9, inactive_channels: 1 }),
    ]);
    expect([...result.keys()].sort()).toEqual(["a", "b"]);
    expect(result.get("a")!.raw).toBe(0.5);
    expect(result.get("b")!.raw).toBe(0.1);
  });
});
