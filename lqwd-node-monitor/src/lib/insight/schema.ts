import { z } from "zod";

// =====================================================
// InsightCard zod contract (Phase 4 — INSIGHT-01, D-02)
// =====================================================
// THE frozen contract artifact. Phase 5 (export) and Phase 6 (signed queue)
// import this exact schema; every Phase-4 detector and UI module codes against
// it. Any shape change is a breaking change by design — the contract test
// (schema.contract.test.ts) fails until its snapshot is deliberately
// regenerated AND CARD_SCHEMA_VERSION is bumped together.
//
// Pure module: NO server-side-only imports, no DB imports — test-imported and
// safe anywhere (Phase 5 client-side export generation imports it).
//
// Invariants encoded here:
//  - D-01: severity is EXACTLY the scorecard taxonomy critical|warn|info — no
//    second taxonomy.
//  - D-03: suggestedAction is a discriminated union per action type; every
//    params object is flat and JSON-canonicalizable (Phase 6 signs
//    canonical(params)). `investigate` carries `{}` — NEVER undefined —
//    absent-vs-empty ambiguity is a signing-surface bug.
//  - D-04: evidence is structured (metric/observed/threshold/unit/window/
//    asOf/deepLink); evidence.asOf is an ISO STRING, not Date — cards must
//    JSON round-trip identically for Phase 6 canonical signing.
//  - D-12: provenance "llm-inference" ⇒ severity "info" AND suggestedAction
//    null — enforced structurally via .superRefine, not in caller code.
//  - Fleet cards: node === null ⇔ target.kind === "fleet" (refinement).
//  - .strict() on EVERY object level — field additions are breaking changes.

export const CARD_SCHEMA_VERSION = 1 as const;

export const SeveritySchema = z.enum(["critical", "warn", "info"]);

export const DetectorIdSchema = z.enum([
  "ap11_close_storm",
  "ap12a_conn_exhaustion",
  "ap12b_serialization",
  "htlc_timeout_fc",
  "fee_raise",
  "fee_lower",
  "channel_close_candidate",
  "rebalance_partner_failure",
  "rebalance_degraded",
  "fee_stepdown",
  "fleet_close_cluster",
  "stuck_fc_past_maturity",
  "stuck_sweep",
  "stuck_open",
]);

// Target — discriminated by kind. Fleet-scope cards (close-cluster) have no
// single node.
export const CardTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("node") }).strict(),
  z
    .object({
      kind: z.literal("channel"),
      chanId: z.string().nullable(),
      channelPoint: z.string().nullable(),
      remotePubkey: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sweep"),
      outpointTxid: z.string(),
      outpointOutputIndex: z.number(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("fleet"),
      pubkeys: z.array(z.string()),
    })
    .strict(),
]);

// Evidence — D-04 structured: the inbox sorts/filters on it; the LLM narrates
// from it. observed/threshold stay RAW units (AFM-002 formatter at render only).
export const CardEvidenceSchema = z
  .object({
    metric: z.string(),
    observed: z.number(),
    threshold: z.number(),
    unit: z.string(),
    window: z.string(),
    // ISO timestamp STRING (not z.date()) — JSON round-trip for Phase 6
    // canonical signing.
    asOf: z.string(),
    deepLink: z.string(),
    detail: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  })
  .strict();

// D-03 — discriminated union; Phase 6 signs canonical(params), so every params
// object is flat, JSON-canonicalizable, and carries NO optional ambiguity
// beyond explicit nulls.
export const SuggestedActionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("update_fee"),
      params: z
        .object({
          chanId: z.string(),
          channelPoint: z.string(),
          currentPpm: z.number(),
          suggestedPpm: z.number(),
          baseFeeMsat: z.number(),
          timeLockDelta: z.number(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("close_channel"),
      params: z
        .object({
          chanId: z.string(),
          channelPoint: z.string(),
          force: z.boolean(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("rebalance"),
      params: z
        .object({
          partnerPubkey: z.string(),
          amountSat: z.number(),
          direction: z.enum(["out", "in"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("remediate_pending"),
      params: z
        .object({
          case: z.enum(["bump_fee", "restart_procedure", "aged_funding"]),
          channelPoint: z.string().nullable(),
          outpointTxid: z.string().nullable(),
          suggestedSatPerVbyte: z.number().nullable(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      type: z.literal("investigate"),
      // Empty object, NEVER undefined — uniform canonical signing surface.
      params: z.object({}).strict(),
    })
    .strict(),
]);

export const InsightCardSchema = z
  .object({
    schemaVersion: z.literal(CARD_SCHEMA_VERSION),
    id: z.string(),
    severity: SeveritySchema,
    // null ONLY for kind:"fleet" targets (enforced by refinement below).
    node: z
      .object({
        pubkey: z.string(),
        alias: z.string().nullable(),
        backend: z.enum(["lnd", "ldk"]),
      })
      .strict()
      .nullable(),
    target: CardTargetSchema,
    signal: DetectorIdSchema,
    evidence: CardEvidenceSchema,
    // null on LLM-advisory cards (D-12) and pure-info cards.
    suggestedAction: SuggestedActionSchema.nullable(),
    // D-14 — always present, visible state.
    suppressed: z
      .object({
        active: z.boolean(),
        reason: z.string().nullable(),
      })
      .strict(),
    // D-12 labeling; llm-inference ⇒ severity "info" + suggestedAction null
    // (refinement below enforces).
    provenance: z.enum(["deterministic", "llm-inference"]),
    // D-16 — guidance text on write cards only.
    rateLimitGuidance: z.string().nullable(),
  })
  .strict()
  .superRefine((card, ctx) => {
    // D-12: LLM-provenance cards may never reach the signing surface —
    // advisory-only severity and no suggested action.
    if (card.provenance === "llm-inference") {
      if (card.severity !== "info") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["severity"],
          message: 'D-12: provenance "llm-inference" requires severity "info"',
        });
      }
      if (card.suggestedAction !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["suggestedAction"],
          message: 'D-12: provenance "llm-inference" requires suggestedAction null',
        });
      }
    }
    // node === null ⇔ target.kind === "fleet"
    if (card.node === null && card.target.kind !== "fleet") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["node"],
        message: 'node may be null ONLY when target.kind === "fleet"',
      });
    }
    if (card.node !== null && card.target.kind === "fleet") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["node"],
        message: 'fleet-target cards must set node to null',
      });
    }
  });

export const InsightCardArraySchema = z.array(InsightCardSchema);
