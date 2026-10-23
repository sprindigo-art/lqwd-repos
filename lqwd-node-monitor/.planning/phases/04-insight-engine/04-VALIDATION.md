---
phase: 4
slug: insight-engine
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-11
updated: 2026-06-11
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (existing — vitest.config.ts at repo root) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/lib/insight` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~20 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/insight`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-T1 | 04-01 | 1 | INSIGHT-01 | T-04-SC | Only the three audited packages installed; pinned majors | script assert | `node -e` package.json dep-range check + `npm ls zod ai @ai-sdk/anthropic` | created in task | ⬜ pending |
| 04-01-T2 | 04-01 | 1 | INSIGHT-01 | T-04-01, T-04-02 | D-12 superRefine + `.strict()` everywhere; pure modules (no server-only/db) | static/type | `npx tsc --noEmit` + server-only absence grep | created in task | ⬜ pending |
| 04-01-T3 | 04-01 | 1 | INSIGHT-01 | T-04-01 | Forged/mutated cards fail parse; shape snapshot freezes contract | unit (contract) | `npx vitest run src/lib/insight/schema.contract.test.ts` | created in task | ⬜ pending |
| 04-02-T1 | 04-02 | 2 | INSIGHT-03 | T-04-05 | No threshold fork — AP-11/PPM-LOW read from SCORECARD_CONFIG | unit | `npx vitest run src/lib/insight/config.test.ts` | created in task | ⬜ pending |
| 04-02-T2 | 04-02 | 2 | INSIGHT-03 | — | Deterministic non-mutating D-06 rank | unit | `npx vitest run src/lib/insight/rank.test.ts` | created in task | ⬜ pending |
| 04-02-T3 | 04-02 | 2 | INSIGHT-03 | T-04-04 | href injection rejected (whitelists + regex, relative-only); labels uppercase/emoji-free | unit | `npx vitest run src/lib/insight/deeplink.test.ts src/lib/insight/labels.test.ts` | created in task | ⬜ pending |
| 04-03-T1 | 04-03 | 3 | INSIGHT-02 | T-04-07 | Threshold is a SCORECARD_CONFIG read; typed tier1Breach flag access | unit (TDD) | `npx vitest run src/lib/insight/detectors/close-storm.test.ts` | created in task | ⬜ pending |
| 04-03-T2 | 04-03 | 3 | INSIGHT-05 | T-04-06 | Bound SQL params; fixed enum literals | unit (TDD) | `npx vitest run src/lib/insight/detectors/close-cluster.test.ts` | created in task | ⬜ pending |
| 04-04-T1 | 04-04 | 3 | INSIGHT-02 | T-04-08, T-04-09 | Bound window param; lazy DB import only | shape unit | `npx vitest run src/lib/insight/detectors/htlc-timeout.test.ts -t shape` | created in task | ⬜ pending |
| 04-04-T2 | 04-04 | 3 | INSIGHT-02 | — | Config-driven thresholds; investigate-only action | unit (TDD) | `npx vitest run src/lib/insight/detectors/htlc-timeout.test.ts` | created in task | ⬜ pending |
| 04-05-T1 | 04-05 | 3 | INSIGHT-02 | T-04-10, T-04-12 | Complete typed update_fee/close_channel params; bound SQL | unit (TDD) | `npx vitest run src/lib/insight/detectors/fee-signals.test.ts` | created in task | ⬜ pending |
| 04-05-T2 | 04-05 | 3 | INSIGHT-04 | T-04-11 | Step-down emits investigate, never update_fee; null-PPM discipline | golden unit (TDD) | `npx vitest run src/lib/insight/detectors/fee-stepdown.test.ts` | created in task | ⬜ pending |
| 04-06-T1 | 04-06 | 3 | INSIGHT-02 | T-04-13, T-04-15 | amountSat capped at 5M; bound SQL params | unit (TDD) | `npx vitest run src/lib/insight/detectors/rebalance.test.ts` | created in task | ⬜ pending |
| 04-06-T2 | 04-06 | 3 | PENDING-02 | T-04-14 | Zero new SQL; remediate_pending params match frozen variants | unit (TDD) | `npx vitest run src/lib/insight/detectors/stuck-pending.test.ts` | created in task | ⬜ pending |
| 04-07-T1 | 04-07 | 3 | INSIGHT-06 | T-04-18 | History-not-latest read; bound window param | unit (TDD) | `npx vitest run src/lib/insight/fee-history.test.ts` | created in task | ⬜ pending |
| 04-07-T2 | 04-07 | 3 | INSIGHT-06 | T-04-16, T-04-17 | Suppression structurally nulls params; typed flag set only | unit (TDD) | `npx vitest run src/lib/insight/guardrails.test.ts` | created in task | ⬜ pending |
| 04-08-T1 | 04-08 | 3 | INSIGHT-07 | T-04-19, T-04-20, T-04-22 | Off-by-default; lazy AI import; injection-delimited prompts; prose-only output | unit | `npx vitest run src/lib/ai/provider.test.ts src/lib/insight/narrative.test.ts` | created in task | ⬜ pending |
| 04-08-T2 | 04-08 | 3 | INSIGHT-07 | T-04-20 | info/null-action/llm-provenance locked by schema; gated on flag | unit (TDD) | `npx vitest run src/lib/insight/detectors/ap12-advisory.test.ts` | created in task | ⬜ pending |
| 04-08-T3 | 04-08 | 3 | INSIGHT-07 | T-04-21, T-04-23 | No client-supplied cards; pubkey regex; plain-text render only | static + grep | `npx tsc --noEmit` + use-client/use-server/dangerouslySetInnerHTML greps | created in task | ⬜ pending |
| 04-09-T1 | 04-09 | 4 | INSIGHT-02, INSIGHT-03 | T-04-24, T-04-25, T-04-26 | Final schema parse gate; per-read degrade; rebalance-action reachability (liquidityImbalanceByPubkey supplied) | unit | `npx vitest run src/lib/insight/engine.test.ts` | created in task | ⬜ pending |
| 04-09-T2 | 04-09 | 4 | INSIGHT-02, INSIGHT-03 | T-04-24 | Live cross-consistency (flags, pending, deep-link shape) | golden (live, skipIf) | `npx vitest run src/lib/insight && npx tsc --noEmit` | created in task | ⬜ pending |
| 04-10-T1 | 04-10 | 5 | INSIGHT-03 | T-04-27, T-04-28, T-04-29 | JSX-escaped rendering; deepLink rendered unmodified; shared labels imported | unit + static | `npx vitest run src/components/insight/insight-cards.test.ts && npx tsc --noEmit` | created in task | ⬜ pending |
| 04-10-T2 | 04-10 | 5 | INSIGHT-03, INSIGHT-07 | T-04-27 | Error-degrade branch; NarrateButton gated on llmEnabled | static + grep | `npx tsc --noEmit && grep force-dynamic/loadInsightView "src/app/(overview)/inbox/page.tsx"` | created in task | ⬜ pending |
| 04-11-T1 | 04-11 | 5 | INSIGHT-03 | — | No health/ranking logic in component; existing branches unchanged | static + suite | `npx tsc --noEmit && npx vitest run` | modified in task | ⬜ pending |
| 04-11-T2 | 04-11 | 5 | INSIGHT-03, INSIGHT-07 | T-04-30, T-04-31 | Insight read post-gauntlet inside catch-degrade Promise.all | build + static | `npx tsc --noEmit && npx next build` | modified in task | ⬜ pending |
| 04-12-T1 | 04-12 | 6 | all phase reqs | T-04-32 | AFM-001/002 grep-guards clean; live golden green; schema freeze intact | full sweep | `npm test && npx tsc --noEmit` (+ next build, AFM greps, live golden) | n/a (verification) | ⬜ pending |
| 04-12-T2 | 04-12 | 6 | all phase reqs | T-04-32 | Operator visual/functional sign-off on live data | manual checkpoint | — (blocking `checkpoint:human-verify`; see Manual-Only Verifications) | n/a (checkpoint) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Frozen card schema module + zod validator + contract test (schema freeze MUST precede all detector and UI work — RESEARCH.md Wave 0) → **04-01 (Wave 1, no dependents start before it)**
- [x] Golden fixtures: France routing-pnl weekly series (D-09 step-down) → **04-05 Task 2**; 2024-09-09 cascade close cluster (D-10) → **04-03 Task 2**
- [x] No new framework install — vitest infrastructure already covers phase requirements

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Inbox page visual conformance (NOC Light, severity chips, no emoji/icons) | INSIGHT-03 | Binding design-skill judgment | Load `/inbox` against live warehouses; compare against sketch-findings-nodemonitor SKILL.md — executed as 04-12 Task 2 (blocking checkpoint) |
| LLM narrative output quality + labeling | INSIGHT-07 | Nondeterministic LLM output | Toggle LLM on, trigger inbox-level and per-node narration, confirm "LLM OUTPUT" labeling and no params present — executed as 04-12 Task 2 (blocking checkpoint) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (04-12-T2 is the sanctioned blocking human checkpoint, captured under Manual-Only Verifications)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none remain — schema freeze and golden fixtures are planned in 04-01/04-03/04-05)
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner revision pass — 2026-06-11 (map filled from plans 04-01..04-12; plan-level Nyquist checks 8a–8d previously passed)
