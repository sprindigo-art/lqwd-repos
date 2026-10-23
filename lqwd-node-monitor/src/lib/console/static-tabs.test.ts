import { describe, it, expect } from "vitest";
import { shapeChannelsTab } from "@/lib/console/channels";
import { shapeFeesTab } from "@/lib/console/fees";
import { shapeLiquidityTab } from "@/lib/console/liquidity";

// Static-tab shaper unit tests (NO DB). The three shapers wrap
// latestChannelsForNode output — snake_case records with bigints surfaced as
// STRINGS by raw .execute. Fixtures replicate that exact shape so strip math,
// ratio math, raw/formatted pairing, closed-row exclusion, and UTC asOf
// derivation are all asserted without a warehouse connection.

const FIXTURE_ROWS: Record<string, unknown>[] = [
  {
    chan_id: "111111",
    remote_pubkey: "02aaaa",
    channel_point: "txa:0",
    active: true,
    closed: false,
    capacity: "1000000",
    local_balance: "600000",
    remote_balance: "400000",
    outgoing_fee_base_msat: "1000",
    outgoing_fee_rate_milli_msat: "250",
    timestamp: "2026-06-10 04:10:26",
  },
  {
    chan_id: "222222",
    remote_pubkey: "02bbbb",
    channel_point: "txb:1",
    active: false, // inactive but open — visible in Channels/Fees, excluded from Liquidity
    closed: false,
    capacity: "2000000",
    local_balance: "500000",
    remote_balance: "1500000",
    outgoing_fee_base_msat: "2000",
    outgoing_fee_rate_milli_msat: "750",
    timestamp: "2026-06-10 03:00:00",
  },
  {
    chan_id: "999999",
    remote_pubkey: "02cccc",
    channel_point: "txc:0",
    active: false,
    closed: true, // closed residue — excluded everywhere
    capacity: "9000000",
    local_balance: "9000000",
    remote_balance: "0",
    outgoing_fee_base_msat: "9000",
    outgoing_fee_rate_milli_msat: "9999",
    timestamp: "2026-06-10 05:00:00",
  },
];

describe("shapeChannelsTab", () => {
  it("excludes closed channels and sums the strip from rows in hand", () => {
    const view = shapeChannelsTab(FIXTURE_ROWS);
    expect(view.strip.count).toBe(2);
    expect(view.strip.totalCapacitySat).toBe(3_000_000);
    expect(view.strip.totalLocalSat).toBe(1_100_000);
    expect(view.strip.totalRemoteSat).toBe(1_900_000);
  });

  it("pairs raw bigint strings with formatted displays (CSV-lossless)", () => {
    const view = shapeChannelsTab(FIXTURE_ROWS);
    const row = view.rows[0];
    expect(row.capacitySat).toBe("1000000"); // verbatim raw string
    expect(row.capacityDisplay).toBe("1,000,000"); // formatSats
    expect(view.strip.totalCapacityDisplay).toBe("3,000,000");
  });

  it("derives asOf as the max row timestamp, parsed as UTC (WR-01)", () => {
    const view = shapeChannelsTab(FIXTURE_ROWS);
    expect(view.asOf).toEqual(new Date("2026-06-10T04:10:26Z"));
  });

  it("keeps the active flag visible per row", () => {
    const view = shapeChannelsTab(FIXTURE_ROWS);
    expect(view.rows.map((r) => r.active)).toEqual([true, false]);
  });

  it("handles empty input: zero strip, null asOf", () => {
    const view = shapeChannelsTab([]);
    expect(view.strip.count).toBe(0);
    expect(view.rows).toEqual([]);
    expect(view.asOf).toBeNull();
  });
});

describe("shapeFeesTab", () => {
  it("averages rate ppm and base fee (via feeMsatToSat) over open channels", () => {
    const view = shapeFeesTab(FIXTURE_ROWS);
    expect(view.strip.count).toBe(2);
    expect(view.strip.avgRatePpm).toBe(500); // (250 + 750) / 2
    expect(view.strip.avgBaseFeeSat).toBe(1.5); // feeMsatToSat((1000+2000)/2)
  });

  it("pairs raw msat strings with formatted sat/ppm displays", () => {
    const view = shapeFeesTab(FIXTURE_ROWS);
    const row = view.rows[0];
    expect(row.outgoingFeeBaseMsat).toBe("1000"); // raw msat string
    expect(row.baseFeeSatDisplay).toBe("1"); // 1000 msat = 1 sat
    expect(row.outgoingFeeRatePpm).toBe("250");
    expect(row.feeRatePpmDisplay).toBe("250");
  });

  it("returns null averages when no open channel reports a policy", () => {
    const view = shapeFeesTab([]);
    expect(view.strip.avgRatePpm).toBeNull();
    expect(view.strip.avgBaseFeeSat).toBeNull();
  });
});

describe("shapeLiquidityTab", () => {
  it("counts only ACTIVE non-closed channels (routable balance)", () => {
    const view = shapeLiquidityTab(FIXTURE_ROWS);
    expect(view.rows).toHaveLength(1); // chan 222222 inactive, 999999 closed
    expect(view.rows[0].chanId).toBe("111111");
  });

  it("computes per-row local ratio and overall local pct", () => {
    const view = shapeLiquidityTab(FIXTURE_ROWS);
    expect(view.rows[0].localRatio).toBeCloseTo(0.6, 10);
    expect(view.strip.totalLocalSat).toBe(600_000);
    expect(view.strip.totalCapacitySat).toBe(1_000_000);
    expect(view.strip.overallLocalPct).toBeCloseTo(60, 10);
  });

  it("yields null ratios on zero capacity (no denominator ≠ 0%)", () => {
    const zeroCap: Record<string, unknown>[] = [
      {
        chan_id: "333",
        active: true,
        closed: false,
        capacity: "0",
        local_balance: "0",
        remote_balance: "0",
        timestamp: "2026-06-10 01:00:00",
      },
    ];
    const view = shapeLiquidityTab(zeroCap);
    expect(view.rows[0].localRatio).toBeNull();
    expect(view.strip.overallLocalPct).toBeNull();
  });

  it("pairs raw strings with formatted displays", () => {
    const view = shapeLiquidityTab(FIXTURE_ROWS);
    expect(view.rows[0].localBalanceSat).toBe("600000");
    expect(view.rows[0].localBalanceDisplay).toBe("600,000");
  });
});
