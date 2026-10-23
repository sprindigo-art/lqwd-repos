import { afterEach, describe, expect, it, vi } from "vitest";

import { getModel, parseModelOverride } from "@/lib/ai/provider";

// Constructing a model needs no API key — each @ai-sdk provider resolves its API
// key at generation time, so these tests touch no network/env.

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseModelOverride — provider-swappable registry (D17)", () => {
  it('routes "claude…" ids to the anthropic factory', () => {
    const model = parseModelOverride("claude-3-5-haiku-latest") as { modelId: string };
    expect(model.modelId).toBe("claude-3-5-haiku-latest");
  });

  it("routes gemini ids to the google factory (swappable, no longer throws)", () => {
    const model = parseModelOverride("gemini-2.0-flash") as { modelId: string };
    expect(model.modelId).toBe("gemini-2.0-flash");
  });

  it("routes gpt/o-series ids to the openai factory", () => {
    expect((parseModelOverride("gpt-4o") as { modelId: string }).modelId).toBe("gpt-4o");
    expect((parseModelOverride("o3-mini") as { modelId: string }).modelId).toBe("o3-mini");
  });

  it("fails loud on an id matching no registered provider (never silently falls back)", () => {
    expect(() => parseModelOverride("llama-3-70b")).toThrow(/matches no registered provider/);
    expect(() => parseModelOverride("mistral-large")).toThrow(/anthropic, openai, google/);
  });
});

describe("getModel", () => {
  it("defaults to the Claude default model when AI_MODEL is unset", () => {
    vi.stubEnv("AI_MODEL", "");
    const model = getModel() as { modelId: string };
    expect(model.modelId).toMatch(/^claude/);
  });

  it("honors the AI_MODEL env override (claude)", () => {
    vi.stubEnv("AI_MODEL", "claude-3-5-haiku-latest");
    const model = getModel() as { modelId: string };
    expect(model.modelId).toBe("claude-3-5-haiku-latest");
  });

  it("honors the AI_MODEL env override for a swapped provider (openai)", () => {
    vi.stubEnv("AI_MODEL", "gpt-4o-mini");
    const model = getModel() as { modelId: string };
    expect(model.modelId).toBe("gpt-4o-mini");
  });

  it("fails loud when AI_MODEL matches no registered provider", () => {
    vi.stubEnv("AI_MODEL", "llama-3-70b");
    expect(() => getModel()).toThrow(/matches no registered provider/);
  });
});
