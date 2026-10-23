import { describe, it, expect } from "vitest";
import { peerFromNodeInfo, PEER_PARTIAL_NOTE } from "@/lib/scorecard/dimensions/peer";
import type { LatestNodeInfoRow } from "@/lib/read/node-info";

// Peer dimension pure-transform tests (NO DB — peer.ts has zero DB imports).
// The critical distinctions:
//  - num_peers 0 → raw 0 (the unreachable Tier-1 signal), NOT null
//  - num_peers null → raw null (missing data)
//  - every result carries the exact UI-SPEC partial-dimension note

function row(overrides: Partial<LatestNodeInfoRow>): LatestNodeInfoRow {
  return {
    pubkey: "02default",
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

describe("peerFromNodeInfo", () => {
  const ts = new Date("2026-06-09T10:00:00Z");

  it.each([
    { num_peers: 17, expected: 17, label: "17 → raw 17" },
    { num_peers: 0, expected: 0, label: "0 → raw 0 (unreachable signal, NOT null)" },
    { num_peers: null, expected: null, label: "null → raw null (missing data)" },
  ])("$label", ({ num_peers, expected }) => {
    const result = peerFromNodeInfo([row({ pubkey: "02abc", num_peers })]);
    expect(result.get("02abc")?.raw).toBe(expected);
  });

  it("carries the exact partial note on EVERY result", () => {
    const result = peerFromNodeInfo([
      row({ pubkey: "02a", num_peers: 17 }),
      row({ pubkey: "02b", num_peers: 0 }),
      row({ pubkey: "02c", num_peers: null }),
    ]);
    expect(PEER_PARTIAL_NOTE).toBe("partial — flap-rate needs event history");
    for (const dim of result.values()) {
      expect(dim.note).toBe(PEER_PARTIAL_NOTE);
    }
  });

  it("passes the row timestamp through as asOf (null stays null)", () => {
    const result = peerFromNodeInfo([
      row({ pubkey: "02a", num_peers: 5, timestamp: ts }),
      row({ pubkey: "02b", num_peers: 5, timestamp: null }),
    ]);
    expect(result.get("02a")?.asOf).toBe(ts);
    expect(result.get("02b")?.asOf).toBeNull();
  });

  it("returns one entry per node keyed by pubkey", () => {
    const result = peerFromNodeInfo([
      row({ pubkey: "02a", num_peers: 1 }),
      row({ pubkey: "02b", num_peers: 2 }),
    ]);
    expect(result.size).toBe(2);
    expect([...result.keys()].sort()).toEqual(["02a", "02b"]);
  });
});
