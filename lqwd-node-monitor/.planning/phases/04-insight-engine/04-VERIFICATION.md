---
phase: 04-insight-engine
verified: 2026-06-12T16:55:00Z
status: passed
score: 5/5 must-haves verified
verdict: PASS
overrides_applied: 0
---

# Phase 4: Insight Engine Verification Report

**Phase Goal:** Turn warehouse rows into deterministic, severity-ranked recommendation cards whose schema is a frozen hard contract — and which never recommend an action that reproduces a pattern it detects.
**Verified:** 2026-06-12T16:55:00Z
**Status:** passed (PASS)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Engine emits structured `{severity, node, target, signal, evidence, suggested_action, params}` cards, schema frozen as hard contract before Phase 5/6 | ✓ VERIFIED | `src/lib/insight/schema.ts` — `InsightCardSchema` zod validator with `.strict()` at every level, `CARD_SCHEMA_VERSION = 1`, discriminated `SuggestedActionSchema` (params nested per action type), structured `CardEvidenceSchema`. Contract test `schema.contract.test.ts` 13/13 passed (freeze + snapshot). Committed `schema-fixture.json` has all 14 detector types. Engine final gate `InsightCardArraySchema.parse` (engine.ts:313). |
| 2 | Deterministic detectors fire with correct severity+evidence for AP-11 close-storm (≥50/hr), AP-12a/b, HTLC-timeout, fee signals, rebalance | ✓ VERIFIED | All detector files present + unit-tested. `close-storm.ts` reads `SCORECARD_CONFIG[backend].forceClose.tier1.value` (D-13, no 50 literal). `htlc-timeout.ts` signature `LOCAL_FORCE_CLOSE AND time_locked_balance>0 AND settled_balance/capacity<0.8`. `fee-signals.ts` raise/lower/close-candidate. `rebalance.ts` `paid_status` COUNT FILTER on `requesting_node_pubkey`. AP-12a/b advisory cards LLM-gated with honest no-data placeholder when off. 219 insight tests pass + **live golden 4/4 against real `routing_vm` warehouse (~15s)**. |
| 3 | Fee-crash/earnings-step-down detector + fleet-wide same-hour close-cluster detector | ✓ VERIFIED | `fee-stepdown.ts` — PPM-LOW (reads `SCORECARD_CONFIG.revenue.tier1`), PPM-DRIFT (7d<0.5×baseline), EARNINGS-DROP (7d<0.3× weekly), null-PPM discipline, suggests `investigate` not `update_fee`. `close-cluster.ts` — `date_trunc('hour')` + `INITIATOR_LOCAL`, warn ≥2 nodes / critical ≥3, `target.kind:"fleet"`, investigate-only. Both unit-tested on golden-shaped fixtures. |
| 4 | Stuck-pending detector flags 3 cases with evidence+severity; cards in one fleet-wide severity-ranked triage inbox ranked by limbo at risk | ✓ VERIFIED | `stuck-pending.ts` emits `stuck_fc_past_maturity`, `stuck_sweep`, `stuck_open` (lines 163/251/304), each carries `evidence.detail.limboSat` D-06 rank key, consumes `buildPendingView()` (zero new SQL). `/inbox` page (`src/app/(overview)/inbox/page.tsx`) renders `loadInsightView()` cards via `InsightCardList` severity-sectioned, no JSX logic. `rank.ts` sorts severity → limboSat for stuck. Golden test asserts every stuck card carries a node. Build: `/inbox` present as dynamic route. |
| 5 | Engine suppresses writes on AP-11/AP-12-flagged nodes + fee hysteresis + write rate-limit guidance; LLM off by default, narrates only, never produces/alters params | ✓ VERIFIED | `guardrails.ts` — `applySuppression` nulls `suggestedAction` + sets exact reason "node flagged AP-11 — write recommendations withheld" (D-14); `applyHysteresis` holds on `|delta|<feeMinDeltaPpm`(10) OR last change <`feeMinIntervalHours`(24), stamps state on every fee card; `applyRateLimitGuidance` text-only vs `maxWritesPerDay`(4). Engine applies in order hysteresis→suppression→rate-limit (engine.ts:307-309). `narrative.ts` — `isLlmEnabled()` gates on `INSIGHT_LLM_ENABLED==="true"`, lazy AI import (zero SDK when off), returns model text verbatim, NO params parse-back (D-17). `narrate.ts` server action re-gates server-side. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/insight/types.ts` | ✓ VERIFIED | CARD_SCHEMA_VERSION, DetectorId, InsightCard via z.infer |
| `src/lib/insight/schema.ts` | ✓ VERIFIED | InsightCardSchema with superRefine (D-12), .strict() all levels — THE contract |
| `src/lib/insight/schema-fixture.json` | ✓ VERIFIED | 14 cards, one per detector type |
| `src/lib/insight/schema.contract.test.ts` | ✓ VERIFIED | 13/13 passed, freeze snapshot |
| `src/lib/insight/config.ts` | ✓ VERIFIED | INSIGHT_CONFIG reads SCORECARD_CONFIG, never restates 50/10 (D-13) |
| `src/lib/insight/rank.ts` | ✓ VERIFIED | D-06 deterministic sort, no knob |
| `src/lib/insight/deeplink.ts` | ✓ VERIFIED | validated pubkey + whitelisted tab/window |
| `src/lib/insight/labels.ts` | ✓ VERIFIED | SIGNAL_LABELS covers all 14 DetectorIds |
| 8 detector modules (`detectors/*.ts`) | ✓ VERIFIED | close-storm, close-cluster, htlc-timeout, fee-signals, fee-stepdown, rebalance, stuck-pending, ap12-advisory |
| `src/lib/insight/guardrails.ts` | ✓ VERIFIED | suppression + hysteresis + rate-limit post-passes |
| `src/lib/insight/fee-history.ts` | ✓ VERIFIED | windowed lnd_node_channel_info scan (Pitfall 1) |
| `src/lib/insight/engine.ts` | ✓ VERIFIED | loadInsightView orchestrator, reuses loadFleetView + buildPendingView, parse gate |
| `src/lib/ai/provider.ts` | ✓ VERIFIED | getModel() anthropic-only, AI_MODEL override |
| `src/lib/insight/narrative.ts` | ✓ VERIFIED | narrateCards server-only, lazy AI import |
| `src/app/actions/narrate.ts` | ✓ VERIFIED | "use server", server-side re-gate |
| `src/components/insight/*` | ✓ VERIFIED | InsightCardRow/List, NarrateButton |
| `src/app/(overview)/inbox/page.tsx` | ✓ VERIFIED | force-dynamic, loadInsightView, honest empty state |
| `src/app/(overview)/[pubkey]/[tab]/page.tsx` | ✓ VERIFIED | per-node filter `card.node?.pubkey === pubkey` (D-08) |
| `src/components/console/ActiveSignalsPanel.tsx` | ✓ VERIFIED | "insight" SignalRow kind branch, composes with Phase-3 rows |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| types.ts | schema.ts | z.infer | ✓ WIRED |
| contract test | schema-fixture.json | committed-fixture parse | ✓ WIRED |
| config.ts | scorecard/config.ts | SCORECARD_CONFIG read (no 50/10 dup) | ✓ WIRED |
| close-storm.ts | scorecard/config.ts | forceClose.tier1.value | ✓ WIRED |
| close-cluster.ts | lnd_node_closed_channels | INITIATOR_LOCAL hour-bucket | ✓ WIRED |
| stuck-pending.ts | read/pending.ts | buildPendingView consumption | ✓ WIRED |
| guardrails.ts | types.ts | suppressed/rateLimitGuidance fields | ✓ WIRED |
| engine.ts | scorecard/fleet.ts | loadFleetView | ✓ WIRED |
| engine.ts | schema.ts | final parse gate | ✓ WIRED |
| inbox/page.tsx | engine.ts | loadInsightView server fetch | ✓ WIRED |
| InsightCardRow.tsx | format/units.ts | AFM-002 formatSats | ✓ WIRED |
| [tab]/page.tsx | engine.ts | loadInsightView + filter | ✓ WIRED |
| narrate.ts | narrative.ts | server action, no API route | ✓ WIRED |
| narrative.ts | ai/provider.ts | getModel() + generateText | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green | `vitest run` | 494 passed, 20 skipped | ✓ PASS |
| Insight suite | `vitest run src/lib/insight ...` | 219 passed, 4 skipped | ✓ PASS |
| Typecheck clean | `tsc --noEmit` | 0 errors | ✓ PASS |
| Production build | `next build` | Compiled; `/inbox` + `/pending` dynamic routes | ✓ PASS |
| Contract freeze | `vitest run schema.contract.test.ts` | 13/13 passed | ✓ PASS |
| **Live golden vs real warehouse** | `vitest run golden-insight.test.ts` (env loaded) | **4/4 passed, ~15s against routing_vm** | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| INSIGHT-01 | 04-01 | ✓ SATISFIED | Frozen schema + fixture + contract test (SC1) |
| INSIGHT-02 | 04-03/04/05/06/08/09 | ✓ SATISFIED | All deterministic detectors fire correctly (SC2) |
| INSIGHT-03 | 04-02/09/10/11 | ✓ SATISFIED | Fleet-wide /inbox + per-node console (SC4) |
| INSIGHT-04 | 04-05 | ✓ SATISFIED | fee-stepdown detector (SC3) |
| INSIGHT-05 | 04-03 | ✓ SATISFIED | fleet close-cluster detector (SC3) |
| INSIGHT-06 | 04-07 | ✓ SATISFIED | suppression + hysteresis + rate-limit guidance (SC5) |
| INSIGHT-07 | 04-08/10/11 | ✓ SATISFIED | LLM off-by-default, narrate-only, no param parse (SC5) |
| PENDING-02 | 04-06 | ✓ SATISFIED | stuck-pending 3 cases ranked by limbo (SC4) |

All 8 declared requirement IDs cross-referenced against REQUIREMENTS.md — all accounted for, none orphaned.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none) | TBD/FIXME/XXX | — | Zero debt markers in any phase-modified file |
| (none) | TODO/HACK/PLACEHOLDER | — | Only `AP12_NO_DATA_PLACEHOLDER` (legitimate honest-copy constant) |
| ap12-advisory.ts | `return []` | ℹ️ INFO | Expected — LLM-gated path off by default; not a stub |

**AFM-001 / AFM-002 grep guards:** The actual documented failure pattern (`WHERE timestamp = MAX(...)` latest-state collapse) returns ZERO matches in real SQL — every match is in code comments documenting/warning against the anti-pattern. The literal grep is over-broad (matches `MAX(timestamp) AS as_of` sanctioned aggregates); intent satisfied. AFM-002 `fee_msat/1000` outside formatters: only a comment match. Confirmed independently.

### Human Verification Required

None outstanding. The 04-12 phase-gate plan (`autonomous: false`) already executed the operator visual/functional checkpoint: operator verified `/inbox`, console Active Signals integration, and LLM toggle behavior against live data, then approved. Three issues raised during that checkpoint were fixed before sign-off (global MastheadNav, @modal-slot 404 fix, redesigned FleetPendingBoard — all additive, present in tree). Live golden was re-run independently during this verification and passed 4/4.

### Gaps Summary

No gaps. All 5 ROADMAP success criteria are observably true in the codebase, backed by: the frozen contract schema with runtime parse gate, 8 substantive detectors reading shared thresholds (no duplication), guardrails that null write params on flagged nodes, an off-by-default narrate-only LLM path with no param parse-back, and a fleet-wide /inbox + per-node console rendering the SAME single computation. Independently confirmed via 494-test suite green, clean typecheck, successful production build, 13/13 contract-freeze test, and a 4/4 LIVE golden run against the real `routing_vm` warehouse.

The additive operator-requested UI follow-ups (MastheadNav, @modal 404 fix, FleetPendingBoard + pending-summary.ts) are present and compile; they are outside the phase success criteria and do not affect goal achievement.

---

_Verified: 2026-06-12T16:55:00Z_
_Verifier: Claude (gsd-verifier)_
