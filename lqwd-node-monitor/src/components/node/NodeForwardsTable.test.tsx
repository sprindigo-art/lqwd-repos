import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NodeForwardsTable } from "@/components/node/NodeForwardsTable";
import type { ForwardRow, ForwardsSummary } from "@/lib/console/forwards";

// =====================================================
// NodeForwardsTable.test.tsx — the forwards → channels render lock (G2)
// =====================================================
// Locks the G2 interconnection: a forward row emits the /{pubkey}/channels?chan=
// href for its chan-out, and an empty window renders the honest-empty copy.
// DEP-FREE — `renderToStaticMarkup` under `environment: "node"` (mirrors
// NodeDetailTabs.test.tsx).

const PUBKEY = "0".repeat(66);

const SUMMARY: ForwardsSummary = {
  n: 1,
  totalAmtOutSat: 250_000,
  totalFeesSat: 42,
  avgFeeSat: 42,
};

/** Minimal ForwardRow fixture — only the display-relevant fields matter. */
function makeRow(overrides: Partial<ForwardRow> = {}): ForwardRow {
  return {
    id: 1,
    chan_id_in: "111111111111111111",
    chan_id_out: "999999999999999999",
    amt_in: "250100",
    amt_out: "250000",
    fee: "100",
    fee_msat: "42000",
    amt_in_msat: "250100000",
    amt_out_msat: "250000000",
    timestamp_ns: "1700000000000000000",
    lnd_pubkey: PUBKEY,
    peer_alias_in: null,
    peer_alias_out: null,
    ...overrides,
  };
}

describe("NodeForwardsTable — forwards → channels interconnection (G2)", () => {
  it("(1) links a row's chan-out to /{pubkey}/channels?chan={chanId}", () => {
    const html = renderToStaticMarkup(
      createElement(NodeForwardsTable, { pubkey: PUBKEY, summary: SUMMARY, rows: [makeRow()] }),
    );
    expect(html).toContain(`href="/${PUBKEY}/channels?chan=999999999999999999"`);
    expect(html).toContain(`href="/${PUBKEY}/channels?chan=111111111111111111"`);
  });

  it("(2) renders a null chan cell as a faint dash, not a link", () => {
    const html = renderToStaticMarkup(
      createElement(NodeForwardsTable, {
        pubkey: PUBKEY,
        summary: SUMMARY,
        rows: [makeRow({ chan_id_in: null })],
      }),
    );
    // chan-out still links; chan-in (null) never emits a channels href for chan=null.
    expect(html).toContain(`href="/${PUBKEY}/channels?chan=999999999999999999"`);
    expect(html).not.toContain("chan=null");
  });

  it("(3) renders the amt-out via formatSats (thousands-separated sats)", () => {
    const html = renderToStaticMarkup(
      createElement(NodeForwardsTable, { pubkey: PUBKEY, summary: SUMMARY, rows: [makeRow()] }),
    );
    expect(html).toContain("250,000 sat");
  });

  it("(4) empty rows → the honest-empty copy", () => {
    const html = renderToStaticMarkup(
      createElement(NodeForwardsTable, {
        pubkey: PUBKEY,
        summary: { n: 0, totalAmtOutSat: 0, totalFeesSat: 0, avgFeeSat: null },
        rows: [],
      }),
    );
    expect(html).toContain("No forwards in this window.");
    // avg fee honest "—" when null (no fabricated 0).
    expect(html).toContain("—");
  });
});
