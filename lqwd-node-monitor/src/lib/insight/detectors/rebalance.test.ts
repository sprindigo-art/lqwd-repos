import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildRebalanceSql,
  detectRebalance,
  type RebalanceAggRow,
} from "@/lib/insight/detectors/rebalance";
import { INSIGHT_CONFIG, type InsightKnobs } from "@/lib/insight/config";
import { InsightCardSchema } from "@/lib/insight/schema";

// Rebalance detector tests (NO DB — INSIGHT-02 detector 6).
//  - SQL shape: COUNT FILTER (WHERE paid_status) / NULLIF success-rate idiom on
//    internal_rebalance_invoices, identity column requesting_node_pubkey
//    (Pitfall 6), bound window + HAVING params (T-04-13).
//  - Behavior matrix: partner-binary warn line, the 20-attempt floor, node-level
//    info degradation, the conditional bounded `rebalance` action (T-04-15 cap).

const dialect = new PgDialect();

function render(built: ReturnType<typeof buildRebalanceSql>) {
  const q = dialect.sqlToQuery(built);
  return { sql: q.sql.toLowerCase(), params: q.params };
}

// 66-lowercase-hex pubkeys (buildDeepLink gate).
const NODE_A = "02" + "a".repeat(64);
const PARTNER_1 = "03" + "b".repeat(64);
const PARTNER_2 = "03" + "c".repeat(64);
const PARTNER_3 = "03" + "d".repeat(64);

const CONFIG: InsightKnobs = INSIGHT_CONFIG.lnd;

function row(over: Partial<RebalanceAggRow>): RebalanceAggRow {
  return {
    requesting_node_pubkey: NODE_A,
    requesting_node_alias: "node-a",
    remote_pubkey: PARTNER_1,
    remote_alias: "partner-1",
    attempts: 0,
    paid: 0,
    success_rate: null,
    as_of: "2026-06-12 00:00:00",
    ...over,
  };
}

describe("buildRebalanceSql shape (T-04-13)", () => {
  it("uses the COUNT FILTER paid_status / NULLIF success-rate idiom", () => {
    const { sql } = render(buildRebalanceSql());
    expect(sql).toContain("filter (where paid_status)");
    expect(sql).toContain("nullif");
  });

  it("partitions on requesting_node_pubkey (Pitfall 6) and groups per (node, partner)", () => {
    const { sql } = render(buildRebalanceSql());
    expect(sql).toContain("requesting_node_pubkey");
    expect(sql).toContain("group by requesting_node_pubkey, remote_pubkey");
    expect(sql).toContain("requesting_node_pubkey is not null");
  });

  it("binds window and HAVING floor as params (>= 2 bound params, never interpolated)", () => {
    const { sql, params } = render(buildRebalanceSql(7));
    expect(sql).toContain("having count(*) >= $");
    expect(params.length).toBeGreaterThanOrEqual(2);
    expect(params).toContain(7);
    expect(params).toContain(CONFIG.rebalancePartnerMinAttempts);
  });

  it("never pins the AFM-001 failure shape WHERE timestamp =", () => {
    const { sql } = render(buildRebalanceSql());
    expect(sql).not.toContain("where timestamp =");
  });
});

describe("detectRebalance — partner-binary failure (warn)", () => {
  it("fires warn investigate for a partner at 0/25 (>= rebalanceBinaryMinAttempts)", () => {
    // Healthy second partner keeps the node-level rate above the warn line so
    // exactly one card isolates the partner-binary signal.
    const cards = detectRebalance(
      [
        row({ remote_pubkey: PARTNER_1, attempts: 25, paid: 0, success_rate: 0 }),
        row({
          remote_pubkey: PARTNER_2,
          remote_alias: "partner-2",
          attempts: 30,
          paid: 30,
          success_rate: 1,
        }),
      ],
      CONFIG,
    );
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("rebalance_partner_failure");
    expect(card.severity).toBe("warn");
    expect(card.suggestedAction).toEqual({ type: "investigate", params: {} });
    expect(card.target).toEqual({
      kind: "channel",
      chanId: null,
      channelPoint: null,
      remotePubkey: PARTNER_1,
    });
    expect(card.id).toBe(`rebalance_partner_failure:${NODE_A}:${PARTNER_1}`);
    expect(card.evidence.metric).toBe("partnerSuccessRate");
    expect(card.evidence.observed).toBe(0);
    expect(card.evidence.unit).toBe("ratio");
    expect(card.evidence.window).toBe("7d");
    expect(card.evidence.deepLink).toBe(`/${NODE_A}/liquidity`);
    expect(card.evidence.detail).toMatchObject({ attempts: 25, paid: 0, partnerPubkey: PARTNER_1 });
    // EXPORT-01 context echo: partnerAlias from the remote_alias column already
    // in the aggregate row (ZERO new SQL). Conditional add (T-05-08).
    expect(card.evidence.detail?.partnerAlias).toBe("partner-1");
  });

  it("partner-failure card omits partnerAlias when remote_alias is null (unknown ≠ fake)", () => {
    const cards = detectRebalance(
      [
        row({ remote_pubkey: PARTNER_1, remote_alias: null, attempts: 25, paid: 0, success_rate: 0 }),
        row({ remote_pubkey: PARTNER_2, remote_alias: "partner-2", attempts: 30, paid: 30, success_rate: 1 }),
      ],
      CONFIG,
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("rebalance_partner_failure");
    expect(cards[0].evidence.detail).not.toHaveProperty("partnerAlias");
  });

  it("emits no partner card at 0/10 — below the 20-attempt binary line", () => {
    const cards = detectRebalance(
      [row({ remote_pubkey: PARTNER_1, attempts: 10, paid: 0, success_rate: 0 })],
      CONFIG,
    );
    expect(cards).toHaveLength(0);
  });

  it("thresholds come from config — raising rebalanceBinaryMinAttempts silences the 0/25 fixture", () => {
    const retuned: InsightKnobs = { ...CONFIG, rebalanceBinaryMinAttempts: 26 };
    const cards = detectRebalance(
      [
        row({ remote_pubkey: PARTNER_1, attempts: 25, paid: 0, success_rate: 0 }),
        row({ remote_pubkey: PARTNER_2, attempts: 30, paid: 30, success_rate: 1 }),
      ],
      retuned,
    );
    expect(cards).toHaveLength(0);
  });
});

describe("detectRebalance — node-level degradation (info)", () => {
  // Canada reference: 37 paid / 143 attempts ~= 26% over 7d.
  const degradedRows = [
    row({ remote_pubkey: PARTNER_1, attempts: 50, paid: 10, success_rate: 0.2 }),
    row({
      remote_pubkey: PARTNER_2,
      remote_alias: "partner-2",
      attempts: 50,
      paid: 12,
      success_rate: 0.24,
    }),
    row({
      remote_pubkey: PARTNER_3,
      remote_alias: "partner-3",
      attempts: "43",
      paid: "15",
      success_rate: "0.3488",
    }),
  ];

  it("fires info rebalance_degraded at 37/143 (rate 0.26 < 0.5, attempts >= 20)", () => {
    const cards = detectRebalance(degradedRows, CONFIG);
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card.signal).toBe("rebalance_degraded");
    expect(card.severity).toBe("info");
    expect(card.target).toEqual({ kind: "node" });
    expect(card.id).toBe(`rebalance_degraded:${NODE_A}:node`);
    expect(card.evidence.metric).toBe("rebalanceSuccessRate");
    expect(card.evidence.observed).toBeCloseTo(37 / 143, 6);
    expect(card.evidence.threshold).toBe(CONFIG.rebalanceSuccessWarnRate);
    expect(card.evidence.detail).toMatchObject({ attempts: 143, paid: 37 });
  });

  it("suggests investigate when no liquidity imbalance is supplied", () => {
    const cards = detectRebalance(degradedRows, CONFIG);
    expect(cards[0].suggestedAction).toEqual({ type: "investigate", params: {} });
  });

  it("emits a bounded rebalance action when a viable partner + imbalance exist", () => {
    // Positive imbalance (localSat - remoteSat > 0) => excess local => "out".
    const cards = detectRebalance(
      degradedRows,
      CONFIG,
      new Map([[NODE_A, 4_000_000]]),
    );
    expect(cards[0].suggestedAction).toEqual({
      type: "rebalance",
      params: {
        // Best viable partner = highest success rate (PARTNER_3 at ~0.349).
        partnerPubkey: PARTNER_3,
        amountSat: 2_000_000, // half the imbalance, under the cap
        direction: "out",
      },
    });
    // EXPORT-01: partnerAlias on the degraded card matches the SAME partner the
    // rebalance action selected (PARTNER_3 → "partner-3") — never re-derived.
    expect(cards[0].evidence.detail?.partnerAlias).toBe("partner-3");
  });

  it("degraded card omits partnerAlias when no rebalance action is selected (investigate)", () => {
    const cards = detectRebalance(degradedRows, CONFIG);
    expect(cards[0].suggestedAction).toEqual({ type: "investigate", params: {} });
    expect(cards[0].evidence.detail).not.toHaveProperty("partnerAlias");
  });

  it("caps amountSat at rebalanceMaxAmountSat (5M) on a huge negative imbalance", () => {
    const cards = detectRebalance(
      degradedRows,
      CONFIG,
      new Map([[NODE_A, -100_000_000_000]]),
    );
    const action = cards[0].suggestedAction;
    expect(action?.type).toBe("rebalance");
    if (action?.type === "rebalance") {
      expect(action.params.amountSat).toBe(CONFIG.rebalanceMaxAmountSat);
      expect(action.params.amountSat).toBeLessThanOrEqual(5_000_000);
      expect(action.params.direction).toBe("in");
    }
  });

  it("falls back to investigate when no partner has any success in the window", () => {
    // All-zero partners below the binary line so only the node card fires.
    const cards = detectRebalance(
      [
        row({ remote_pubkey: PARTNER_1, attempts: 15, paid: 0, success_rate: 0 }),
        row({ remote_pubkey: PARTNER_2, attempts: 15, paid: 0, success_rate: 0 }),
      ],
      CONFIG,
      new Map([[NODE_A, 4_000_000]]),
    );
    expect(cards).toHaveLength(1);
    expect(cards[0].signal).toBe("rebalance_degraded");
    expect(cards[0].suggestedAction).toEqual({ type: "investigate", params: {} });
  });
});

describe("detectRebalance — contract", () => {
  it("every emitted card parses via InsightCardSchema", () => {
    const cards = detectRebalance(
      [
        row({ remote_pubkey: PARTNER_1, attempts: 25, paid: 0, success_rate: 0 }),
        row({ remote_pubkey: PARTNER_2, attempts: 50, paid: 10, success_rate: 0.2 }),
      ],
      CONFIG,
      new Map([[NODE_A, 4_000_000]]),
    );
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expect(() => InsightCardSchema.parse(card)).not.toThrow();
    }
  });
});

// ── 18-06: malformed-pubkey fail-soft (review I2) ─────────────────────────────
describe("detectRebalance — malformed pubkey fail-soft (I2)", () => {
  const BAD_PK = "not-hex-requesting-node";

  it("degrades a malformed-node-pubkey group to no cards instead of throwing", () => {
    const fixture = [
      row({ requesting_node_pubkey: BAD_PK, remote_pubkey: PARTNER_1, attempts: 25, paid: 0, success_rate: 0 }),
    ];
    expect(() => detectRebalance(fixture, CONFIG)).not.toThrow();
    expect(detectRebalance(fixture, CONFIG)).toEqual([]);
  });

  it("still emits the valid node's cards when another node's pubkey is malformed", () => {
    const cards = detectRebalance(
      [
        row({ requesting_node_pubkey: BAD_PK, remote_pubkey: PARTNER_1, attempts: 25, paid: 0, success_rate: 0 }),
        row({ requesting_node_pubkey: NODE_A, remote_pubkey: PARTNER_1, attempts: 25, paid: 0, success_rate: 0 }),
        row({ requesting_node_pubkey: NODE_A, remote_pubkey: PARTNER_2, attempts: 30, paid: 30, success_rate: 1 }),
      ],
      CONFIG,
    );
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) expect(card.node?.pubkey).toBe(NODE_A);
  });
});
