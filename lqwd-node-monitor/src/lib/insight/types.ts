import type { z } from "zod";
import {
  CARD_SCHEMA_VERSION,
  CardEvidenceSchema,
  CardTargetSchema,
  DetectorIdSchema,
  InsightCardSchema,
  SeveritySchema,
  SuggestedActionSchema,
} from "@/lib/insight/schema";

// =====================================================
// InsightCard type contracts (Phase 4 — INSIGHT-01)
// =====================================================
// Pure module: NO server-side-only imports, no DB imports — test-imported and
// safe anywhere. All types derive from the zod validator via z.infer so the type
// surface and the runtime contract CANNOT drift (D-02). Detectors import
// types only; the engine boundary calls InsightCardSchema.array().parse()
// once before returning.
//
// Invariants encoded here:
//  - raw values stay RAW (sats, ratios, counts, PPM) — the AFM-002 formatter
//    (src/lib/format/units.ts) applies at render only; nothing in this layer
//    converts units. evidence.observed / evidence.threshold are raw numbers.
//  - Dedupe-id rule (D-08 — stable across recomputes while the condition
//    persists, distinct per (detector, node, target), no randomness):
//      id = `${signal}:${node?.pubkey ?? "fleet"}:${targetKey}`
//    where targetKey =
//      - channels: chanId ?? channelPoint
//      - sweeps:   `${outpointTxid}:${outpointOutputIndex}`
//      - node:     "node"
//      - fleet:    pubkeys.sort().join("+") plus the cluster hour bucket
//                  (the hour IS the event identity for fleet-cluster cards).
//  - Severity reuses the scorecard taxonomy verbatim (D-01); no new values.

export { CARD_SCHEMA_VERSION };

export type Severity = z.infer<typeof SeveritySchema>;
export type DetectorId = z.infer<typeof DetectorIdSchema>;
export type CardTarget = z.infer<typeof CardTargetSchema>;
export type CardEvidence = z.infer<typeof CardEvidenceSchema>;
export type SuggestedAction = z.infer<typeof SuggestedActionSchema>;
export type InsightCard = z.infer<typeof InsightCardSchema>;
