import { describe, expect, it } from "vitest";

import { buildPendingView } from "@/lib/read/pending";
import { buildFleetPendingSummary } from "@/lib/console/pending-summary";

// ---------------------------------------------------------------------------
// buildFleetPendingSummary — pure display shaper over the canonical view.
// Fixtures mirror src/lib/read/pending.test.ts so the two stay in lockstep.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-06-10T12:00:00Z");

function chan(over: Record<string, unknown>): Record<string, unknown> {
  return {
    local_pubkey: "node-a",
    lnd_alias: "Alpha",
    channel_point: "cp-1:0",
    remote_node_pub: "remote-1",
    channel_state: "PENDING_OPEN",
    limbo_balance: "0",
    blocks_til_maturity: null,
    closing_txid: null,
    created_at: "2026-06-10 10:00:00+00",
    updated_at: "2026-06-10 11:00:00+00",
    ...over,
  };
}

function sweep(over: Record<string, unknown>): Record<string, unknown> {
  return {
    lnd_pubkey: "node-a",
    lnd_alias: "Alpha",
    outpoint_txid: "txid-fc-1",
    outpoint_output_index: 0,
    amount_sat: 1000,
    broadcast_attempts: 2,
    next_broadcast_height: 900000,
    sat_per_vbyte: "5",
    requested_sat_per_vbyte: "10",
    created_at: "2026-06-10 10:30:00+00",
    updated_at: "2026-06-10 11:30:00+00",
    ...over,
  };
}

describe("buildFleetPendingSummary", () => {
  it("counts each locked type per node and across the fleet", () => {
    const view = buildPendingView(
      [
        chan({ local_pubkey: "node-a", channel_point: "a1:0", channel_state: "PENDING_OPEN" }),
        chan({ local_pubkey: "node-a", channel_point: "a2:0", channel_state: "WAITING_CLOSE" }),
        chan({ local_pubkey: "node-b", lnd_alias: "Bravo", channel_point: "b1:0", channel_state: "FORCE_CLOSE" }),
      ],
      [],
      NOW,
    );
    const summary = buildFleetPendingSummary(view);

    expect(summary.totals.opens).toBe(1);
    expect(summary.totals.coops).toBe(1);
    expect(summary.totals.forces).toBe(1);
    expect(summary.nodeCount).toBe(2);

    const a = summary.nodes.find((n) => n.pubkey === "node-a")!;
    expect(a.counts).toEqual({ open: 1, coop: 1, force: 0, sweeps: 0 });
    const b = summary.nodes.find((n) => n.pubkey === "node-b")!;
    expect(b.counts).toEqual({ open: 0, coop: 0, force: 1, sweeps: 0 });
  });

  it("sums limbo across channel balances and orphan sweeps without double-counting", () => {
    const view = buildPendingView(
      [
        chan({ channel_point: "a1:0", channel_state: "FORCE_CLOSE", limbo_balance: "2000", closing_txid: "txid-fc-1" }),
        chan({ channel_point: "a2:0", channel_state: "WAITING_CLOSE", limbo_balance: "500" }),
      ],
      [
        // attached sweep — its amount is part of the force-close, NOT re-added
        sweep({ outpoint_txid: "txid-fc-1", amount_sat: 1500 }),
        // orphan sweep — additive (no parent row represents it)
        sweep({ outpoint_txid: "orphan-1", amount_sat: 300 }),
      ],
      NOW,
    );
    const summary = buildFleetPendingSummary(view);
    // 2000 + 500 channel limbo + 300 orphan = 2,800 (attached 1500 not counted)
    expect(summary.totals.limboLabel).toBe("2,800 sat");
    const node = summary.nodes[0];
    expect(node.limboLabel).toBe("2,800 sat");
    expect(node.counts.sweeps).toBe(1);
  });

  it("folds sweeps behind a count with a remaining total and per-line detail", () => {
    const view = buildPendingView(
      [chan({ channel_point: "a1:0", channel_state: "FORCE_CLOSE", closing_txid: "txid-fc-1", limbo_balance: "0" })],
      [
        sweep({ outpoint_txid: "txid-fc-1", outpoint_output_index: 0, amount_sat: 600, broadcast_attempts: 41, sat_per_vbyte: "2", requested_sat_per_vbyte: "5" }),
        sweep({ outpoint_txid: "txid-fc-1", outpoint_output_index: 1, amount_sat: 400, broadcast_attempts: 38, sat_per_vbyte: "2", requested_sat_per_vbyte: null }),
      ],
      NOW,
    );
    const item = buildFleetPendingSummary(view).nodes[0].items.find((i) => i.chip === "FORCE")!;
    expect(item.sweeps).not.toBeNull();
    expect(item.sweeps!.count).toBe(2);
    expect(item.sweeps!.totalLabel).toBe("1,000 sat");
    expect(item.sweeps!.lines[0]).toMatchObject({
      broadcastAttempts: "41",
      amountLabel: "600 sat",
      feeLabel: "2 sat/vB (req 5)",
    });
    // requested null → no "(req …)" suffix
    expect(item.sweeps!.lines[1].feeLabel).toBe("2 sat/vB");
  });

  it("surfaces unattached sweeps as their own item — never dropped", () => {
    const view = buildPendingView(
      [],
      [sweep({ outpoint_txid: "orphan-x", amount_sat: 130528, lnd_pubkey: "node-z", lnd_alias: "Zeta" })],
      NOW,
    );
    const node = buildFleetPendingSummary(view).nodes[0];
    expect(node.counts.sweeps).toBe(1);
    expect(node.oldestAgeLabel).toBe("—"); // sweeps carry no channel age anchor
    const orphan = node.items.find((i) => i.chip === "SWEEPS")!;
    expect(orphan.channelLabel).toContain("unattached");
    expect(orphan.limboLabel).toBe("130,528 sat");
    expect(orphan.sweeps!.count).toBe(1);
  });

  it("preserves unexpected channel_state keys as muted items (every sat accounted)", () => {
    const view = buildPendingView(
      [chan({ channel_point: "a1:0", channel_state: "SOME_NEW_STATE", limbo_balance: "777" })],
      [],
      NOW,
    );
    const node = buildFleetPendingSummary(view).nodes[0];
    const extra = node.items.find((i) => i.state === "SOME_NEW_STATE")!;
    expect(extra.tone).toBe("muted");
    expect(extra.chip).toBe("SOME_NEW_STATE");
    expect(node.limboLabel).toBe("777 sat");
  });

  it("reports the oldest channel age per node, formatted", () => {
    const view = buildPendingView(
      [
        chan({ channel_point: "a1:0", created_at: "2026-06-09 12:00:00+00" }), // 24h
        chan({ channel_point: "a2:0", channel_state: "WAITING_CLOSE", created_at: "2026-06-01 12:00:00+00" }), // 9d
      ],
      [],
      NOW,
    );
    expect(buildFleetPendingSummary(view).nodes[0].oldestAgeLabel).toBe("9d 0h");
  });

  it("keeps node order verbatim from the view (alphabetical by alias)", () => {
    const view = buildPendingView(
      [
        chan({ local_pubkey: "n-z", lnd_alias: "Zeta", channel_point: "z1:0" }),
        chan({ local_pubkey: "n-a", lnd_alias: "Alpha", channel_point: "a1:0" }),
      ],
      [],
      NOW,
    );
    const summary = buildFleetPendingSummary(view);
    expect(summary.nodes.map((n) => n.alias)).toEqual(["Alpha", "Zeta"]);
  });
});
