import { describe, expect, it } from "vitest";
import { EXPORTABLE_TABS } from "@/lib/console/config";
import type { ForwardRow } from "@/lib/console/forwards";
import type { ClosedChannelRow } from "@/lib/console/closes";
import type { ChannelRowView } from "@/lib/console/channels";
import type { FeeRowView } from "@/lib/console/fees";
import { assembleCsv, EXPORT_SPECS } from "@/lib/csv/export";

// =====================================================
// 03-07 Task 1 — per-table column specs + assembleCsv (no DB)
// =====================================================
// D-08: every export carries formatted AND raw columns. D-10: provenance block
// first. A5: every free-text column escapes formulas. Raw bigint strings pass
// verbatim (lossless audit).

const EXPORTED_AT = new Date("2026-06-10T21:00:00.000Z");
const DATA_AS_OF = new Date("2026-06-10T20:55:00.000Z");

function forwardFixture(overrides: Partial<ForwardRow> = {}): ForwardRow {
  return {
    id: 1,
    chan_id_in: "123456789",
    chan_id_out: "987654321",
    amt_in: "1000",
    amt_out: "990",
    fee: "0", // FORBIDDEN column — must never be exported
    fee_msat: "10500",
    amt_in_msat: "1000000",
    amt_out_msat: "990000",
    timestamp_ns: "1781122800000000000", // 2026-06-10T20:20:00Z in ns
    lnd_pubkey: "ab".repeat(33),
    peer_alias_in: "AlphaNode",
    peer_alias_out: "BetaNode",
    ...overrides,
  };
}

function closeFixture(overrides: Partial<ClosedChannelRow> = {}): ClosedChannelRow {
  return {
    id: 1,
    channel_point: "txid:0",
    chan_id: "111222333",
    chain_hash: "00".repeat(32),
    closing_tx_hash: "ff".repeat(32),
    remote_pubkey: "cd".repeat(33),
    capacity: "5000000",
    close_height: "850000",
    settled_balance: "4990000",
    time_locked_balance: "0",
    close_type: "COOPERATIVE_CLOSE",
    open_initiator: "INITIATOR_LOCAL",
    close_initiator: "INITIATOR_REMOTE",
    local_pubkey: "ab".repeat(33),
    lnd_alias: "OurNode",
    timestamp: "2026-06-10 20:30:00",
    ...overrides,
  };
}

function channelFixture(overrides: Partial<ChannelRowView> = {}): ChannelRowView {
  return {
    chanId: "111222333",
    remotePubkey: "cd".repeat(33),
    channelPoint: "txid:1",
    active: true,
    capacitySat: "5000000",
    localBalanceSat: "2500000",
    remoteBalanceSat: "2400000",
    capacityDisplay: "5,000,000",
    localBalanceDisplay: "2,500,000",
    remoteBalanceDisplay: "2,400,000",
    ...overrides,
  };
}

function feeFixture(overrides: Partial<FeeRowView> = {}): FeeRowView {
  return {
    chanId: "111222333",
    remotePubkey: "cd".repeat(33),
    capacitySat: "5000000",
    outgoingFeeBaseMsat: "1000",
    outgoingFeeRatePpm: "350",
    capacityDisplay: "5,000,000",
    baseFeeSatDisplay: "1",
    feeRatePpmDisplay: "350",
    ...overrides,
  };
}

function assemble(table: string, rows: unknown[]): string | null {
  return assembleCsv({
    table,
    window: "7d",
    alias: "OurNode",
    pubkey: "ab".repeat(33),
    exportedAt: EXPORTED_AT,
    dataAsOf: DATA_AS_OF,
    rows,
  });
}

describe("assembleCsv document structure (Test 1)", () => {
  it("emits 5 provenance # lines, one header row, one line per data row, CRLF-joined", () => {
    const doc = assemble("forwards", [forwardFixture(), forwardFixture({ id: 2 })]);
    expect(doc).not.toBeNull();
    expect(doc!.endsWith("\r\n")).toBe(true);
    expect(doc).toContain("\r\n");
    const lines = doc!.slice(0, -2).split("\r\n");
    // 5 provenance + 1 header + 2 data rows
    expect(lines).toHaveLength(8);
    for (const line of lines.slice(0, 5)) expect(line.startsWith("# ")).toBe(true);
    expect(lines[0]).toContain("OurNode");
    expect(lines[3]).toContain("2026-06-10T21:00:00.000Z"); // exported-at
    expect(lines[4]).toContain("2026-06-10T20:55:00.000Z"); // data-as-of
    expect(lines[5].startsWith("#")).toBe(false); // header row
    expect(lines[5]).toContain("fee_sat");
  });
});

describe("formatted + raw column pairing per EXPORTABLE_TABS table (Test 2)", () => {
  it("has a spec for every EXPORTABLE_TABS key and no others", () => {
    expect(Object.keys(EXPORT_SPECS).sort()).toEqual([...EXPORTABLE_TABS].sort());
  });

  const pairings: Record<string, [string, string][]> = {
    forwards: [
      ["fee_sat", "fee_msat_raw"],
      ["time_utc", "timestamp_ns_raw"],
    ],
    closes: [
      ["time_utc", "timestamp_raw"],
      ["capacity_display", "capacity_sat_raw"],
    ],
    channels: [
      ["capacity_display", "capacity_sat_raw"],
      ["local_balance_display", "local_balance_sat_raw"],
    ],
    fees: [
      ["base_fee_sat", "fee_base_msat_raw"],
      ["capacity_display", "capacity_sat_raw"],
    ],
  };

  for (const [table, pairs] of Object.entries(pairings)) {
    it(`${table} spec pairs formatted and raw columns`, () => {
      const headers = EXPORT_SPECS[table as keyof typeof EXPORT_SPECS].map((c) => c.header);
      for (const [formatted, raw] of pairs) {
        expect(headers).toContain(formatted);
        expect(headers).toContain(raw);
      }
    });
  }

  it("forwards formats fee_sat from fee_msat (AFM-002) and time_utc as ISO-8601 UTC", () => {
    const doc = assemble("forwards", [forwardFixture()]);
    expect(doc).toContain("10.5"); // 10500 msat → 10.5 sat
    expect(doc).toContain("2026-06-10T20:20:00.000Z"); // timestamp_ns → ISO
    expect(doc).toContain("1781122800000000000"); // raw ns verbatim
  });

  it("never exports the forbidden raw `fee` column (AFM-002)", () => {
    const headers = EXPORT_SPECS.forwards.map((c) => c.header);
    expect(headers).not.toContain("fee");
    expect(headers).not.toContain("fee_raw");
  });
});

describe("formula escaping on text columns (Test 3)", () => {
  it("declares escapeFormula=true on every alias column", () => {
    const flag = (table: keyof typeof EXPORT_SPECS, header: string) =>
      EXPORT_SPECS[table].find((c) => c.header === header)?.escapeFormula;
    expect(flag("forwards", "peer_alias_in")).toBe(true);
    expect(flag("forwards", "peer_alias_out")).toBe(true);
    expect(flag("closes", "lnd_alias")).toBe(true);
  });

  it("a =HYPERLINK alias is emitted with a leading apostrophe", () => {
    const doc = assemble("forwards", [forwardFixture({ peer_alias_in: "=HYPERLINK(1)" })]);
    expect(doc).toContain("'=HYPERLINK(1)");
    expect(doc).not.toContain(",=HYPERLINK(1)");
  });

  it("a =HYPERLINK lnd_alias in closes is escaped too", () => {
    const doc = assemble("closes", [closeFixture({ lnd_alias: "=HYPERLINK(2)" })]);
    expect(doc).toContain("'=HYPERLINK(2)");
  });
});

describe("raw columns are lossless (Test 4)", () => {
  it("a 20-digit bigint string survives verbatim", () => {
    const big = "12345678901234567890";
    const doc = assemble("forwards", [forwardFixture({ fee_msat: big, amt_in_msat: big })]);
    expect(doc).toContain(big);
  });

  it("null raw values become empty cells, never fabricated zeros", () => {
    // Comma-free display overrides so the naive split(",") below stays column-aligned.
    const doc = assemble("channels", [
      channelFixture({
        capacitySat: null,
        localBalanceSat: null,
        remoteBalanceSat: null,
        capacityDisplay: "0",
        localBalanceDisplay: "0",
        remoteBalanceDisplay: "0",
      }),
    ]);
    const lines = doc!.slice(0, -2).split("\r\n");
    const headers = lines[5].split(",");
    const cells = lines[6].split(",");
    expect(cells[headers.indexOf("capacity_sat_raw")]).toBe("");
  });

  it("channels and fees rows render through their specs", () => {
    expect(assemble("channels", [channelFixture()])).toContain("5000000");
    expect(assemble("fees", [feeFixture()])).toContain("350");
  });
});

describe("unknown table key (Test 5)", () => {
  it("returns null so the route maps it to 404", () => {
    expect(assemble("scorecard", [])).toBeNull();
    expect(assemble("", [])).toBeNull();
    expect(assemble("FORWARDS", [])).toBeNull();
  });
});
