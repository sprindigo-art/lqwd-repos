"use server";

import { isLlmEnabled, narrateCards, type NarrationScope } from "@/lib/insight/narrative";
import type { InsightCard } from "@/lib/insight/types";

// =====================================================
// narrate — D-17 server action (no public API route surface)
// =====================================================
// The ONLY way the UI triggers narration. Defense in depth (T-04-21):
//   - the hidden button is NOT the gate — isLlmEnabled() re-checks server-side;
//   - the action NEVER accepts cards from the client (client-supplied cards
//     would be attacker-controllable prompt input) — the card set is
//     recomputed server-side via loadInsightView() (D-08: the SAME single
//     computation both render surfaces consume);
//   - the only client inputs are the scope level and a pubkey validated
//     against the 66-hex regex before any use.

/** Same pubkey gate as the console page and buildDeepLink. */
const PUBKEY_RE = /^[0-9a-f]{66}$/;

export type NarrateScope = { level: "fleet" } | { level: "node"; pubkey: string };

export type NarrateResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * Server-side card source: the engine's single computation. Lazy import keeps
 * the server-only engine (warehouse pools + env at module load) out of any
 * import graph that merely references this action module.
 */
async function loadCardsForNarration(scope: NarrateScope): Promise<InsightCard[]> {
  const { loadInsightView } = await import("@/lib/insight/engine");
  const view = await loadInsightView();
  if (scope.level === "node") {
    // D-08: the per-node view is a FILTER over the same computation.
    return view.cards.filter((card) => card.node?.pubkey === scope.pubkey);
  }
  return view.cards;
}

/**
 * Deterministic per-node scorecard summary for the node-scope prompt — built
 * from loadFleetView (the same fleet computation the scorecard pages render),
 * never from client input.
 */
async function scorecardSummaryFor(pubkey: string, cardCount: number): Promise<string> {
  const { loadFleetView } = await import("@/lib/scorecard/fleet");
  const fleet = await loadFleetView();
  const node = fleet.nodes.find((n) => n.pubkey === pubkey);
  if (!node) {
    return `no scorecard found for this pubkey; ${cardCount} active insight card(s) at narration time`;
  }
  const composite =
    node.compositeLetter !== null && node.compositePct !== null
      ? `${node.compositeLetter} (${node.compositePct}%)`
      : "ungraded";
  const chips = node.criticalChips.length > 0 ? node.criticalChips.join(", ") : "none";
  const dims = node.dimensions
    .map((d) => `${d.key}=${d.letter ?? "no-data"}`)
    .join(", ");
  return [
    `alias: ${node.alias ?? "unknown"}; backend: ${node.backend}`,
    `composite grade: ${composite}; status: ${node.dot}; critical chips: ${chips}`,
    `dimensions: ${dims}`,
    `${cardCount} active insight card(s) for this node at narration time`,
  ].join("\n");
}

/** D-17 — both trigger levels: inbox-wide ("fleet") and per-node. */
export async function narrate(scope: NarrateScope): Promise<NarrateResult> {
  // Defense in depth: the env gate is enforced HERE, not by UI visibility.
  if (!isLlmEnabled()) {
    return { ok: false, error: "LLM narration is disabled (INSIGHT_LLM_ENABLED is not 'true')." };
  }
  if (scope.level !== "fleet" && scope.level !== "node") {
    return { ok: false, error: "invalid scope level" };
  }
  if (scope.level === "node" && !PUBKEY_RE.test(scope.pubkey)) {
    return { ok: false, error: "invalid pubkey (expected 66 lowercase hex characters)" };
  }
  try {
    const cards = await loadCardsForNarration(scope);
    const narrationScope: NarrationScope =
      scope.level === "node"
        ? {
            level: "node",
            pubkey: scope.pubkey,
            scorecardSummary: await scorecardSummaryFor(scope.pubkey, cards.length),
          }
        : { level: "fleet" };
    const text = await narrateCards(cards, narrationScope);
    return { ok: true, text };
  } catch (error) {
    console.error("narrate action failed:", error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
