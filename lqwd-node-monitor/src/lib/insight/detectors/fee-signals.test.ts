import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildChannelVolumeSql,
  detectFeeSignals,
  FEE_VOLUME_WINDOW_DAYS,
  type ChannelVolumeRow,
  type FeeSignalNodeChannels,
} from "@/lib/insight/detectors/fee-signals";
import { InsightCardSchema } from "@/lib/insight/schema";
import { INSIGHT_CONFIG } from "@/lib/insight/config";

// Fee-signals detector tests (NO DB). Two surfaces:
//  1. SQL shape — the 90d realized-volume aggregate over lnd_node_forwards:
//     ns-window idiom (×1e9 with ::int casts on bound factors), identity column
//     lnd_pubkey (Pitfall 6), bound params only, and NO read of
//     lnd_node_channel_info (current policy comes from the sanctioned AFM-001
//     reader in src/lib/read/latest.ts — never new SQL).
//  2. Pure detection — the France tiered-fee table (raise / lower /
//     close-candidate) over fixture channel rows + volume rows; every card
//     parses via InsightCardSchema and carries severity "info".

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildChannelVolumeSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

// Valid 66-lowercase-hex pubkey (buildDeepLink validates before interpolation).
const PUBKEY = "02" + "ab".repeat(32);
const REMOTE = "03" + "cd".repeat(32);

const SECONDS_PER_DAY = 86400;

/** Fixture channel row in the latestChannelsForNode (lnd_node_channel_info) shape. */
function channelRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    chan_id: "111111111111111111",
    channel_point: "deadbeef:0",
    remote_pubkey: REMOTE,
    capacity: "5000000",
    outgoing_fee_base_msat: "1000",
    outgoing_fee_rate_milli_msat: "100",
    lifetime: String(200 * SECONDS_PER_DAY),
    closed: false,
    timestamp: "2026-06-10 12:00:00",
    ...overrides,
  };
}

function nodeInput(channels: Record<string, unknown>[]): FeeSignalNodeChannels[] {
  return [{ node: { pubkey: PUBKEY, alias: "france", backend: "lnd" }, channels }];
}

function volume(rows: Array<[string, number | string]>): ChannelVolumeRow[] {
  return rows.map(([chanId, forwards]) => ({
    lnd_pubkey: PUBKEY,
    chan_id: chanId,
    forwards,
  }));
}

describe("buildChannelVolumeSql shape", () => {
  it("uses the ns-window idiom: 1e9 factor with ::int casts on bound factors", () => {
    const { sql } = render(buildChannelVolumeSql(FEE_VOLUME_WINDOW_DAYS));
    expect(sql).toContain("1e9");
    expect(sql).toContain("::int");
  });

  it("aggregates per (lnd_pubkey, chan_id) — identity column is lnd_pubkey (Pitfall 6)", () => {
    const { sql } = render(buildChannelVolumeSql(90));
    expect(sql).toContain("lnd_pubkey");
    expect(sql).toContain("group by");
  });

  it("counts both forward roles (chan_id_in and chan_id_out)", () => {
    const { sql } = render(buildChannelVolumeSql(90));
    expect(sql).toContain("chan_id_in");
    expect(sql).toContain("chan_id_out");
  });

  it("binds the window param instead of interpolating it", () => {
    const { sql, params } = render(buildChannelVolumeSql(90));
    expect(sql).toContain("$1");
    expect(params).toContain(90);
    expect(params.every((p) => typeof p === "number")).toBe(true);
  });

  it("never reads lnd_node_channel_info — policy comes from the AFM-001 latest.ts reader", () => {
    const { sql } = render(buildChannelVolumeSql(90));
    expect(sql).not.toContain("channel_info");
  });

  it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
    const { sql } = render(buildChannelVolumeSql(90));
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("detectFeeSignals — France tiered-fee table", () => {
  it("fires fee_raise on a high-volume channel priced under the floor, with full update_fee params", () => {
    const channels = [
      channelRow({ chan_id: "100", outgoing_fee_rate_milli_msat: "12" }), // PPM 12 < floor 30
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([["100", 250]]));

    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("fee_raise");
    expect(card.severity).toBe("info");
    expect(card.suggestedAction?.type).toBe("update_fee");
    if (card.suggestedAction?.type !== "update_fee") throw new Error("expected update_fee");
    const params = card.suggestedAction.params;
    // The Phase-6 signing surface requires all six fields (frozen contract).
    expect(Object.keys(params).sort()).toEqual([
      "baseFeeMsat",
      "chanId",
      "channelPoint",
      "currentPpm",
      "suggestedPpm",
      "timeLockDelta",
    ]);
    expect(params.chanId).toBe("100");
    expect(params.channelPoint).toBe("deadbeef:0");
    expect(params.currentPpm).toBe(12);
    expect(params.suggestedPpm).toBe(INSIGHT_CONFIG.lnd.feeFloorPpm);
    expect(params.baseFeeMsat).toBe(1000);
    expect(typeof params.timeLockDelta).toBe("number");
  });

  it("fires fee_lower on an over-priced low-volume channel, suggesting the low-vol tier entry", () => {
    const channels = [channelRow({ chan_id: "200", outgoing_fee_rate_milli_msat: "600" })];
    const cards = detectFeeSignals(nodeInput(channels), volume([["200", 5]]));

    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("fee_lower");
    expect(cards[0].severity).toBe("info");
    if (cards[0].suggestedAction?.type !== "update_fee") throw new Error("expected update_fee");
    expect(cards[0].suggestedAction.params.suggestedPpm).toBe(INSIGHT_CONFIG.lnd.feeLowerTargetPpm);
  });

  it("fires channel_close_candidate on a dead channel (0 forwards, age > 90d) with force:false", () => {
    const channels = [
      channelRow({ chan_id: "300", lifetime: String(120 * SECONDS_PER_DAY) }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([]));

    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("channel_close_candidate");
    expect(card.severity).toBe("info");
    expect(card.suggestedAction?.type).toBe("close_channel");
    if (card.suggestedAction?.type !== "close_channel") throw new Error("expected close_channel");
    expect(card.suggestedAction.params).toEqual({
      chanId: "300",
      channelPoint: "deadbeef:0",
      force: false,
    });
  });

  it("does NOT fire close-candidate on a young dead channel (age 30d)", () => {
    const channels = [
      channelRow({ chan_id: "400", lifetime: String(30 * SECONDS_PER_DAY) }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([]));
    expect(cards).toHaveLength(0);
  });

  it("prefers close-candidate over fee_lower on a dead over-priced old channel (close instead of tuning)", () => {
    const channels = [
      channelRow({
        chan_id: "500",
        outgoing_fee_rate_milli_msat: "900",
        lifetime: String(150 * SECONDS_PER_DAY),
      }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([]));
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("channel_close_candidate");
  });

  it("null policy PPM never fires raise/lower — unknown policy is not 0 PPM", () => {
    const channels = [channelRow({ chan_id: "600", outgoing_fee_rate_milli_msat: null })];
    const cards = detectFeeSignals(nodeInput(channels), volume([["600", 500]]));
    expect(cards).toHaveLength(0);
  });

  it("skips closed channels entirely", () => {
    const channels = [
      channelRow({ chan_id: "700", outgoing_fee_rate_milli_msat: "12", closed: true }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([["700", 250]]));
    expect(cards).toHaveLength(0);
  });

  it("every card parses via InsightCardSchema, is severity info, and deep-links to the fees tab", () => {
    const channels = [
      channelRow({ chan_id: "100", outgoing_fee_rate_milli_msat: "12" }),
      channelRow({ chan_id: "200", channel_point: "beef:1", outgoing_fee_rate_milli_msat: "600" }),
      channelRow({
        chan_id: "300",
        channel_point: "beef:2",
        lifetime: String(120 * SECONDS_PER_DAY),
      }),
    ];
    const cards = detectFeeSignals(
      nodeInput(channels),
      volume([
        ["100", 250],
        ["200", 5],
      ]),
    );

    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(() => InsightCardSchema.parse(card)).not.toThrow();
      expect(card.severity).toBe("info");
      expect(card.evidence.deepLink).toBe(`/${PUBKEY}/fees`);
      expect(card.evidence.window).toBe("90d");
      expect(card.provenance).toBe("deterministic");
      // D-08 dedupe id: stable, per (detector, node, channel target).
      expect(card.id.startsWith(`${card.signal}:${PUBKEY}:`)).toBe(true);
      // All three fee signals carry write actions → D-16 guidance text present.
      expect(card.rateLimitGuidance).not.toBeNull();
    }
  });

  it("evidence carries forwards90d + currentPpm detail with raw values", () => {
    const channels = [channelRow({ chan_id: "100", outgoing_fee_rate_milli_msat: "12" })];
    const cards = detectFeeSignals(nodeInput(channels), volume([["100", 250]]));
    const ev = cards[0].evidence;
    expect(ev.observed).toBe(12);
    expect(ev.threshold).toBe(INSIGHT_CONFIG.lnd.feeFloorPpm);
    expect(ev.unit).toBe("ppm");
    expect(ev.detail?.forwards90d).toBe(250);
    expect(ev.detail?.currentPpm).toBe(12);
  });

  it("coerces string forward counts from pg COUNT(*) rows", () => {
    const channels = [channelRow({ chan_id: "100", outgoing_fee_rate_milli_msat: "12" })];
    const cards = detectFeeSignals(nodeInput(channels), volume([["100", "250"]]));
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("fee_raise");
  });

  // EXPORT-01 context echo: capacitySat from the channel row already in hand
  // (lnd_node_channel_info.capacity on the latestChannelsForNode rows — ZERO
  // new SQL). Conditional add: unknown capacity is ABSENT, never 0 (T-05-08).
  it("close-candidate card carries capacitySat (number) from the channel row's capacity", () => {
    const channels = [
      channelRow({
        chan_id: "300",
        capacity: "50000000",
        lifetime: String(120 * SECONDS_PER_DAY),
      }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([]));
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("channel_close_candidate");
    expect(cards[0].evidence.detail?.capacitySat).toBe(50000000);
    expect(typeof cards[0].evidence.detail?.capacitySat).toBe("number");
  });

  it("a null-capacity row produces NO capacitySat key (unknown ≠ 0)", () => {
    const channels = [
      channelRow({
        chan_id: "300",
        capacity: null,
        lifetime: String(120 * SECONDS_PER_DAY),
      }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([]));
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("channel_close_candidate");
    expect(cards[0].evidence.detail).not.toHaveProperty("capacitySat");
  });
});

// =====================================================
// I-fee (18-03 / HARDEN-03) — absent volume degrades honestly (raise-only)
// =====================================================
// A FAILED 90d volume read now degrades to `null` (engine), not `[]`. `null`
// means UNKNOWN volume for every channel — never `forwards90d = 0` — so the
// detector must NEVER fabricate a confident close/lower signal from a missing
// read. Only raise-eligible signals (price below floor — the safe direction)
// may emit; their evidence carries NO fabricated forwards90d claim. A real
// (possibly empty) volume array keeps the pre-existing semantics: a chan_id
// absent from a REAL aggregate genuinely routed zero forwards.
describe("detectFeeSignals — absent volume is UNKNOWN, not zero (I-fee)", () => {
  it("null volumeRows: a dead-old channel emits ZERO channel_close_candidate cards", () => {
    // With volume([]) this exact fixture emits a close-candidate (test above);
    // with a FAILED read (null) the volume is unknown — no close card may exist.
    const channels = [
      channelRow({ chan_id: "300", lifetime: String(120 * SECONDS_PER_DAY) }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), null);
    expect(cards.filter((c) => c.signal === "channel_close_candidate")).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });

  it("null volumeRows: an over-priced channel emits ZERO fee_lower cards", () => {
    const channels = [channelRow({ chan_id: "200", outgoing_fee_rate_milli_msat: "600" })];
    const cards = detectFeeSignals(nodeInput(channels), null);
    expect(cards.filter((c) => c.signal === "fee_lower")).toHaveLength(0);
    expect(cards).toHaveLength(0);
  });

  it("null volumeRows: raise-only — an under-floor channel may still emit fee_raise with NO fabricated forwards90d", () => {
    const channels = [channelRow({ chan_id: "100", outgoing_fee_rate_milli_msat: "12" })];
    const cards = detectFeeSignals(nodeInput(channels), null);
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("fee_raise");
    // Honest evidence: the volume claim is ABSENT, never a fabricated 0.
    expect(cards[0].evidence.detail).not.toHaveProperty("forwards90d");
    expect(() => InsightCardSchema.parse(cards[0])).not.toThrow();
  });

  it("null volumeRows: a mixed fleet emits zero close AND zero lower cards (raise-only invariant)", () => {
    const channels = [
      channelRow({ chan_id: "100", outgoing_fee_rate_milli_msat: "12" }), // raise-eligible
      channelRow({ chan_id: "200", channel_point: "beef:1", outgoing_fee_rate_milli_msat: "600" }), // lower-shaped
      channelRow({ chan_id: "300", channel_point: "beef:2", lifetime: String(120 * SECONDS_PER_DAY) }), // close-shaped
    ];
    const cards = detectFeeSignals(nodeInput(channels), null);
    expect(cards.some((c) => c.signal === "channel_close_candidate")).toBe(false);
    expect(cards.some((c) => c.signal === "fee_lower")).toBe(false);
    expect(cards.every((c) => c.signal === "fee_raise")).toBe(true);
  });

  it("regression: a REAL volume array (even empty) keeps close-candidate behavior — absent entry = genuinely 0", () => {
    const channels = [
      channelRow({ chan_id: "300", lifetime: String(120 * SECONDS_PER_DAY) }),
    ];
    const cards = detectFeeSignals(nodeInput(channels), volume([]));
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("channel_close_candidate");
  });
});
