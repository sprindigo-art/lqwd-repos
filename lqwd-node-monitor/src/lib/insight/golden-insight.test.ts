import { beforeAll, describe, expect, it } from "vitest";

import { InsightCardArraySchema } from "@/lib/insight/schema";
import type { InsightCard } from "@/lib/insight/types";
import type { FleetView } from "@/lib/scorecard/types";
import { PENDING_RECENCY_HOURS } from "@/lib/console/config";
import {
  buildPendingView,
  currentPendingChannels,
  currentPendingSweeps,
} from "@/lib/read/pending";

// =====================================================
// GOLDEN — live insight-engine cross-consistency (INSIGHT-02/03)
// =====================================================
// Runs loadInsightView() against the LIVE warehouse and asserts the engine's
// invariants hold over real data — never card COUNTS (live data varies):
//  (a) the single computation resolves;
//  (b) every card re-parses through the frozen contract (the engine already
//      gates on parse — re-assert explicitly so a future gate regression
//      cannot pass silently);
//  (c) flag-source consistency: every node carrying an ap11_close_storm card
//      shows forceClose.tier1Breach !== null in a fresh loadFleetView (ONE
//      flag source — Pitfall 5 / T-04-17);
//  (d) every stuck-pending card's node appears in the sanctioned
//      buildPendingView output (the detector consumes nothing else);
//  (e) every deep link is a validated relative console path or the fleet
//      pending page (T-04-04 — no absolute URLs, no reflected input).
//
// Skips cleanly when ROUTING_VM_DATABASE_URL is absent (golden.test.ts
// pattern); engine + fleet modules are lazy-imported so the suite imports
// without warehouse env.

const HAS_DB = !!process.env.ROUTING_VM_DATABASE_URL;

const DEEP_LINK_RE = /^\/([0-9a-f]{66}\/[a-z-]+|pending)/;

const STUCK_SIGNALS = new Set(["stuck_fc_past_maturity", "stuck_sweep", "stuck_open"]);

const LIVE_TIMEOUT = 120_000;

describe.skipIf(!HAS_DB)("Phase 4 insight engine — live golden cross-check", () => {
  let cards: InsightCard[] = [];
  let fleet: FleetView;
  let pendingPubkeys: Set<string>;

  beforeAll(async () => {
    const [{ loadInsightView }, { loadFleetView }] = await Promise.all([
      import("@/lib/insight/engine"),
      import("@/lib/scorecard/fleet"),
    ]);

    // (a) the call resolves against the live warehouse.
    const view = await loadInsightView();
    cards = view.cards;

    // Fresh fleet view for the (c) flag-source cross-check.
    fleet = await loadFleetView();

    // Sanctioned pending view for the (d) cross-check.
    const [rows, sweeps] = await Promise.all([
      currentPendingChannels(PENDING_RECENCY_HOURS),
      currentPendingSweeps(PENDING_RECENCY_HOURS),
    ]);
    pendingPubkeys = new Set(buildPendingView(rows, sweeps).nodes.map((n) => n.localPubkey));

    console.log(
      `[golden-insight] ${cards.length} card(s) | signals: ${[
        ...new Set(cards.map((c) => c.signal)),
      ].join(", ") || "(none)"}`,
    );
  }, LIVE_TIMEOUT);

  it(
    "every card re-parses through the frozen contract",
    () => {
      expect(() => InsightCardArraySchema.parse(cards)).not.toThrow();
    },
    LIVE_TIMEOUT,
  );

  it(
    "ap11_close_storm cards agree with the fleet tier1Breach flag source",
    () => {
      const stormPubkeys = cards
        .filter((c) => c.signal === "ap11_close_storm")
        .map((c) => c.node?.pubkey)
        .filter((p): p is string => p !== undefined);

      for (const pubkey of stormPubkeys) {
        const node = fleet.nodes.find((n) => n.pubkey === pubkey);
        expect(node, `storm-flagged node ${pubkey} missing from fleet view`).toBeDefined();
        const forceClose = node!.dimensions.find((d) => d.key === "forceClose");
        expect(
          forceClose?.tier1Breach,
          `node ${pubkey} carries a close-storm card but no forceClose tier1Breach`,
        ).not.toBeNull();
      }
    },
    LIVE_TIMEOUT,
  );

  it(
    "every stuck-pending card's node appears in the sanctioned pending view",
    () => {
      const stuck = cards.filter((c) => STUCK_SIGNALS.has(c.signal));
      for (const card of stuck) {
        expect(card.node, `stuck card ${card.id} must carry a node`).not.toBeNull();
        expect(
          pendingPubkeys.has(card.node!.pubkey),
          `stuck card ${card.id} node ${card.node!.pubkey} not in buildPendingView output`,
        ).toBe(true);
      }
    },
    LIVE_TIMEOUT,
  );

  it(
    "every deep link is a validated relative console path or the pending page",
    () => {
      for (const card of cards) {
        expect(
          card.evidence.deepLink,
          `card ${card.id} deepLink ${card.evidence.deepLink}`,
        ).toMatch(DEEP_LINK_RE);
      }
    },
    LIVE_TIMEOUT,
  );
});
