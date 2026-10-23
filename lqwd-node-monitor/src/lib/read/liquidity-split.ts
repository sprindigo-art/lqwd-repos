import type { ChannelBaseline } from "@/lib/read/latest";

// =====================================================
// liquidity-split.ts — G4 capacity-weighted local/remote aggregators (pure)
// =====================================================
// The math behind the Node-Detail liquidity gauge: fold a node's ChannelBaseline[]
// into a local/remote split in one pure pass — aggregate AND per-peer. Capacity
// weighting is INHERENT: bigger channels contribute more sats, so summing raw
// balances already weights by capacity (no per-channel ratio averaging, which would
// let a tiny lopsided channel skew the node view).
//
// `localShare` is HONEST — `null` (never 0 and never NaN) when there is no routable
// balance (local+remote === 0). A 0/0 would render as a fake centered 50% bar; the
// null lets the gauge show its empty state instead. Mirrors the `overallLocalPct`
// null-on-empty posture in console/liquidity.ts, but computes share over the
// ROUTABLE split (local / (local+remote)) rather than local / capacity, so the gauge
// answers "which way does the routable liquidity lean" directly.
//
// PURE: no DB import, no Date/clock, no mutation of the input — runs in the no-DB
// vitest exactly like node-services.ts. Returns RAW sats; AFM-002 display formatting
// is the COMPONENT's job (this layer never formats).

/** Aggregate capacity-weighted local/remote split over a set of channels. */
export interface LiquiditySplit {
  /** Sum of local balances (sats). Nulls counted as 0. */
  localSat: number;
  /** Sum of remote balances (sats). Nulls counted as 0. */
  remoteSat: number;
  /** Sum of channel capacities (sats). Nulls counted as 0. */
  capacitySat: number;
  /**
   * Routable local share: local / (local + remote), in [0,1]. `null` — never 0 or
   * NaN — when there is no routable balance (local + remote === 0), so the gauge can
   * render an honest empty state instead of a fabricated 50%.
   */
  localShare: number | null;
}

/** Per-peer split — a {@link LiquiditySplit} plus how many channels back it. */
export interface PeerLiquiditySplit extends LiquiditySplit {
  /** Number of channels with this peer that contributed to the split. */
  channelCount: number;
}

/** Local balance treating null as 0 (a null balance contributes no sats). */
function localOf(row: ChannelBaseline): number {
  return row.localBalance ?? 0;
}

/** Remote balance treating null as 0. */
function remoteOf(row: ChannelBaseline): number {
  return row.remoteBalance ?? 0;
}

/** Capacity treating null as 0. */
function capacityOf(row: ChannelBaseline): number {
  return row.capacity ?? 0;
}

/**
 * Routable local share for a local/remote pair: `local / (local + remote)`, or
 * `null` when the pair carries no routable balance (avoids 0/0 = NaN). Single place
 * the share semantics live so aggregate + per-peer stay identical.
 */
function routableShare(localSat: number, remoteSat: number): number | null {
  const routable = localSat + remoteSat;
  return routable === 0 ? null : localSat / routable;
}

/**
 * Capacity-weighted aggregate split for a node's channels. Sums raw balances (nulls
 * as 0) in one pass; the sum is inherently capacity-weighted. Empty input returns a
 * zeroed split with a `null` share. Does not mutate `rows`.
 */
export function aggregateLiquidity(rows: ChannelBaseline[]): LiquiditySplit {
  let localSat = 0;
  let remoteSat = 0;
  let capacitySat = 0;

  for (const row of rows) {
    localSat += localOf(row);
    remoteSat += remoteOf(row);
    capacitySat += capacityOf(row);
  }

  return { localSat, remoteSat, capacitySat, localShare: routableShare(localSat, remoteSat) };
}

/**
 * Per-peer capacity-weighted split. Rows whose `peerPubkey` is `null` are EXCLUDED —
 * a keyless channel cannot be honestly attributed to a peer (mirrors the AFM-001
 * NULL-key exclusion). Each peer's share is computed the same way as the aggregate.
 * Does not mutate `rows`.
 */
export function aggregateLiquidityByPeer(
  rows: ChannelBaseline[],
): Map<string, PeerLiquiditySplit> {
  const byPeer = new Map<string, PeerLiquiditySplit>();

  for (const row of rows) {
    const peer = row.peerPubkey;
    if (peer === null) continue; // honest: cannot attribute a keyless channel.

    const acc = byPeer.get(peer) ?? {
      localSat: 0,
      remoteSat: 0,
      capacitySat: 0,
      localShare: null,
      channelCount: 0,
    };
    acc.localSat += localOf(row);
    acc.remoteSat += remoteOf(row);
    acc.capacitySat += capacityOf(row);
    acc.channelCount += 1;
    acc.localShare = routableShare(acc.localSat, acc.remoteSat);
    byPeer.set(peer, acc);
  }

  return byPeer;
}
