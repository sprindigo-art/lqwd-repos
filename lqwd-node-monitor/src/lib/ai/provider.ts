import "server-only";

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";

// =====================================================
// getModel() — provider-agnostic model registry (D17)
// =====================================================
// The AI stage is PROVIDER-SWAPPABLE: any model/provider can be dropped into the
// ingest→output pipeline. A model-id string routes through the registry below to
// its `@ai-sdk/*` factory; adding a provider is ONE registry entry, and no
// downstream code changes (the Vercel AI SDK's `LanguageModel` is the neutral
// interface every consumer — narrative.ts, ap12-advisory.ts — already speaks).
//
// This supersedes the Phase-4 INSIGHT-07 "Anthropic-only, fail-loud on every
// other provider" stance: openai/google are now first-class, and a truly
// unrecognized id (matching no registered provider) still fails loud rather than
// silently falling back.
//
// ai v6 shapes only: the type is `LanguageModel`; providers are factory calls
// (`anthropic(id)` / `openai(id)` / `google(id)`).
//
// Deterministic-first still holds (D4): the AI only narrates/explains — swapping
// the provider changes NOTHING about what the AI is permitted to do. Never let a
// model emit a runnable command.
//
// server-only (T-04-22): consumers lazy-import this behind their enable flags;
// each provider resolves its API key at generation time, never in a client bundle.

/** Default model id — env-overridable via AI_MODEL (workspace convention). */
const DEFAULT_MODEL = "claude-sonnet-4-5";

/** One registered provider: a name, an id-matcher, and the AI-SDK factory. */
interface ProviderEntry {
  /** Human name — surfaced in the no-match error and logging. */
  name: string;
  /** True when this provider owns the given model id. */
  matches: (modelId: string) => boolean;
  /** Construct the LanguageModel (no API key needed until generation time). */
  create: (modelId: string) => LanguageModel;
}

/**
 * Registered providers, checked in order. To add a provider: `npm i @ai-sdk/<p>`,
 * import its factory, and append one entry here — nothing else changes.
 */
const PROVIDERS: ProviderEntry[] = [
  { name: "anthropic", matches: (id) => id.startsWith("claude"), create: (id) => anthropic(id) },
  { name: "openai", matches: (id) => /^(gpt-|o1|o3|o4)/.test(id), create: (id) => openai(id) },
  { name: "google", matches: (id) => id.startsWith("gemini"), create: (id) => google(id) },
];

/**
 * Route a model-id string to its provider factory via the registry. A truly
 * unrecognized id (no registered provider matches) throws a descriptive error —
 * never a silent fallback.
 *
 * Exported for testability (constructing a model needs no API key — each provider
 * resolves its key at generation time, not here).
 */
export function parseModelOverride(modelStr: string): LanguageModel {
  const entry = PROVIDERS.find((p) => p.matches(modelStr));
  if (entry) return entry.create(modelStr);
  throw new Error(
    `AI_MODEL ${JSON.stringify(modelStr)} matches no registered provider ` +
      `(${PROVIDERS.map((p) => p.name).join(", ")}). Register the provider in ` +
      "src/lib/ai/provider.ts, or use a supported model id.",
  );
}

/** Resolve the model: AI_MODEL env override → provider registry → default Claude. */
export function getModel(): LanguageModel {
  const override = process.env.AI_MODEL;
  if (override) return parseModelOverride(override);
  return anthropic(DEFAULT_MODEL);
}
