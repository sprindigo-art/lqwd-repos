import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DetectorId, InsightCard, Severity } from "@/lib/insight/types";
import {
  applyFacets,
  facetCounts,
  partitionTriage,
  seriesKindFor,
  type FacetState,
} from "@/lib/insight/triage";

const moduleSource = readFileSync(
  fileURLToPath(new URL("./triage.ts", import.meta.url)),
  "utf8",
);

// ── Fixture factory ──────────────────────────────────────────────────────────
// Build a minimal, schema-shaped InsightCard. Only the fields the pure transforms
// read are varied; the rest carry inert-but-valid defaults. We do NOT import the
// engine or DB — pure-module discipline (Pitfall: no fan-out).
let seq = 0;
function card(overrides: {
  severity: Severity;
  signal?: DetectorId;
  pubkey?: string | null;
  suppressed?: boolean;
  actionType?: InsightCard["suggestedAction"] extends infer A ? string | null : never;
  metric?: string;
  fleet?: boolean;
}): InsightCard {
  const {
    severity,
    signal = "fee_raise",
    pubkey = "a".repeat(66),
    suppressed = false,
    actionType = null,
    metric = "ppm",
    fleet = false,
  } = overrides;
  seq += 1;
  const isFleet = fleet || pubkey === null;
  const suggestedAction =
    actionType === "update_fee"
      ? ({
          type: "update_fee",
          params: {
            chanId: "1x1x1",
            channelPoint: "txid:0",
            currentPpm: 100,
            suggestedPpm: 200,
            baseFeeMsat: 1000,
            timeLockDelta: 40,
          },
        } as InsightCard["suggestedAction"])
      : actionType === "close_channel"
        ? ({
            type: "close_channel",
            params: { chanId: "1x1x1", channelPoint: "txid:0", force: false },
          } as InsightCard["suggestedAction"])
        : actionType === "investigate"
          ? ({ type: "investigate", params: {} } as InsightCard["suggestedAction"])
          : null;
  return {
    schemaVersion: 1,
    id: `card-${seq}`,
    severity,
    node: isFleet ? null : { pubkey: pubkey as string, alias: "node", backend: "lnd" },
    target: isFleet
      ? { kind: "fleet", pubkeys: [(pubkey as string) ?? "x"] }
      : { kind: "node" },
    signal,
    evidence: {
      metric,
      observed: 1,
      threshold: 2,
      unit: "ppm",
      window: "7d",
      asOf: "2026-06-16T00:00:00.000Z",
      deepLink: "/x",
    },
    suggestedAction,
    suppressed: { active: suppressed, reason: suppressed ? "AP-11 close storm" : null },
    provenance: "deterministic",
    rateLimitGuidance: null,
  } as InsightCard;
}

const PUBKEY_A = "a".repeat(66);
const PUBKEY_B = "b".repeat(66);

function mixedFixture(): InsightCard[] {
  return [
    card({ severity: "critical", signal: "ap11_close_storm", pubkey: PUBKEY_A }),
    card({ severity: "warn", signal: "fee_raise", pubkey: PUBKEY_A, actionType: "update_fee" }),
    card({ severity: "info", signal: "fee_raise", pubkey: PUBKEY_A }),
    card({ severity: "info", signal: "fee_raise", pubkey: PUBKEY_B }),
    card({ severity: "info", signal: "fee_lower", pubkey: PUBKEY_A }),
    // info-but-suppressed → suppressed block, NOT a group
    card({ severity: "info", signal: "stuck_open", pubkey: PUBKEY_A, suppressed: true }),
    // critical-but-suppressed → suppressed block (suppression wins)
    card({ severity: "critical", signal: "stuck_sweep", pubkey: PUBKEY_B, suppressed: true }),
    // fleet info card
    card({ severity: "info", signal: "fleet_close_cluster", fleet: true }),
  ];
}

describe("partitionTriage", () => {
  it("no card is dropped: count-in === count-out across {spine, groups, suppressed}", () => {
    const cards = mixedFixture();
    const { spine, groups, suppressed } = partitionTriage(cards);
    let grouped = 0;
    for (const byNode of groups.values()) {
      for (const list of byNode.values()) grouped += list.length;
    }
    expect(spine.length + grouped + suppressed.length).toBe(cards.length);
  });

  it("puts every critical + warn (non-suppressed) card in the spine, only info in groups", () => {
    const cards = mixedFixture();
    const { spine, groups } = partitionTriage(cards);
    for (const c of spine) {
      expect(c.severity === "critical" || c.severity === "warn").toBe(true);
      expect(c.suppressed.active).toBe(false);
    }
    for (const byNode of groups.values()) {
      for (const list of byNode.values()) {
        for (const c of list) {
          expect(c.severity).toBe("info");
          expect(c.suppressed.active).toBe(false);
        }
      }
    }
  });

  it("a critical card is NEVER placed inside a group/fold", () => {
    const cards = mixedFixture();
    const { groups } = partitionTriage(cards);
    for (const byNode of groups.values()) {
      for (const list of byNode.values()) {
        for (const c of list) {
          expect(c.severity).not.toBe("critical");
        }
      }
    }
  });

  it("info-but-suppressed cards go to the suppressed block, not the groups", () => {
    const cards = mixedFixture();
    const { groups, suppressed } = partitionTriage(cards);
    expect(suppressed.some((c) => c.signal === "stuck_open")).toBe(true);
    for (const byNode of groups.values()) {
      for (const list of byNode.values()) {
        expect(list.some((c) => c.signal === "stuck_open")).toBe(false);
      }
    }
  });

  it("nests info groups signal → (node.pubkey ?? 'fleet'), preserving engine order", () => {
    const cards = mixedFixture();
    const { groups } = partitionTriage(cards);
    const feeRaise = groups.get("fee_raise");
    expect(feeRaise).toBeDefined();
    expect(feeRaise?.get(PUBKEY_A)).toHaveLength(1);
    expect(feeRaise?.get(PUBKEY_B)).toHaveLength(1);
    expect(groups.get("fleet_close_cluster")?.get("fleet")).toHaveLength(1);
  });

  it("preserves engine order within each partition (no re-sort)", () => {
    const cards = mixedFixture();
    const { spine } = partitionTriage(cards);
    // spine cards appear in the same relative order as the source array
    const sourceSpineIds = cards
      .filter((c) => (c.severity === "critical" || c.severity === "warn") && !c.suppressed.active)
      .map((c) => c.id);
    expect(spine.map((c) => c.id)).toEqual(sourceSpineIds);
  });
});

describe("facetCounts", () => {
  it("computes over the FULL passed array, independent of any active facet", () => {
    const cards = mixedFixture();
    const all = facetCounts(cards);
    // facetCounts takes only the card array — there is no facet-state arg to leak in.
    expect(facetCounts.length).toBe(1);
    expect(all.severity.critical).toBe(2);
    expect(all.severity.warn).toBe(1);
    expect(all.severity.info).toBe(5);
    expect(all.signal.fee_raise).toBe(3);
    expect(all.node[PUBKEY_A]?.count).toBeGreaterThan(0);
    expect(all.node[PUBKEY_A]?.alias).toBe("node");
    expect(all.action.none).toBeGreaterThan(0);
    expect(all.action.update_fee).toBe(1);
  });

  it("is unchanged when the rendered set is later narrowed by applyFacets", () => {
    const cards = mixedFixture();
    const before = facetCounts(cards);
    applyFacets(cards, { sev: ["critical"], node: [], signal: [], action: [] });
    const after = facetCounts(cards);
    expect(after).toEqual(before);
  });
});

describe("applyFacets", () => {
  it("narrows the spine by severity", () => {
    const cards = mixedFixture();
    const state: FacetState = { sev: ["critical"], node: [], signal: [], action: [] };
    const out = applyFacets(cards, state);
    expect(out.every((c) => c.severity === "critical")).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("combined facets narrow further (AND across dimensions)", () => {
    const cards = mixedFixture();
    const state: FacetState = {
      sev: ["info"],
      node: [PUBKEY_A],
      signal: ["fee_raise"],
      action: [],
    };
    const out = applyFacets(cards, state);
    expect(out).toHaveLength(1);
    expect(out[0]?.signal).toBe("fee_raise");
    expect(out[0]?.node?.pubkey).toBe(PUBKEY_A);
  });

  it("an empty facet state returns the full set unchanged", () => {
    const cards = mixedFixture();
    const out = applyFacets(cards, { sev: [], node: [], signal: [], action: [] });
    expect(out).toHaveLength(cards.length);
  });

  it("filters by action type, mapping null actions to 'none'", () => {
    const cards = mixedFixture();
    const out = applyFacets(cards, { sev: [], node: [], signal: [], action: ["update_fee"] });
    expect(out).toHaveLength(1);
    expect(out[0]?.suggestedAction?.type).toBe("update_fee");
  });
});

describe("seriesKindFor", () => {
  it("returns 'forwards-fees' for fee/revenue evidence signals", () => {
    for (const signal of [
      "fee_raise",
      "fee_lower",
      "fee_stepdown",
      "channel_close_candidate",
    ] as DetectorId[]) {
      expect(seriesKindFor(card({ severity: "info", signal }))).toBe("forwards-fees");
    }
  });

  it("returns 'closes' for close-evidence signals", () => {
    for (const signal of [
      "ap11_close_storm",
      "fleet_close_cluster",
      "htlc_timeout_fc",
    ] as DetectorId[]) {
      // fleet_close_cluster is a fleet card (node null) → null; test non-fleet ones here
      const c = card({ severity: "info", signal, fleet: signal === "fleet_close_cluster" });
      if (signal === "fleet_close_cluster") {
        expect(seriesKindFor(c)).toBeNull();
      } else {
        expect(seriesKindFor(c)).toBe("closes");
      }
    }
  });

  it("returns null for latest-state dims (stuck/rebalance) → honest no-trend-data", () => {
    for (const signal of [
      "stuck_open",
      "stuck_sweep",
      "stuck_fc_past_maturity",
      "rebalance_partner_failure",
      "rebalance_degraded",
    ] as DetectorId[]) {
      expect(seriesKindFor(card({ severity: "info", signal }))).toBeNull();
    }
  });

  it("returns null for any fleet-target card (no single pubkey)", () => {
    expect(seriesKindFor(card({ severity: "info", signal: "fee_raise", fleet: true }))).toBeNull();
  });
});

describe("triage.ts purity", () => {
  it("imports no server-only / DB runtime", () => {
    expect(moduleSource).not.toContain("server" + "-only");
    expect(moduleSource).not.toMatch(/from "@\/lib\/(db|queue)\//);
  });
});
