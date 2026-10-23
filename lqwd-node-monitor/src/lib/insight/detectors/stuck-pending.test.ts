import { describe, it, expect } from "vitest";
import { detectStuckPending } from "@/lib/insight/detectors/stuck-pending";
import { buildPendingView } from "@/lib/read/pending";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { InsightCardSchema } from "@/lib/insight/schema";
import { PENDING_RECENCY_HOURS } from "@/lib/console/config";

// Stuck-pending detector tests (NO DB — PENDING-02 three cases).
// Fixtures flow through the REAL buildPendingView() shaper (raw snake_case
// rows) so the detector is exercised against the sanctioned reader's exact
// field mapping. `now` is fixed for deterministic age math.

const NOW = Date.parse("2026-06-12T00:00:00.000Z");
const NODE_A = "02" + "a".repeat(64);
const REMOTE = "03" + "b".repeat(64);
const CONFIG: InsightKnobs = INSIGHT_CONFIG.lnd;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function chanRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    channel_state: "FORCE_CLOSE",
    channel_point: "f".repeat(64) + ":0",
    remote_node_pub: REMOTE,
    lnd_alias: "node-a",
    local_pubkey: NODE_A,
    limbo_balance: "5000000",
    blocks_til_maturity: -10,
    closing_txid: null,
    created_at: new Date(NOW - 3 * DAY),
    updated_at: new Date(NOW - HOUR),
    ...over,
  };
}

function sweepRaw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lnd_pubkey: NODE_A,
    lnd_alias: "node-a",
    outpoint_txid: "e".repeat(64),
    outpoint_output_index: 1,
    amount_sat: 1_234_567,
    broadcast_attempts: 0,
    next_broadcast_height: 900_000,
    sat_per_vbyte: "20",
    requested_sat_per_vbyte: "20",
    created_at: new Date(NOW - 1 * DAY),
    updated_at: new Date(NOW - HOUR),
    ...over,
  };
}

function detect(
  channels: Record<string, unknown>[],
  sweeps: Record<string, unknown>[] = [],
  config: InsightKnobs = CONFIG,
) {
  return detectStuckPending(buildPendingView(channels, sweeps, new Date(NOW)), config, NOW);
}

describe("case (a) — force-close past maturity", () => {
  it("fires warn at exactly the grace boundary (blocks_til_maturity = -6)", () => {
    const cards = detect([chanRaw({ blocks_til_maturity: -6 })]);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("stuck_fc_past_maturity");
    expect(card.severity).toBe("warn");
    expect(card.id).toBe(`stuck_fc_past_maturity:${NODE_A}:${"f".repeat(64)}:0`);
    expect(card.evidence.metric).toBe("blocksPastMaturity");
    expect(card.evidence.observed).toBe(6);
    expect(card.evidence.threshold).toBe(CONFIG.fcMaturityGraceBlocks);
    expect(card.evidence.unit).toBe("blocks");
    expect(card.evidence.window).toBe(`${PENDING_RECENCY_HOURS}h snapshot`);
    expect(card.evidence.deepLink).toBe(`/${NODE_A}/pending`);
    expect(card.suggestedAction).toEqual({
      type: "remediate_pending",
      params: {
        case: "restart_procedure",
        channelPoint: "f".repeat(64) + ":0",
        outpointTxid: null,
        suggestedSatPerVbyte: null,
      },
    });
  });

  it("does not fire one block inside the grace window (-5)", () => {
    expect(detect([chanRaw({ blocks_til_maturity: -5 })])).toHaveLength(0);
  });

  it("does not fire on a not-yet-mature force-close (blocks_til_maturity = 100)", () => {
    expect(detect([chanRaw({ blocks_til_maturity: 100 })])).toHaveLength(0);
  });

  it("does not fire with zero limbo balance", () => {
    expect(detect([chanRaw({ blocks_til_maturity: -50, limbo_balance: "0" })])).toHaveLength(0);
  });

  it("escalates critical at -144 blocks (fcPastMaturityCriticalBlocks) but not at -143", () => {
    expect(detect([chanRaw({ blocks_til_maturity: -144 })])[0].severity).toBe("critical");
    expect(detect([chanRaw({ blocks_til_maturity: -143 })])[0].severity).toBe("warn");
  });

  it("carries limboSat (the D-06 rank key) as a number", () => {
    const card = detect([chanRaw({ blocks_til_maturity: -10 })])[0];
    expect(card.evidence.detail?.limboSat).toBe(5_000_000);
  });
});

describe("case (b) — stuck sweep", () => {
  it("fires warn on broadcast_attempts > 5 with the bump_fee action", () => {
    const cards = detect([], [sweepRaw({ broadcast_attempts: 6 })]);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("stuck_sweep");
    expect(card.severity).toBe("warn");
    expect(card.id).toBe(`stuck_sweep:${NODE_A}:${"e".repeat(64)}:1`);
    expect(card.target).toEqual({
      kind: "sweep",
      outpointTxid: "e".repeat(64),
      outpointOutputIndex: 1,
    });
    expect(card.evidence.metric).toBe("sweepBroadcastAttempts");
    expect(card.evidence.observed).toBe(6);
    expect(card.evidence.threshold).toBe(CONFIG.sweepStuckAttempts);
    expect(card.evidence.unit).toBe("attempts");
    expect(card.suggestedAction).toEqual({
      type: "remediate_pending",
      params: {
        case: "bump_fee",
        channelPoint: null,
        outpointTxid: "e".repeat(64),
        suggestedSatPerVbyte: 20,
      },
    });
  });

  it("does not fire at exactly 5 attempts with fresh age and adequate fee", () => {
    expect(detect([], [sweepRaw({ broadcast_attempts: 5 })])).toHaveLength(0);
  });

  it("escalates critical at broadcast_attempts >= 12", () => {
    const cards = detect([], [sweepRaw({ broadcast_attempts: 12 })]);
    expect(cards[0].severity).toBe("critical");
  });

  it("fires warn on age > 14d alone (hours metric)", () => {
    const cards = detect([], [sweepRaw({ created_at: new Date(NOW - 15 * DAY) })]);
    expect(cards).toHaveLength(1);
    expect(cards[0].severity).toBe("warn");
    expect(cards[0].evidence.metric).toBe("sweepAgeHours");
    expect(cards[0].evidence.observed).toBe(15 * 24);
    expect(cards[0].evidence.threshold).toBe(CONFIG.sweepStuckAgeDays * 24);
    expect(cards[0].evidence.unit).toBe("hours");
  });

  it("fires warn when under-fee'd (sat_per_vbyte < requested_sat_per_vbyte)", () => {
    const cards = detect(
      [],
      [sweepRaw({ sat_per_vbyte: "10", requested_sat_per_vbyte: "20" })],
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].evidence.metric).toBe("sweepSatPerVbyte");
    expect(cards[0].evidence.observed).toBe(10);
    expect(cards[0].evidence.threshold).toBe(20);
    const action = cards[0].suggestedAction;
    expect(action?.type).toBe("remediate_pending");
    if (action?.type === "remediate_pending") {
      expect(action.params.suggestedSatPerVbyte).toBe(20);
    }
  });

  it("does not fire on a healthy sweep (3 attempts, 1d old, fee adequate)", () => {
    expect(detect([], [sweepRaw({ broadcast_attempts: 3 })])).toHaveLength(0);
  });

  it("uses amount_sat as limboSat (the D-06 rank key)", () => {
    const card = detect([], [sweepRaw({ broadcast_attempts: 6 })])[0];
    expect(card.evidence.detail?.limboSat).toBe(1_234_567);
  });
});

describe("case (c) — stuck open", () => {
  function openRaw(ageMs: number): Record<string, unknown> {
    return chanRaw({
      channel_state: "PENDING_OPEN",
      blocks_til_maturity: null,
      limbo_balance: null,
      created_at: new Date(NOW - ageMs),
    });
  }

  it("fires warn past 24h with the aged_funding action", () => {
    const cards = detect([openRaw(25 * HOUR)]);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("stuck_open");
    expect(card.severity).toBe("warn");
    expect(card.id).toBe(`stuck_open:${NODE_A}:${"f".repeat(64)}:0`);
    expect(card.evidence.metric).toBe("pendingOpenAgeHours");
    expect(card.evidence.observed).toBe(25);
    expect(card.evidence.threshold).toBe(CONFIG.openStuckWarnHours);
    expect(card.evidence.unit).toBe("hours");
    expect(card.suggestedAction).toEqual({
      type: "remediate_pending",
      params: {
        case: "aged_funding",
        channelPoint: "f".repeat(64) + ":0",
        outpointTxid: null,
        suggestedSatPerVbyte: null,
      },
    });
  });

  it("does not fire at exactly 24h", () => {
    expect(detect([openRaw(24 * HOUR)])).toHaveLength(0);
  });

  it("escalates critical past 72h", () => {
    expect(detect([openRaw(73 * HOUR)])[0].severity).toBe("critical");
  });

  it("still carries a numeric limboSat (0) when limbo_balance is null", () => {
    const card = detect([openRaw(25 * HOUR)])[0];
    expect(card.evidence.detail?.limboSat).toBe(0);
  });
});

describe("mixed view — classification, severities, contract", () => {
  const CLOSING_TXID = "d".repeat(64);
  const channels = [
    // FC past maturity (warn) with a nested critical sweep via closing_txid.
    chanRaw({ blocks_til_maturity: -10, closing_txid: CLOSING_TXID }),
    // Aged PENDING_OPEN (warn).
    chanRaw({
      channel_state: "PENDING_OPEN",
      channel_point: "c".repeat(64) + ":1",
      blocks_til_maturity: null,
      limbo_balance: null,
      created_at: new Date(NOW - 30 * HOUR),
    }),
    // Healthy WAITING_CLOSE — never flagged.
    chanRaw({
      channel_state: "WAITING_CLOSE",
      channel_point: "b".repeat(64) + ":0",
      blocks_til_maturity: null,
    }),
  ];
  const sweeps = [
    // Nested under the force-close (outpoint_txid === closing_txid): critical.
    sweepRaw({ outpoint_txid: CLOSING_TXID, broadcast_attempts: 12 }),
  ];

  it("emits all three case types with the correct severities", () => {
    const cards = detect(channels, sweeps);
    expect(cards).toHaveLength(3);
    const bySignal = new Map(cards.map((c) => [c.signal, c.severity]));
    expect(bySignal.get("stuck_fc_past_maturity")).toBe("warn");
    expect(bySignal.get("stuck_sweep")).toBe("critical");
    expect(bySignal.get("stuck_open")).toBe("warn");
  });

  it("every emitted card has a numeric evidence.detail.limboSat", () => {
    for (const card of detect(channels, sweeps)) {
      expect(typeof card.evidence.detail?.limboSat).toBe("number");
      expect(Number.isFinite(card.evidence.detail?.limboSat)).toBe(true);
    }
  });

  it("every emitted card parses via InsightCardSchema (frozen remediate_pending variants)", () => {
    const cards = detect(channels, sweeps);
    for (const card of cards) {
      expect(() => InsightCardSchema.parse(card)).not.toThrow();
    }
  });

  it("detects orphan (unattached) sweeps too — never dropped", () => {
    // Sweep whose close already left pending: no matching closing_txid.
    const cards = detect([], [sweepRaw({ broadcast_attempts: 12 })]);
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("stuck_sweep");
  });

  it("thresholds come from config — widening the grace window silences the -10 FC", () => {
    const retuned: InsightKnobs = { ...CONFIG, fcMaturityGraceBlocks: 11 };
    const cards = detect([chanRaw({ blocks_til_maturity: -10 })], [], retuned);
    expect(cards).toHaveLength(0);
  });
});
