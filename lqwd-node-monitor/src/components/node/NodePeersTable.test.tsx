import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NodePeersTable, type NodePeersTableProps } from "@/components/node/NodePeersTable";
import type { PeerRowView } from "@/lib/console/peers";
import type { PeerLiquiditySplit } from "@/lib/read/liquidity-split";

// =====================================================
// NodePeersTable.test.tsx — the G2/G4 peer table render lock
// =====================================================
// Locks the interconnection + honesty contract: each peer row emits the
// /channels?peer= edge (G2), the focused row (and only it) gets the neutral
// highlight, and an empty set renders the honest-empty copy. DEP-FREE —
// `renderToStaticMarkup` under `environment: "node"` (mirrors NodeDetailTabs.test.tsx).

const PUBKEY = "0".repeat(66);
const PEER_A = "a".repeat(66);
const PEER_B = "b".repeat(66);

function peerRow(overrides: Partial<PeerRowView> = {}): PeerRowView {
  return {
    remotePubkey: PEER_A,
    alias: "Acme LSP",
    flapCountLifetime: 3,
    channelCount: 2,
    totalCapacitySat: 5_000_000,
    totalCapacityDisplay: "5,000,000",
    ...overrides,
  };
}

function split(overrides: Partial<PeerLiquiditySplit> = {}): PeerLiquiditySplit {
  return {
    localSat: 3_000_000,
    remoteSat: 2_000_000,
    capacitySat: 5_000_000,
    localShare: 0.6,
    channelCount: 2,
    ...overrides,
  };
}

function render(props: Partial<NodePeersTableProps> = {}): string {
  const rows = props.rows ?? [peerRow()];
  const liquidityByPeer =
    props.liquidityByPeer ?? new Map<string, PeerLiquiditySplit>([[PEER_A, split()]]);
  return renderToStaticMarkup(
    createElement(NodePeersTable, { pubkey: PUBKEY, rows, liquidityByPeer, ...props }),
  );
}

describe("NodePeersTable — interconnection (G2)", () => {
  it("(1) each peer row links to that peer's channels (?peer=)", () => {
    const html = render();
    expect(html).toContain(`href="/${PUBKEY}/channels?peer=${PEER_A}"`);
  });

  it("(2) composes a per-peer LiquidityGauge (G4) fed the peer's split", () => {
    const html = render();
    expect(html).toContain('data-testid="liquidity-gauge"');
    // 0.6 local share renders through AFM-002 formatPercent.
    expect(html).toContain("60.0%");
  });

  it("(3) a peer with no derivable split renders the honest-empty gauge (no thumb)", () => {
    const html = render({
      rows: [peerRow({ remotePubkey: PEER_B })],
      liquidityByPeer: new Map(),
    });
    expect(html).toContain('data-empty="true"');
    expect(html).not.toContain('data-testid="liquidity-thumb"');
  });
});

describe("NodePeersTable — focus highlight", () => {
  it("applies the highlight only to the focused row", () => {
    const html = render({
      rows: [peerRow({ remotePubkey: PEER_A }), peerRow({ remotePubkey: PEER_B, alias: "Peer B" })],
      liquidityByPeer: new Map([
        [PEER_A, split()],
        [PEER_B, split()],
      ]),
      focus: PEER_A,
    });
    // exactly one focused row marker.
    expect((html.match(/data-focused="true"/g) ?? []).length).toBe(1);
  });

  it("renders no focus marker when focus is absent", () => {
    const html = render();
    expect(html).not.toContain('data-focused="true"');
  });
});

describe("NodePeersTable — honest states", () => {
  it("renders the honest-empty copy when there are no partners", () => {
    const html = render({ rows: [], liquidityByPeer: new Map() });
    expect(html).toContain("No channel partners to show.");
  });

  it("labels the flap count as lifetime with the honest note, never as recent activity", () => {
    const html = render();
    expect(html).toContain("lifetime");
    // the only occurrence of "recent" is the honest "not recent activity" note title.
    expect(html).toContain("not recent activity");
    expect(html).not.toContain(">recent<");
  });
});
