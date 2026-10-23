---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 05
subsystem: read-layer / insight-detectors
tags: [pg-health, ap12, tdd, deterministic-detector, col-02, d-14]
requires: [15-01, 15-02]
provides:
  - "getPgHealth(hostId) + getFleetPgHealth() — pg_health latest-per-host readers (DISTINCT ON / ROW_NUMBER, param-bound)"
  - "derivePgHealthVerdict — PURE read-time AP-12a/b discriminator + conn-saturation and 40001-rate bands (D-14)"
  - "Deterministic ap12AdvisoryCards({cards, hasData}) — LLM stopgap retired, frozen contract preserved"
affects:
  - "15-09 (canary) — pg-health + ap12-advisory suites in the npm test gate"
tech-stack:
  added: []
  patterns:
    - "buildChainEvidence-style PURE verdict evaluator over RAW rows (D-14 extended to pg_health)"
    - "Fleet reader carries hosts.node_pubkeys so detectors map host facts onto node cards"
    - "Detector returns {cards, hasData} so the engine keys the honest placeholder on data availability, not an env flag"
key-files:
  created:
    - src/lib/read/pg-health.ts
    - src/lib/read/pg-health.test.ts
  modified:
    - src/lib/insight/detectors/ap12-advisory.ts
    - src/lib/insight/detectors/ap12-advisory.test.ts
    - src/lib/insight/engine.ts
decisions:
  - "AP-12a severity = worse of the pg_conn_saturation band and a too-many-clients grade (>100 FATAL lines = critical per the runbook confirm threshold; >0 = warn) — 'severity from the derived band, never hardcoded'"
  - "ap12a beats ap12b when both fire (runbook step 5: exhaustion is the primary signature)"
  - "Deterministic AP-12 cards keep suggestedAction null — AP-12 remediation is a runbook, not a signable queue intent"
  - "DATA_OPEN/DATA_CLOSE delimiters removed WITH the LLM path — no log text is narrated anywhere in the module (plan allows removal when no residual narration remains)"
  - "REQUIREMENTS COL-02 NOT marked complete — the collector half (probe_pg_health, Plan 15-07) and canary (15-09) still pend; orchestrator owns the final mark"
metrics:
  duration: ~8m
  completed: 2026-07-14
---

# Phase 15 Plan 05: pg-health Reader + Deterministic AP-12 Detector Summary

**One-liner:** `pg_health` latest-per-host reader with a PURE read-time AP-12a/b discriminator (conn-saturation band + BP-005 ≥10× 40001-rate promotion via `clampCounterDelta`), consumed by a deterministic `ap12AdvisoryCards` that retires the LLM stopgap while preserving the frozen placeholder + signal-id contract.

## Tasks Completed

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | pg-health reader + derivePgHealthVerdict (RED→GREEN) | af4a923 (test), 83a66ee (feat) | src/lib/read/pg-health.ts, pg-health.test.ts |
| 2 | Deterministic AP-12 detector — retire the LLM advisory | 79f176a (test), 8c33a96 (feat) | src/lib/insight/detectors/ap12-advisory.ts, ap12-advisory.test.ts, src/lib/insight/engine.ts |

## What Was Built

### Task 1 — `src/lib/read/pg-health.ts`
- `buildLatestPgHealthSql(hostId)`: `SELECT DISTINCT ON (host_id) * … ORDER BY host_id, collected_at DESC`, hostId param-bound ($1, T-15-01), never `MAX(` (AFM-001).
- `derivePgHealthVerdict(current, previous?, baseline40001PerDay=600)` — PURE (mirrors `buildChainEvidence`): connSaturation = active/max → `pg_conn_saturation` band; 40001 Δ via `clampCounterDelta` across `stats_reset` boundaries (Pitfall 7, never negative), scaled per-day by the real sample interval; rateMultiple = rate ÷ baseline → `pg_40001_rate_multiple` band. Discriminator: too-many-clients > 0 OR saturation ≥ 0.8 ⇒ `"ap12a"`; else rate ≥ 10× baseline ⇒ `"ap12b"`; else null. Nothing is ever read from a stored verdict (D-14 / T-15-08).
- `getPgHealth(hostId)` (latest + previous sample, lazy `dbNodemon` idiom) and `getFleetPgHealth()` (hosts-dimension LEFT JOIN, ROW_NUMBER rn≤2 per host, carries `hosts.node_pubkeys` for the detector fan; never-probed hosts read as no-data).
- 16 unit tests: ap12a via counter and via saturation, ap12b at 16.7×, **BP-005 benign 500/day ⇒ null variant (no false page)**, baseline override, stats_reset clamp (Δ≥0), honest no-data (no previous / missing max_conn).

### Task 2 — deterministic `ap12-advisory.ts`
- `ap12AdvisoryCards(nodes)` now returns `{ cards, hasData }`: fans over `getFleetPgHealth()`, maps flagged hosts' `nodePubkeys` onto requested nodes, emits ONE card per (node, fired variant) via pure `buildAp12Card`.
- Frozen contract preserved verbatim: `AP12_NO_DATA_PLACEHOLDER` (exact-string test), signal ids `ap12a_conn_exhaustion` / `ap12b_serialization`, id rule `${signal}:${pubkey}:node`, InsightCard shape (schema-parse asserted).
- Provenance `"deterministic"` (the schema's non-LLM value — plan's "e.g. detector" isn't in the frozen enum); severity from the derived band; evidence.observed = the actual counter (too-many-clients lines / saturation ratio / rate multiple), threshold = the band cutoff (100 / 0.8 / 10).
- LLM path fully removed: no `generateText`, no `import("ai")`, no `getModel`, no `isLlmEnabled` in the module (grep-gated); DATA_OPEN/CLOSE delimiters removed with it since no log text is narrated.
- `engine.ts`: ap12 detector un-gated from the LLM flag (runs every load under `degrade`), `ap12Placeholder` now keyed on `hasData` — the honest no-data copy shows exactly when `pg_health` has no rows; `buildAp12Contexts` (LLM context builder) deleted. `InsightView` shape unchanged; existing engine tests pass unmodified.

## TDD Gate Compliance

RED→GREEN verified in git log for both tasks:
1. `af4a923` test(15-05) — pg-health RED (module absent, import failure)
2. `83a66ee` feat(15-05) — pg-health GREEN (16/16)
3. `79f176a` test(15-05) — ap12 detector RED (10 failed / 1 passed against the LLM module)
4. `8c33a96` feat(15-05) — detector GREEN (11/11)

No refactor commit needed.

## Deviations from Plan

**1. [Rule 3 - Blocking] engine.ts call-site updated (file not in plan's files_modified)**
- **Found during:** Task 2
- **Issue:** `ap12AdvisoryCards`'s signature change (Ap12Context[] → Ap12NodeRef[], array → `{cards, hasData}`) breaks `engine.ts` compilation; and leaving the detector gated behind `INSIGHT_LLM_ENABLED` would make the deterministic path unreachable (Rule 2 — the placeholder would show forever with the flag off).
- **Fix:** minimal engine edit — always run the detector under `degrade`, key `ap12Placeholder` on `hasData`, delete the now-dead `buildAp12Contexts`. `llmEnabled` stays in `InsightView` (still drives NarrateButton).
- **Files modified:** src/lib/insight/engine.ts
- **Commit:** 8c33a96

**2. [Adaptation] provenance value is "deterministic", not "detector"**
- The frozen `InsightCardSchema` enum is `["deterministic", "llm-inference"]`; the plan's "e.g. 'detector'" is not a schema member. Used `"deterministic"` — satisfies "no longer 'llm-inference'" without a breaking schema change.

**3. [Adaptation] getFleetPgHealth added beyond the three required exports**
- The detector needs a host→node-pubkey mapping; a fleet variant (hosts LEFT JOIN, rn≤2 window) keeps that in the read layer so the detector stays DB-free except via the reader. `getPgHealth(hostId)` exists exactly as specified. The purity grep (`db/nodemon|dbNodemon`) matches only inside the two async readers; `derivePgHealthVerdict` is pure.

## Verification

- `npx vitest run src/lib/read/pg-health.test.ts src/lib/insight/detectors/ap12-advisory.test.ts` — 27/27 green.
- Full `npx vitest run src/lib/read src/lib/insight` — 487 pass / 21 skipped, no regressions (engine tests untouched and green).
- `npx tsc --noEmit` — zero errors (no ap12-advisory/pg-health/engine lines).
- Greps: `AP12_NO_DATA_PLACEHOLDER` ×3, both signal ids present, `generateText|import("ai")|isLlmEnabled` → nothing; `distinct on (host_id)` + `$1` binding asserted in tests.
- Live `pg_health` NOT touched — migration 0003 remains operator-gated (Plan 15-01); all coverage is fixture/mock-based per the wave instructions.

## Known Stubs

None. (`AP12_NO_DATA_PLACEHOLDER` rendering when `pg_health` is empty is the designed honest no-data state, not a stub — it resolves when the Plan 15-07 collector + 15-09 canary land rows.)

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. T-15-01 mitigated (bound params, injection-shape test); T-15-07 mitigated by removing the LLM path entirely (no prompt surface remains, detector emits no runnable command); T-15-08 mitigated (variant/band derived at read from RAW counters, nothing stored to poison).

## Self-Check: PASSED

- FOUND: src/lib/read/pg-health.ts (getPgHealth, derivePgHealthVerdict, buildLatestPgHealthSql, getFleetPgHealth)
- FOUND: src/lib/read/pg-health.test.ts
- FOUND: src/lib/insight/detectors/ap12-advisory.ts ("ap12a_conn_exhaustion", provenance "deterministic", placeholder verbatim)
- FOUND commits: af4a923, 83a66ee, 79f176a, 8c33a96
