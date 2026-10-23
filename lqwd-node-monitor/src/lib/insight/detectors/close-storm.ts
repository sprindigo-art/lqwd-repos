import { buildDeepLink } from "@/lib/insight/deeplink";
import { CARD_SCHEMA_VERSION, type InsightCard } from "@/lib/insight/types";
import { SCORECARD_CONFIG, type Tier1Line } from "@/lib/scorecard/config";
import type { FleetView } from "@/lib/scorecard/types";

// buildDeepLink throws on a non-`^[0-9a-f]{66}$` pubkey; assembleCards is not
// degrade()-wrapped, so one malformed warehouse pubkey would reject the whole
// insight view (review I2). Pre-check and skip that node — fail-soft. */
const PUBKEY_RE = /^[0-9a-f]{66}$/;

// =====================================================
// AP-11 close-storm detector (Phase 4 — INSIGHT-02, detector 1)
// =====================================================
// Pure module: NO SQL, no server-only, no DB import — the metric is ALREADY
// computed. forceCloseForFleet() hour-buckets INITIATOR_LOCAL closes over the
// last 24h into extras.maxHourlySelfCloses; this detector consumes the
// FleetView one more time (one query, two consumers — RESEARCH detector 1).
//
// Threshold (D-13): READ from SCORECARD_CONFIG[backend].forceClose.tier1.value
// at the use-site — the number lives ONLY in the scorecard tuning surface and
// is never restated here (the test moves the firing line through a mock
// config; grep guards assert this module carries no threshold literal).
//
// AP-11 playbook (operational-anti-patterns.md): do NOT auto-restart — freeze
// channel.db, preserve logs, diagnose chain-backend sync health. This card
// NEVER carries write params; suggestedAction is always `investigate`.
//
// Suppression flag source (D-14): closeStormFlaggedPubkeys() below is THE
// typed flag set guardrails.ts (04-07) imports to suppress write cards on
// storm-flagged nodes. Access is the typed tier1Breach field on the forceClose
// dimension — NEVER label/chip string matching (RESEARCH Pitfall 5: an
// operator label retune must not silently disable suppression).

/** Evaluate a Tier-1 line's configured operator — mirrors grade.ts evaluateTier1. */
function breaches(observed: number, tier1: Tier1Line): boolean {
  return (
    (tier1.op === ">" && observed > tier1.value) ||
    (tier1.op === "<" && observed < tier1.value) ||
    (tier1.op === ">=" && observed >= tier1.value) ||
    (tier1.op === "<=" && observed <= tier1.value)
  );
}

/**
 * AP-11 close-storm cards: one critical card per node whose forceClose
 * dimension extras carry a maxHourlySelfCloses at/past the configured Tier-1
 * line. Missing dimension, missing extras, or a missing/non-numeric metric →
 * silently no card (a node without close data is not in a storm).
 *
 * `config` defaults to the live SCORECARD_CONFIG; tests inject a mock to prove
 * the firing line is a config read.
 */
export function detectCloseStorm(
  view: FleetView,
  config: typeof SCORECARD_CONFIG = SCORECARD_CONFIG,
): InsightCard[] {
  const cards: InsightCard[] = [];
  for (const node of view.nodes) {
    // Typed dimension access by key — never label matching (Pitfall 5).
    const dim = node.dimensions.find((d) => d.key === "forceClose");
    if (!dim) continue;
    const tier1 = config[node.backend].forceClose.tier1;
    if (!tier1) continue;
    const observed = tier1.metric === "raw" ? dim.raw : dim.extras?.[tier1.metric];
    if (typeof observed !== "number" || Number.isNaN(observed)) continue;
    if (!breaches(observed, tier1)) continue;
    // I2 fail-soft: skip a node whose pubkey can't build a deep link.
    if (!PUBKEY_RE.test(node.pubkey)) continue;
    cards.push({
      schemaVersion: CARD_SCHEMA_VERSION,
      // D-08 dedupe id: signal:pubkey:targetKey — node targets use "node".
      id: `ap11_close_storm:${node.pubkey}:node`,
      severity: "critical",
      node: { pubkey: node.pubkey, alias: node.alias, backend: node.backend },
      target: { kind: "node" },
      signal: "ap11_close_storm",
      evidence: {
        metric: tier1.metric,
        observed,
        threshold: tier1.value,
        unit: "closes/hr",
        // The storm metric is defined over the dimension's fixed 24h scan
        // (buildSelfCloseStormSql default) — not a tunable window here.
        window: "24h",
        asOf: (dim.asOf ?? view.fetchedAt).toISOString(),
        deepLink: buildDeepLink(node.pubkey, "closes"),
      },
      // AP-11 playbook: investigate ONLY — never a write action.
      suggestedAction: { type: "investigate", params: {} },
      suppressed: { active: false, reason: null },
      provenance: "deterministic",
      rateLimitGuidance: null,
    });
  }
  return cards;
}

/**
 * D-14 suppression flag set: pubkeys whose forceClose dimension carries a
 * non-null tier1Breach. Typed-field access — a missing dimension never flags
 * (`undefined !== null` would be a false positive; guard explicitly).
 * Consumed by guardrails.ts (04-07) to suppress write cards on flagged nodes.
 */
export function closeStormFlaggedPubkeys(view: FleetView): Set<string> {
  const flagged = new Set<string>();
  for (const node of view.nodes) {
    const dim = node.dimensions.find((d) => d.key === "forceClose");
    if (dim !== undefined && dim.tier1Breach !== null) flagged.add(node.pubkey);
  }
  return flagged;
}
