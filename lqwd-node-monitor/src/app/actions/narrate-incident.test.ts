import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// =====================================================
// narrate-incident.test.ts — locks the AIX-01 per-incident advisory read action
// =====================================================
// The AI SDK, the provider registry, and the server-only incident loader are all
// hoisted-mocked so the action runs under plain node with zero live connections and
// zero real model calls. `buildIncidentPrompt` / `INCIDENT_READ_SYSTEM_PROMPT` and
// `assertAdvisoryOnly` stay REAL — the test exercises the genuine prompt-build and
// guardrail post-check, not a re-mock of the pure core. The behaviors pinned here
// ARE the AIX-01 contract:
//   • flag-off returns { ok:false } BEFORE any SDK/provider/loader code executes
//     (defense in depth — button visibility is not the gate, T-17-14 degrade);
//   • an invalid incident key is rejected before the server-recompute (T-17-13);
//   • an unknown key returns { ok:false, "incident not found" } (never a client card);
//   • a command-shaped generation is WITHHELD by assertAdvisoryOnly (T-17-02);
//   • a provider throw is caught → { ok:false } (deterministic UI intact, FM-5).

const { loadIncidents, getModel, generateText } = vi.hoisted(() => ({
  loadIncidents: vi.fn(),
  getModel: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock("@/lib/overview/load-incidents", () => ({ loadIncidents }));
vi.mock("@/lib/ai/provider", () => ({ getModel }));
vi.mock("ai", () => ({ generateText }));

import { narrateIncident } from "@/app/actions/narrate-incident";
import { INCIDENT_READ_SYSTEM_PROMPT } from "@/lib/overview/incident-prompt";
import type { GroupedIncident } from "@/lib/overview/incidents";

const ENV_KEY = "INSIGHT_LLM_ENABLED";

/** Minimal valid GroupedIncident — the loader mock returns these directly. */
function makeIncident(key = "h1"): GroupedIncident {
  return {
    key,
    layer: "hosts",
    severity: "critical",
    stale: false,
    why: "bitcoind down on h1",
    entityLabel: "h1",
    asOf: null,
    children: [],
  };
}

describe("narrateIncident (AIX-01 per-incident advisory read)", () => {
  let original: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    original = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("flag-off returns { ok:false } and never touches the AI SDK, provider, or loader", async () => {
    delete process.env[ENV_KEY];

    const res = await narrateIncident("h1");

    expect(res.ok).toBe(false);
    // Defense in depth: the env gate short-circuits BEFORE any lazy import runs, so
    // zero SDK / provider / loader code executes and the API key is never touched.
    expect(generateText).not.toHaveBeenCalled();
    expect(getModel).not.toHaveBeenCalled();
    expect(loadIncidents).not.toHaveBeenCalled();
  });

  it("rejects an invalid incident id before the server-recompute (T-17-13)", async () => {
    process.env[ENV_KEY] = "true";

    const res = await narrateIncident("BAD KEY!!");

    expect(res).toEqual({ ok: false, error: "invalid incident id" });
    // Key validation gates the recompute — a malformed id never reaches the loader.
    expect(loadIncidents).not.toHaveBeenCalled();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns { ok:false, 'incident not found' } for a key the server does not recompute", async () => {
    process.env[ENV_KEY] = "true";
    loadIncidents.mockResolvedValue([makeIncident("other-host")]);

    const res = await narrateIncident("h1");

    expect(res).toEqual({ ok: false, error: "incident not found" });
    // Never calls the model for an incident that does not exist server-side.
    expect(generateText).not.toHaveBeenCalled();
  });

  it("withholds a command-shaped generation via the assertAdvisoryOnly guardrail (T-17-02)", async () => {
    process.env[ENV_KEY] = "true";
    loadIncidents.mockResolvedValue([makeIncident("h1")]);
    getModel.mockReturnValue({});
    // A generation that smuggles a runnable lncli command must be blocked.
    generateText.mockResolvedValue({ text: "Act now\nRun lncli closechannel to fix it." });

    const res = await narrateIncident("h1");

    expect(res.ok).toBe(false);
    expect(res).toEqual({ ok: false, error: "read withheld: failed advisory-only guardrail" });
  });

  it("catches a provider throw and returns { ok:false } — deterministic UI intact (FM-5)", async () => {
    process.env[ENV_KEY] = "true";
    loadIncidents.mockResolvedValue([makeIncident("h1")]);
    getModel.mockReturnValue({});
    generateText.mockRejectedValue(new Error("provider 500"));

    const res = await narrateIncident("h1");

    expect(res.ok).toBe(false);
  });

  it("returns { ok:true, text } for advisory prose, calling generateText with the bounded incident-read config", async () => {
    process.env[ENV_KEY] = "true";
    loadIncidents.mockResolvedValue([makeIncident("h1")]);
    getModel.mockReturnValue({ id: "test-model" });
    const prose =
      "Act now. The Bitcoin backend on host h1 is down, which stalls channel updates; worth checking the node's connectivity.";
    generateText.mockResolvedValue({ text: prose });

    const res = await narrateIncident("h1");

    expect(res).toEqual({ ok: true, text: prose });
    // Bounded, deterministic-leaning generation: system prompt is the fixed advisory
    // contract, and the output-token bound is present (unbounded generation is a DoS,
    // T-17-14). The prompt is the server-recomputed incident payload.
    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { id: "test-model" },
        system: INCIDENT_READ_SYSTEM_PROMPT,
        maxOutputTokens: 400,
        temperature: 0.3,
        prompt: expect.stringContaining("h1"),
      }),
    );
  });
});
