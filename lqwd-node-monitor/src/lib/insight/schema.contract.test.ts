import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { CARD_SCHEMA_VERSION, InsightCardSchema } from "@/lib/insight/schema";

// InsightCard contract freeze (D-02 — Wave 0). Two layers:
//  1. "fixture freeze" — every committed fixture card parses; deliberately
//     mutated copies FAIL (strict rejection, missing params, D-12 refinement).
//  2. "shape snapshot" — the zod schema's introspected key paths are compared
//     against a committed snapshot string that EMBEDS the schemaVersion
//     literal. Any field add/remove/rename fails this test until the snapshot
//     is deliberately regenerated AND CARD_SCHEMA_VERSION is bumped together.
//
// To regenerate after an INTENTIONAL schema change: bump CARD_SCHEMA_VERSION
// in schema.ts, update the fixture, and replace EXPECTED_SHAPE_SNAPSHOT with
// the output of buildShapeSnapshot(InsightCardSchema).

const fixturePath = fileURLToPath(new URL("./schema-fixture.json", import.meta.url));
const fixtureCards: unknown[] = JSON.parse(readFileSync(fixturePath, "utf8"));

/** Deep-clone a fixture card so mutations never leak between assertions. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cardFor(signal: string): Record<string, unknown> {
  const card = fixtureCards.find(
    (c) => (c as Record<string, unknown>).signal === signal,
  ) as Record<string, unknown> | undefined;
  if (!card) throw new Error(`fixture missing card for signal ${signal}`);
  return clone(card);
}

// ── shape-snapshot walker ──────────────────────────────────────────────────
// Recursively collects dotted key paths + type descriptors from the zod
// schema. Enum memberships and literal values are embedded so adding a
// DetectorId or changing schemaVersion also breaks the freeze.

function buildShapeSnapshot(schema: z.ZodTypeAny): string {
  const out: string[] = [];
  walk(schema, "$", out);
  return out.sort().join("\n");
}

function walk(schema: z.ZodTypeAny, path: string, out: string[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const def = (schema as any)._def;
  switch (def.typeName) {
    case "ZodEffects":
      walk(def.schema, path, out);
      break;
    case "ZodNullable":
      out.push(`${path} nullable`);
      walk(def.innerType, path, out);
      break;
    case "ZodOptional":
      out.push(`${path} optional`);
      walk(def.innerType, path, out);
      break;
    case "ZodObject": {
      const shape = def.shape();
      out.push(`${path} object(strict=${def.unknownKeys === "strict"})`);
      for (const key of Object.keys(shape)) {
        walk(shape[key], `${path}.${key}`, out);
      }
      break;
    }
    case "ZodDiscriminatedUnion": {
      out.push(`${path} discriminatedUnion(${def.discriminator})`);
      for (const option of def.options) {
        const disc = option.shape[def.discriminator]._def.value;
        walk(option, `${path}[${def.discriminator}=${String(disc)}]`, out);
      }
      break;
    }
    case "ZodUnion": {
      out.push(`${path} union`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      def.options.forEach((option: any, i: number) => walk(option, `${path}|${i}`, out));
      break;
    }
    case "ZodArray":
      out.push(`${path} array`);
      walk(def.type, `${path}[]`, out);
      break;
    case "ZodRecord":
      out.push(`${path} record`);
      walk(def.valueType, `${path}{}`, out);
      break;
    case "ZodEnum":
      out.push(`${path} enum(${def.values.join("|")})`);
      break;
    case "ZodLiteral":
      out.push(`${path} literal(${JSON.stringify(def.value)})`);
      break;
    default:
      out.push(`${path} ${String(def.typeName).replace(/^Zod/, "").toLowerCase()}`);
  }
}

// Committed snapshot — regenerating this REQUIRES bumping CARD_SCHEMA_VERSION.
// The `$.schemaVersion literal(1)` line embeds the version: a schema change
// that keeps the old version produces a snapshot mismatch on that line too.
const EXPECTED_SHAPE_SNAPSHOT = `$ object(strict=true)
$.evidence object(strict=true)
$.evidence.asOf string
$.evidence.deepLink string
$.evidence.detail optional
$.evidence.detail record
$.evidence.detail{} union
$.evidence.detail{}|0 string
$.evidence.detail{}|1 number
$.evidence.metric string
$.evidence.observed number
$.evidence.threshold number
$.evidence.unit string
$.evidence.window string
$.id string
$.node nullable
$.node object(strict=true)
$.node.alias nullable
$.node.alias string
$.node.backend enum(lnd|ldk)
$.node.pubkey string
$.provenance enum(deterministic|llm-inference)
$.rateLimitGuidance nullable
$.rateLimitGuidance string
$.schemaVersion literal(1)
$.severity enum(critical|warn|info)
$.signal enum(ap11_close_storm|ap12a_conn_exhaustion|ap12b_serialization|htlc_timeout_fc|fee_raise|fee_lower|channel_close_candidate|rebalance_partner_failure|rebalance_degraded|fee_stepdown|fleet_close_cluster|stuck_fc_past_maturity|stuck_sweep|stuck_open)
$.suggestedAction discriminatedUnion(type)
$.suggestedAction nullable
$.suggestedAction[type=close_channel] object(strict=true)
$.suggestedAction[type=close_channel].params object(strict=true)
$.suggestedAction[type=close_channel].params.chanId string
$.suggestedAction[type=close_channel].params.channelPoint string
$.suggestedAction[type=close_channel].params.force boolean
$.suggestedAction[type=close_channel].type literal("close_channel")
$.suggestedAction[type=investigate] object(strict=true)
$.suggestedAction[type=investigate].params object(strict=true)
$.suggestedAction[type=investigate].type literal("investigate")
$.suggestedAction[type=rebalance] object(strict=true)
$.suggestedAction[type=rebalance].params object(strict=true)
$.suggestedAction[type=rebalance].params.amountSat number
$.suggestedAction[type=rebalance].params.direction enum(out|in)
$.suggestedAction[type=rebalance].params.partnerPubkey string
$.suggestedAction[type=rebalance].type literal("rebalance")
$.suggestedAction[type=remediate_pending] object(strict=true)
$.suggestedAction[type=remediate_pending].params object(strict=true)
$.suggestedAction[type=remediate_pending].params.case enum(bump_fee|restart_procedure|aged_funding)
$.suggestedAction[type=remediate_pending].params.channelPoint nullable
$.suggestedAction[type=remediate_pending].params.channelPoint string
$.suggestedAction[type=remediate_pending].params.outpointTxid nullable
$.suggestedAction[type=remediate_pending].params.outpointTxid string
$.suggestedAction[type=remediate_pending].params.suggestedSatPerVbyte nullable
$.suggestedAction[type=remediate_pending].params.suggestedSatPerVbyte number
$.suggestedAction[type=remediate_pending].type literal("remediate_pending")
$.suggestedAction[type=update_fee] object(strict=true)
$.suggestedAction[type=update_fee].params object(strict=true)
$.suggestedAction[type=update_fee].params.baseFeeMsat number
$.suggestedAction[type=update_fee].params.chanId string
$.suggestedAction[type=update_fee].params.channelPoint string
$.suggestedAction[type=update_fee].params.currentPpm number
$.suggestedAction[type=update_fee].params.suggestedPpm number
$.suggestedAction[type=update_fee].params.timeLockDelta number
$.suggestedAction[type=update_fee].type literal("update_fee")
$.suppressed object(strict=true)
$.suppressed.active boolean
$.suppressed.reason nullable
$.suppressed.reason string
$.target discriminatedUnion(kind)
$.target[kind=channel] object(strict=true)
$.target[kind=channel].chanId nullable
$.target[kind=channel].chanId string
$.target[kind=channel].channelPoint nullable
$.target[kind=channel].channelPoint string
$.target[kind=channel].kind literal("channel")
$.target[kind=channel].remotePubkey nullable
$.target[kind=channel].remotePubkey string
$.target[kind=fleet] object(strict=true)
$.target[kind=fleet].kind literal("fleet")
$.target[kind=fleet].pubkeys array
$.target[kind=fleet].pubkeys[] string
$.target[kind=node] object(strict=true)
$.target[kind=node].kind literal("node")
$.target[kind=sweep] object(strict=true)
$.target[kind=sweep].kind literal("sweep")
$.target[kind=sweep].outpointOutputIndex number
$.target[kind=sweep].outpointTxid string`;

// ── 1. fixture freeze ──────────────────────────────────────────────────────

describe("fixture freeze", () => {
  it("every committed fixture card parses via InsightCardSchema", () => {
    expect(fixtureCards.length).toBeGreaterThanOrEqual(14);
    for (const card of fixtureCards) {
      expect(() => InsightCardSchema.parse(card)).not.toThrow();
    }
  });

  it("fixture covers all 14 detector signals", () => {
    const signals = new Set(fixtureCards.map((c) => (c as Record<string, unknown>).signal));
    expect(signals.size).toBe(14);
  });

  it("fixture covers suppressed, llm-inference, and fleet cards", () => {
    const records = fixtureCards as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(records.some((c) => c.suppressed.active === true)).toBe(true);
    expect(records.some((c) => c.provenance === "llm-inference")).toBe(true);
    expect(records.some((c) => c.target.kind === "fleet" && c.node === null)).toBe(true);
  });

  it('rejects a wrong severity value ("error" is not in the D-01 taxonomy)', () => {
    const card = cardFor("ap11_close_storm");
    card.severity = "error";
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });

  it("rejects an extra unknown key at card level (strict)", () => {
    const card = cardFor("ap11_close_storm");
    card.extraKey = "nope";
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });

  it("rejects update_fee params missing suggestedPpm", () => {
    const card = cardFor("fee_raise");
    const action = card.suggestedAction as { params: Record<string, unknown> };
    delete action.params.suggestedPpm;
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });

  it('rejects D-12 violation: provenance "llm-inference" with a non-null suggestedAction', () => {
    const card = cardFor("ap12a_conn_exhaustion");
    card.suggestedAction = { type: "investigate", params: {} };
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });

  it('rejects D-12 violation: provenance "llm-inference" with non-info severity', () => {
    const card = cardFor("ap12b_serialization");
    card.severity = "warn";
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });

  it('rejects node: null when target.kind is "node" (fleet-only refinement)', () => {
    const card = cardFor("ap11_close_storm");
    card.node = null;
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });

  it("rejects a non-null node on a fleet-target card", () => {
    const card = cardFor("fleet_close_cluster");
    card.node = {
      pubkey: "02a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1",
      alias: null,
      backend: "lnd",
    };
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });

  it("rejects investigate with params undefined ({} is mandatory — signing surface)", () => {
    const card = cardFor("ap11_close_storm");
    const action = card.suggestedAction as Record<string, unknown>;
    delete action.params;
    expect(InsightCardSchema.safeParse(card).success).toBe(false);
  });
});

// ── 2. shape snapshot ──────────────────────────────────────────────────────

describe("shape snapshot", () => {
  it("schema key paths match the committed snapshot (regenerate ONLY with a version bump)", () => {
    expect(buildShapeSnapshot(InsightCardSchema)).toBe(EXPECTED_SHAPE_SNAPSHOT);
  });

  it("snapshot embeds the schemaVersion literal so a regen forces a version bump", () => {
    expect(EXPECTED_SHAPE_SNAPSHOT).toContain("schemaVersion");
    expect(EXPECTED_SHAPE_SNAPSHOT).toContain(`literal(${CARD_SCHEMA_VERSION})`);
    expect(CARD_SCHEMA_VERSION).toBe(1);
  });
});
