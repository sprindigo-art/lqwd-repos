import { describe, it, expect } from "vitest";
import {
  mapLndNode,
  mapLdkNode,
  type UnifiedNode,
  type LndNodeRow,
  type LdkNodeRow,
} from "@/lib/read/nodes";

// =====================================================
// READ-04 — UnifiedNode per-backend boundary (no DB)
// =====================================================
// Pure unit test: an LND row and an LDK row each map to a valid UnifiedNode of
// IDENTICAL shape (T-04-01). Balances stay RAW sats — the mapper applies no
// /1e8 or *1000 conversion (AFM-002 owns render-time conversion, T-04-03).
// LDK channel balances arrive in msat and are normalized to raw sats via the
// sanctioned AFM-002 path (feeMsatToSat), never inline math.

// The canonical UnifiedNode key set every backend must produce identically.
const UNIFIED_KEYS = [
  "backend",
  "pubkey",
  "alias",
  "activeChannels",
  "inactiveChannels",
  "pendingChannels",
  "localBalanceSats",
  "remoteBalanceSats",
] as const;

describe("mapLndNode", () => {
  // Fixture row mirrors lnd_node_info (schema/routing.ts). Balances are RAW sats.
  const lndRow: LndNodeRow = {
    pubkey: "02aaaa000000000000000000000000000000000000000000000000000000000000",
    alias: "LQWD-Canada",
    activeChannels: 489,
    inactiveChannels: 2,
    pendingChannels: 1,
    localChannelBalance: 3_359_047_565n,
    remoteChannelBalance: 1_200_000_000n,
  };

  it("produces a backend:lnd UnifiedNode with all canonical keys", () => {
    const node = mapLndNode(lndRow);
    expect(node.backend).toBe("lnd");
    expect(Object.keys(node).sort()).toEqual([...UNIFIED_KEYS].sort());
  });

  it("carries identity + channel counts straight from lnd_node_info", () => {
    const node = mapLndNode(lndRow);
    expect(node.pubkey).toBe(lndRow.pubkey);
    expect(node.alias).toBe("LQWD-Canada");
    expect(node.activeChannels).toBe(489);
    expect(node.inactiveChannels).toBe(2);
    expect(node.pendingChannels).toBe(1);
  });

  it("keeps balances as RAW sats — no conversion applied in the mapper", () => {
    const node = mapLndNode(lndRow);
    // The exact bigint sat value survives untouched (not /1e8, not /1000).
    expect(node.localBalanceSats).toBe(3_359_047_565);
    expect(node.remoteBalanceSats).toBe(1_200_000_000);
  });

  it("never leaks null counts as undefined (explicit 0 fallback)", () => {
    const sparse: LndNodeRow = {
      pubkey: "02bbbb",
      alias: null,
      activeChannels: null,
      inactiveChannels: null,
      pendingChannels: null,
      localChannelBalance: null,
      remoteChannelBalance: null,
    };
    const node = mapLndNode(sparse);
    expect(node.alias).toBeNull();
    expect(node.activeChannels).toBe(0);
    expect(node.inactiveChannels).toBe(0);
    expect(node.pendingChannels).toBe(0);
    expect(node.localBalanceSats).toBe(0);
    expect(node.remoteBalanceSats).toBe(0);
  });
});

describe("mapLdkNode", () => {
  // Fixture row is the aggregated LDK node view derived from lightning_channels
  // (schema/ldk.ts). LDK is single-node; per-channel msat balances are summed by
  // the caller and handed in as msat — the mapper normalizes msat→sat via the
  // AFM-002 formatter (feeMsatToSat), the only sanctioned msat→sat path.
  const ldkRow: LdkNodeRow = {
    pubkey: "03cccc000000000000000000000000000000000000000000000000000000000000",
    alias: "LQwD-Lspd-ldk",
    activeChannels: 12,
    inactiveChannels: 0,
    pendingChannels: 0,
    localBalanceMsat: 5_000_000_000n, // 5,000,000 sats
    remoteBalanceMsat: 2_500_000_000n, // 2,500,000 sats
  };

  it("produces a backend:ldk UnifiedNode with all canonical keys", () => {
    const node = mapLdkNode(ldkRow);
    expect(node.backend).toBe("ldk");
    expect(Object.keys(node).sort()).toEqual([...UNIFIED_KEYS].sort());
  });

  it("normalizes msat balances to RAW sats via the AFM-002 formatter", () => {
    const node = mapLdkNode(ldkRow);
    // feeMsatToSat(5_000_000_000) === 5_000_000 — sats, not BTC, not msat.
    expect(node.localBalanceSats).toBe(5_000_000);
    expect(node.remoteBalanceSats).toBe(2_500_000);
  });

  it("sets fields LDK cannot provide to explicit 0/null, never undefined", () => {
    const sparse: LdkNodeRow = {
      pubkey: "03dddd",
      alias: null,
      activeChannels: 0,
      inactiveChannels: 0,
      pendingChannels: 0,
      localBalanceMsat: null,
      remoteBalanceMsat: null,
    };
    const node = mapLdkNode(sparse);
    expect(node.alias).toBeNull();
    expect(node.inactiveChannels).toBe(0);
    expect(node.pendingChannels).toBe(0);
    expect(node.localBalanceSats).toBe(0);
    expect(node.remoteBalanceSats).toBe(0);
    expect(Object.values(node).every((v) => v !== undefined)).toBe(true);
  });
});

describe("UnifiedNode shape parity across backends (READ-04)", () => {
  it("both mappers yield the IDENTICAL key set — UI renders either without branching", () => {
    const lnd: UnifiedNode = mapLndNode({
      pubkey: "02aaaa",
      alias: "a",
      activeChannels: 1,
      inactiveChannels: 0,
      pendingChannels: 0,
      localChannelBalance: 1n,
      remoteChannelBalance: 1n,
    });
    const ldk: UnifiedNode = mapLdkNode({
      pubkey: "03cccc",
      alias: "b",
      activeChannels: 1,
      inactiveChannels: 0,
      pendingChannels: 0,
      localBalanceMsat: 1000n,
      remoteBalanceMsat: 1000n,
    });
    expect(Object.keys(lnd).sort()).toEqual(Object.keys(ldk).sort());
  });
});
