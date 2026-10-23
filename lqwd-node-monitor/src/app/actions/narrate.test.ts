import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// =====================================================
// narrate.test.ts — locks the D-17 fleet/node advisory-narration action (AI3)
// =====================================================
// The AI SDK, the provider registry, and the two server-only computations
// (loadInsightView + loadFleetView) are hoisted-mocked so the action runs under
// plain node with zero live warehouse connections and zero real model calls.
// `assertAdvisoryOnly` (reached transitively through narrateCards) stays REAL —
// the test exercises the genuine advisory-only backstop, not a re-mock. The
// behaviors pinned here ARE the older narrate path's contract:
//   • flag-off returns { ok:false } BEFORE any SDK/provider/loader code runs
//     (defense in depth — button visibility is not the gate, T-04-21);
//   • a malformed pubkey is rejected before any recompute or generation (T-04-21);
//   • the action NEVER trusts client-supplied cards — it server-recomputes the
//     card set via loadInsightView() (D-08, the SAME computation the UI renders);
//   • a command-shaped generation is WITHHELD by the advisory-only gate (T-18-07);
//   • the returned read line carries NO `action`/`params` — narration is prose
//     only, never a structured surface that could reach a signed write (AI core).

const { loadInsightView, loadFleetView, getModel, generateText } = vi.hoisted(() => ({
  loadInsightView: vi.fn(),
  loadFleetView: vi.fn(),
  getModel: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@/lib/insight/engine", () => ({ loadInsightView }));
vi.mock("@/lib/scorecard/fleet", () => ({ loadFleetView }));
vi.mock("@/lib/ai/provider", () => ({ getModel }));
vi.mock("ai", () => ({ generateText }));

import { narrate } from "@/app/actions/narrate";
import type { InsightCard } from "@/lib/insight/types";

const ENV_KEY = "INSIGHT_LLM_ENABLED";
const PUBKEY = "02" + "ab".repeat(32); // 66 lowercase hex chars

/** Minimal valid deterministic-provenance card the engine mock returns. */
function makeCard(overrides: Partial<InsightCard> = {}): InsightCard {
  return {
    schemaVersion: 1,
    id: `fee_raise:${PUBKEY}:chan-1`,
    severity: "info",
    node: { pubkey: PUBKEY, alias: "node-alias", backend: "lnd" },
    target: { kind: "channel", chanId: "123456", channelPoint: "txid:0", remotePubkey: null },
    signal: "fee_raise",
    evidence: {
      metric: "policyPpm",
      observed: 5,
      threshold: 30,
      unit: "ppm",
      window: "90d",
      asOf: "2026-06-12T00:00:00.000Z",
      deepLink: `/${PUBKEY}/fees`,
    },
    suggestedAction: null,
    suppressed: { active: false, reason: null },
    provenance: "deterministic",
    rateLimitGuidance: null,
    ...overrides,
  } as InsightCard;
}

describe("narrate (D-17 fleet/node advisory narration)", () => {
  let original: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    original = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("flag-off returns { ok:false } and never touches the AI SDK, provider, or loaders", async () => {
    delete process.env[ENV_KEY];

    const res = await narrate({ level: "fleet" });

    expect(res.ok).toBe(false);
    // Defense in depth: the env gate short-circuits BEFORE any recompute or lazy
    // import, so zero SDK / provider / loader code executes.
    expect(generateText).not.toHaveBeenCalled();
    expect(getModel).not.toHaveBeenCalled();
    expect(loadInsightView).not.toHaveBeenCalled();
  });

  it("rejects a malformed pubkey before any recompute or generation", async () => {
    process.env[ENV_KEY] = "true";

    const res = await narrate({ level: "node", pubkey: "not-a-pubkey" });

    expect(res).toEqual({
      ok: false,
      error: "invalid pubkey (expected 66 lowercase hex characters)",
    });
    // Pubkey validation gates the recompute — a malformed id never reaches the loader.
    expect(loadInsightView).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("server-recomputes the card set (never trusts client-supplied cards, D-08)", async () => {
    process.env[ENV_KEY] = "true";
    loadInsightView.mockResolvedValue({ cards: [makeCard()] });
    getModel.mockReturnValue({ id: "test-model" });
    const prose = "Node node-alias shows a below-target fee on channel 123456; worth a review.";
    generateText.mockResolvedValue({ text: prose });

    const res = await narrate({ level: "fleet" });

    expect(res).toEqual({ ok: true, text: prose });
    // The action recomputes cards itself; the prompt is built from the server card set,
    // proven by the server-only signal marker reaching generateText.
    expect(loadInsightView).toHaveBeenCalledTimes(1);
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 400,
        temperature: 0.3,
        prompt: expect.stringContaining("fee_raise"),
      }),
    );
    // The read line is prose only — no `action`/`params` structured surface.
    expect("action" in res).toBe(false);
    expect("params" in res).toBe(false);
    expect(Object.keys(res).sort()).toEqual(["ok", "text"]);
  });

  it("withholds a command-shaped generation via the advisory-only guardrail (T-18-07)", async () => {
    process.env[ENV_KEY] = "true";
    loadInsightView.mockResolvedValue({ cards: [makeCard()] });
    getModel.mockReturnValue({});
    // A narration that smuggles a runnable lncli command must be blocked.
    generateText.mockResolvedValue({ text: "Investigate then run lncli closechannel to fix it." });

    const res = await narrate({ level: "fleet" });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/advisory-only/);
    }
    // A withheld read never carries a structured action/params surface.
    expect("params" in res).toBe(false);
  });
});
