---
phase: 04-insight-engine
plan: 08
subsystem: llm-narrative
tags: [llm, ai-sdk, anthropic, server-action, prompt-injection, ap12]
requires:
  - phase: 04-insight-engine
    plan: 01
    provides: "InsightCardSchema + superRefine (D-12 llm-inference invariants), types.ts"
  - phase: 04-insight-engine
    plan: 02
    provides: "buildDeepLink validated deep-link builder, INSIGHT_CONFIG"
provides:
  - "getModel() — anthropic-only LanguageModel factory with AI_MODEL override (src/lib/ai/provider.ts)"
  - "narrateCards + buildNarrationPrompt + isLlmEnabled — off-by-default narration core (src/lib/insight/narrative.ts)"
  - "ap12AdvisoryCards + AP12_NO_DATA_PLACEHOLDER — D-11/D-12 LLM fallback (src/lib/insight/detectors/ap12-advisory.ts)"
  - "narrate server action (both D-17 trigger levels) + NarrateButton client leaf"
affects:
  - "04-09 engine: wires loadInsightView into narrate.ts's loadCardsForNarration indirection"
  - "Wave-5 UI plans: mount NarrateButton (fleet + per-node) and render AP12_NO_DATA_PLACEHOLDER when LLM is off"
tech-stack:
  added: []
  patterns:
    - "Lazy AI SDK imports behind env gate — flag off ⇒ zero AI SDK code executes, key never touched"
    - "Untrusted-data delimiters around all attacker-controllable strings in LLM prompts"
    - "Server action recomputes prompt inputs server-side; client supplies only validated scope"
key-files:
  created:
    - src/lib/ai/provider.ts
    - src/lib/ai/provider.test.ts
    - src/lib/insight/narrative.ts
    - src/lib/insight/narrative.test.ts
    - src/lib/insight/detectors/ap12-advisory.ts
    - src/lib/insight/detectors/ap12-advisory.test.ts
    - src/app/actions/narrate.ts
    - src/components/insight/NarrateButton.tsx
  modified: []
decisions:
  - "AP-12 advisory emits TWO cards per flagged node (ap12a + ap12b) sharing one batch narrative — each DetectorId gets its own advisory row; one generateText call per batch"
  - "narrate.ts uses a variable-specifier dynamic import for the not-yet-merged 04-09 engine — descriptive error until wired, tsc stays clean"
  - "Node-scope scorecardSummary is a deterministic card-count placeholder until 04-09 supplies the engine's scorecard summary"
metrics:
  duration: "~10 min"
  completed: "2026-06-12"
  tasks: 3
  tests: "64 passing under src/lib/insight + src/lib/ai (22 new in this plan)"
---

# Phase 4 Plan 08: LLM Surface (Provider, Narrative, AP-12 Advisory, Narrate UI) Summary

Off-by-default Claude narration via getModel()+generateText with injection-delimited prompts, a D-12-locked AP-12a/b advisory fallback, and a cards-recomputed-server-side narrate action — the LLM structurally cannot produce or alter params.

## What Was Built

- **`src/lib/ai/provider.ts`** — `getModel(): LanguageModel` (ai v6 type), default `claude-sonnet-4-5`, `AI_MODEL` env override through `parseModelOverride` (exported for tests). Anthropic-only: gemini/gpt/unknown prefixes throw a descriptive error naming the unconfigured provider (backends.ts fail-loud ethos). `server-only`.
- **`src/lib/insight/narrative.ts`** — `isLlmEnabled()` (exact-string `INSIGHT_LLM_ENABLED === "true"`; absent = off), pure `buildNarrationPrompt` (filters to `provenance === "deterministic"`, wraps every card's JSON — including aliases — inside `<<<BEGIN/END_UNTRUSTED_CARD_DATA>>>` delimiters with an explicit data-not-instructions rule), and `narrateCards` (throws before any dynamic import when off; lazy-imports provider + `generateText`; returns `result.text` verbatim — no parsing path back to structured data).
- **`src/lib/insight/detectors/ap12-advisory.ts`** — `AP12_NO_DATA_PLACEHOLDER` ("AP-12a/b — no data, needs log ingestion …") for the honest LLM-off UI section, and `ap12AdvisoryCards(contexts)`: gated on `isLlmEnabled()`, one batch prompt over deterministic circumstantial context (channel count, REMOTE-FC share, fee-update churn — framed as circumstantial, never the signature), emitting per node an ap12a + ap12b card with the D-12 locked fields (severity `info`, provenance `llm-inference`, `suggestedAction: null`, label "LLM inference — no warehouse data", deepLink → scorecard tab, suppression inactive).
- **`src/app/actions/narrate.ts`** — `"use server"` action for both D-17 trigger levels. Re-checks `isLlmEnabled()` server-side; validates node pubkeys against `/^[0-9a-f]{66}$/`; **no cards parameter** — the card set is recomputed server-side via the `loadCardsForNarration` indirection (dynamic import of 04-09's engine behind try/catch with a descriptive error until merged). Returns `{ ok, text | error }`.
- **`src/components/insight/NarrateButton.tsx`** — first interactive client leaf. Mono uppercase "NARRATE — LLM" trigger (no icons per sketch findings), "GENERATING…" pending state, result under a header containing the literal "LLM OUTPUT — narrative only, not a recommendation source", rendered as plain text in `whitespace-pre-wrap` (no raw-HTML injection, no markdown). Navy brand tokens for the interactive accent.

## Task Commits

| Task | Name | Commit(s) |
| ---- | ---- | --------- |
| 1 | provider.ts + narrative.ts — getModel and the narration core | `dde99ec` |
| 2 | ap12-advisory.ts — D-11/D-12 fallback + placeholder (TDD) | RED `1640d75`, GREEN `e301ef1` |
| 3 | narrate server action + NarrateButton client leaf | `0afefcc` |

## Verification

- `npx vitest run src/lib/insight src/lib/ai` — 8 files, 64 tests passing (22 added by this plan)
- `npx tsc --noEmit` — clean
- `npx eslint` on all five new source files — clean
- Acceptance greps: `server-only` present in provider + narrative; no `LanguageModelV1` anywhere in src; `dangerouslySetInnerHTML` count 0 in NarrateButton; `isLlmEnabled` re-checked in narrate.ts; "LLM OUTPUT" literal present
- Threat register: T-04-19 (alias delimiting + plain-text render), T-04-20 (prose-only path + superRefine negative test), T-04-21 (no client card input + pubkey regex), T-04-22 (server-only + lazy import), T-04-23 (plain-text render, grep-asserted) — all mitigated as planned

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Acceptance-grep self-trips from comments**
- **Found during:** Task 1 and Task 3 verification
- **Issue:** Banner comments contained the literal strings `LanguageModelV1` and `dangerouslySetInnerHTML` (describing the prohibitions), tripping the plan's zero-hit grep guards
- **Fix:** Reworded comments ("the renamed v5 type", "no raw-HTML injection") so the guards measure code, not prose
- **Files modified:** src/lib/ai/provider.ts, src/components/insight/NarrateButton.tsx
- **Commit:** included in `dde99ec` / `0afefcc`

No other deviations — plan executed as written.

## TDD Gate Compliance

Task 2 (`tdd="true"`): RED commit `1640d75` (tests failed — module absent), GREEN commit `e301ef1` (7/7 passing). No refactor needed.

## Known Stubs

| Stub | File | Reason / Resolution |
|------|------|---------------------|
| `loadCardsForNarration` engine import | src/app/actions/narrate.ts | 04-09's `engine.ts` is not merged in this parallel wave; the variable-specifier dynamic import returns a descriptive error ("insight engine not wired yet (04-09)") at runtime. **Intentional per plan text** — 04-09 wires `loadInsightView` and replaces the indirection with a static lazy import. |
| `scorecardSummary` placeholder | src/app/actions/narrate.ts | Node-scope summary is a deterministic card-count string until 04-09 supplies the engine's scorecard summary. Honest, non-empty, documented inline. |

## Requirements

- **INSIGHT-07** — marked complete (fully delivered by this plan: off-by-default, narrate-only, both trigger levels).
- **INSIGHT-02** — NOT marked: this plan delivers only the AP-12a/b portion; AP-11, HTLC-timeout, fee, and rebalance detectors land in sibling wave-3 plans. Orchestrator should mark it when the detector set completes.

## Threat Flags

None — no security surface introduced beyond the plan's threat model (the narrate server action is T-04-21's planned surface).

## Self-Check: PASSED

- FOUND: src/lib/ai/provider.ts, src/lib/ai/provider.test.ts, src/lib/insight/narrative.ts, src/lib/insight/narrative.test.ts, src/lib/insight/detectors/ap12-advisory.ts, src/lib/insight/detectors/ap12-advisory.test.ts, src/app/actions/narrate.ts, src/components/insight/NarrateButton.tsx
- FOUND commits: dde99ec, 1640d75, e301ef1, 0afefcc
