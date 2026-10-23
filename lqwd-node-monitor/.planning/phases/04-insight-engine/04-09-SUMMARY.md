---
phase: 04-insight-engine
plan: 09
subsystem: insight
tags: [engine, orchestrator, zod, guardrails, rank, server-only, vitest, golden]

# Dependency graph
requires:
  - phase: 04-02
    provides: frozen InsightCard schema + InsightCardArraySchema (the contract gate)
  - phase: 04-03
    provides: close-storm detector + closeStormFlaggedPubkeys suppression flag source
  - phase: 04-04
    provides: htlc-timeout detector (fetchHtlcTimeoutRows + detectHtlcTimeout)
  - phase: 04-05
    provides: fee-signals + fee-stepdown detectors (per-node channel fan + fleet aggregates)
  - phase: 04-06
    provides: close-cluster + rebalance detectors (liquidityImbalanceByPubkey contract)
  - phase: 04-07
    provides: guardrail post-passes (applyHysteresis/applySuppression/applyRateLimitGuidance) + rank + fee-history
  - phase: 04-08
    provides: narrative gating (isLlmEnabled) + ap12AdvisoryCards + narrate action indirection
provides:
  - loadInsightView() — the single stateless server-side card computation both surfaces render (D-07/D-08)
  - assembleCards() pure dependency seam — detect* → ordered guardrails → rank → schema parse gate, testable without DB
  - liquidityImbalanceFromFleet() — signed localSat−remoteSat map making the rebalance action reachable
  - narrate.ts wired to the real engine (no engine-unavailable fallback remains)
  - golden-insight.test.ts — live warehouse cross-consistency suite (skipIf no env)
affects: [04-10, 04-11, 04-12, phase-05, phase-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Engine orchestrator mirrors fleet.ts: server-only banner + parallel read fan + pure assembly seam + post-pass + sort + return"
    - "degrade() wrapper: per-detector catch-to-empty with console.error — fail-loud in logs, fail-soft in render"
    - "InsightCardArraySchema.parse as the FINAL engine gate — contract violations throw, never render"

key-files:
  created:
    - src/lib/insight/engine.ts
    - src/lib/insight/engine.test.ts
    - src/lib/insight/golden-insight.test.ts
  modified:
    - src/app/actions/narrate.ts

key-decisions:
  - "Single-knob guardrail/detector call sites read INSIGHT_CONFIG.lnd (lnd/ldk knob sets ship identical); per-backend divergence stays inside detectors taking the full record"
  - "Cluster + rebalance row fetchers live in engine.ts with lazy dbRouting imports (those detector modules export only SQL builders + pure detect)"
  - "Ap12Context.remoteFcShare filled with the fleet view's coopRemoteShare as a documented proxy — true REMOTE_FORCE_CLOSE share needs its own aggregate; zero new queries per plan constraint, path retires with log ingestion"
  - "AP-12 feeUpdateChurn derived from fee-history snapshot diffs joined to nodes via the already-loaded per-node latest-channel rows — no new query"

patterns-established:
  - "AssembleInputs dependency seam: orchestration logic unit-tested via partial module mocks that keep pure detect* functions real"

requirements-completed: [INSIGHT-02, INSIGHT-03]

# Metrics
duration: 9min
completed: 2026-06-12
---

# Phase 4 Plan 09: Insight Engine Assembly Summary

**loadInsightView() now computes every card stateless-per-load from fleet/pending reuse plus 5 parallel fail-soft detector reads, post-processed hysteresis→suppression→rate-limit, D-06 ranked, and contract-gated by InsightCardArraySchema.parse — the one computation the inbox renders whole and the console filters by pubkey.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-12T14:08:09Z
- **Completed:** 2026-06-12T14:17:00Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

- `loadInsightView(): Promise<InsightView>` — server-only orchestrator returning `{ cards, fetchedAt, llmEnabled, ap12Placeholder }`. Reuses `loadFleetView()` (AP-11 metric, suppression flags, node metadata, liquidity imbalance — zero duplicate queries) and `buildPendingView` via the sanctioned pending readers; fans the ~5 new detector aggregates in one `Promise.all`, each `degrade()`-wrapped so one broken read logs loudly and degrades to `[]` without taking either surface down (T-04-26).
- `assembleCards()` pure seam proves the engine contract without DB: guardrail post-pass ORDER (a fee card on an AP-11-flagged node ends suppressed AND carries its hysteresis state stamped first), D-06 rank, parse-gate rejection of a hand-forged D-12-violating card, and rebalance-action reachability (fleet liquidity extras → signed imbalance → `suggestedAction.type === "rebalance"`).
- `narrate.ts` rewired: static lazy import of `loadInsightView`; node scope filters the SAME computation and builds the scorecard summary string from `loadFleetView`; the 04-08 "engine unavailable" fallback branch is gone. `isLlmEnabled` re-check and 66-hex pubkey gate retained.
- `golden-insight.test.ts`: `describe.skipIf(!ROUTING_VM_DATABASE_URL)` live invariants — explicit re-parse, ap11-card ⇔ `forceClose.tier1Breach` flag-source consistency, stuck-pending cards ⊆ `buildPendingView` nodes, all deep links match `/^\/([0-9a-f]{66}\/[a-z-]+|pending)/`. No card-count assertions (live data varies).

## Task Commits

Each task was committed atomically:

1. **Task 1: engine.ts — loadInsightView orchestrator** - `c5c0dfb` (feat)
2. **Task 2: live golden test + narrate action wiring** - `7d2b9ea` (feat)

## Files Created/Modified

- `src/lib/insight/engine.ts` - loadInsightView orchestrator + assembleCards pure seam + liquidityImbalanceFromFleet + AP-12 context build; banner states D-07/D-08 and the query budget
- `src/lib/insight/engine.test.ts` - 7 no-DB tests: post-pass order, rank, parse gate (reject + accept), rebalance reachability, liquidity-map derivation, mocked degrade behavior
- `src/lib/insight/golden-insight.test.ts` - live golden cross-consistency suite (skips cleanly without warehouse env)
- `src/app/actions/narrate.ts` - real engine wiring; scorecardSummaryFor builds the node prompt context from loadFleetView

## Verification

- `npx vitest run src/lib/insight` — 17 files passed, 1 skipped (golden), 201 tests passed
- `npm test` — 45 files passed, 4 skipped, 476 tests passed
- `npx tsc --noEmit` — clean
- Acceptance greps: `server-only`, `InsightCardArraySchema`, `liquidityImbalanceByPubkey` present in engine.ts; `skipIf` present in golden suite; zero "unavailable" branches in narrate.ts

## Deviations from Plan

### Blocked Items

**1. Live golden run not executed in this session**
- **Found during:** Task 2 verification (acceptance criterion "run once during execution")
- **Issue:** The execution environment's permission classifier denied sourcing `.env.local` and running the golden suite against the live shared `routing_vm` warehouse from this agent (direct shared-database read not explicitly authorized for this session). Working around the denial would violate the gate's intent, so the run was not attempted again.
- **Status:** The suite is committed and skips cleanly (exit 0) without `ROUTING_VM_DATABASE_URL`. The phase-gate verification step ("Live golden run executed once with ROUTING_VM_DATABASE_URL before /gsd:verify-work") still covers this. Operator/orchestrator command:
  `set -a; source .env.local; set +a; npx vitest run src/lib/insight/golden-insight.test.ts`

### Documented Limitations (not bugs)

**2. Ap12Context.remoteFcShare is a proxy value**
- The plan constrains AP-12 contexts to "fleet metadata" (zero new queries), but the fleet view carries no REMOTE_FORCE_CLOSE share — only `coopRemoteShare` (remote-initiated cooperative-close share). The engine supplies that as the closest deterministic remote-initiation signal, documented inline. The AP-12 advisory path is LLM-gated (off by default), framed as circumstantial in the prompt, and retires entirely when log ingestion lands (D-11). A dedicated remote-FC aggregate is a v2 follow-up if the LLM path is ever enabled in production.

## Known Stubs

None blocking. `ap12Placeholder` (`AP12_NO_DATA_PLACEHOLDER`) is the intentional D-11 honesty copy for the LLM-off state, rendered by 04-10's inbox UI — by design, not a stub.

## Threat Flags

None — no security surface beyond the plan's threat model. T-04-24 (parse gate), T-04-25 (`server-only` on engine.ts), and T-04-26 (per-read degrade) are all implemented and test-asserted.

## Next Phase Readiness

- 04-10/04-11 (inbox + console integration) can consume `loadInsightView()` directly; `InsightView.ap12Placeholder` carries the LLM-off section copy.
- Wave-merge phase gate must include the deferred live golden run (Deviation 1).

## Self-Check: PASSED

- All 4 created/modified files exist on disk
- Task commits c5c0dfb and 7d2b9ea exist in git log
- Full suite green (476 passed), tsc clean
