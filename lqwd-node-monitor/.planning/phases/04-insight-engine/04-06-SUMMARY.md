---
phase: 04-insight-engine
plan: 06
subsystem: insight
tags: [detectors, rebalance, stuck-pending, insight-02, pending-02, tdd, wave-3]
requires:
  - "04-01 InsightCardSchema / InsightCard types (frozen contract)"
  - "04-02 INSIGHT_CONFIG knobs + buildDeepLink + D-06 rank key convention"
  - "src/lib/read/pending.ts buildPendingView (sanctioned pending reader)"
provides:
  - "buildRebalanceSql + detectRebalance (src/lib/insight/detectors/rebalance.ts) — INSIGHT-02 detector 6, both signals"
  - "detectStuckPending (src/lib/insight/detectors/stuck-pending.ts) — PENDING-02 three cases, zero SQL"
  - "evidence.detail.limboSat numeric rank key on every stuck card (D-06 inbox sort input)"
affects:
  - "04-09 engine (calls both detect* fns; supplies liquidityImbalanceByPubkey for rebalance-action reachability)"
  - "04-07/04-08 suppression/guardrails post-pass (rebalance is a write-type action)"
  - "Phase 5 export (remediate_pending runbook/bumpfee rendering)"
tech-stack:
  added: []
  patterns:
    - "force-close.ts dimension anatomy: banner -> SQL builder (bound params) -> raw-row interface -> pure detect()"
    - "COUNT(*) FILTER (WHERE paid_status) / NULLIF(COUNT(*),0) success-rate idiom on requesting_node_pubkey identity"
    - "Injectable-now pure detector (detectStuckPending(view, config, nowMs)) — buildPendingView precedent"
    - "Single numeric-coercion point for the limboSat rank key (Pitfall 3)"
key-files:
  created:
    - src/lib/insight/detectors/rebalance.ts
    - src/lib/insight/detectors/rebalance.test.ts
    - src/lib/insight/detectors/stuck-pending.ts
    - src/lib/insight/detectors/stuck-pending.test.ts
  modified: []
decisions:
  - "buildRebalanceSql carries a second bound param (partnerMinAttempts, defaulted from INSIGHT_CONFIG.lnd.rebalancePartnerMinAttempts) so the HAVING floor is parameter-bound per T-04-13 without restating the D-13 knob"
  - "Partner-binary card dedupe id uses remotePubkey as the D-08 targetKey — the plan's target spec sets chanId and channelPoint to null, and the partner pubkey is the stable per-(detector, node, target) identity"
  - "Sweep evidence reflects the strongest firing reason (attempts > age > under-fee); under-fee sub-case uses unit 'sat/vB' with observed=actual, threshold=requested — honest evidence rather than an attempts metric that would sit below its own threshold"
  - "node.backend hardcoded 'lnd' in both detectors: internal_rebalance_invoices and lnd_node_pending_* are LND-only sources"
  - "Unknown-identity pending groups (localPubkey fallback 'unknown') deep-link to FLEET_PENDING_LINK instead of throwing in buildDeepLink — legitimate reader state, not detector garbage"
metrics:
  duration: "~9 min"
  completed: "2026-06-12T06:58:00Z"
  tasks: 2
  files: 4
---

# Phase 4 Plan 06: Rebalance + Stuck-Pending Detectors Summary

Rebalance partner-binary/node-degradation detector over internal_rebalance_invoices plus the three-case PENDING-02 stuck-pending detector consuming buildPendingView() with the limboSat D-06 rank key on every card.

## Task Commits

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | rebalance.ts — partner-binary + node-level degradation | 071c213 (test, RED), 3c9f960 (feat, GREEN) | rebalance.ts, rebalance.test.ts |
| 2 | stuck-pending.ts — PENDING-02 three cases, no new SQL | 0917a49 (test, RED), c889f10 (feat, GREEN) | stuck-pending.ts, stuck-pending.test.ts |

## What Was Built

**rebalance.ts (INSIGHT-02 detector 6):**
- `buildRebalanceSql(windowDays = 7, partnerMinAttempts = knob)` — fleet-wide per-(node, partner) aggregate on `internal_rebalance_invoices`, identity `requesting_node_pubkey` (Pitfall 6), `COUNT(*) FILTER (WHERE paid_status) / NULLIF(COUNT(*), 0)` success rate, both window and HAVING floor parameter-bound (T-04-13).
- `detectRebalance(rows, config, liquidityImbalanceByPubkey?)` — pure:
  - Partner-binary: 0% success with >= 20 attempts (rebalanceBinaryMinAttempts) → warn `rebalance_partner_failure`, always `investigate` (state remediation vs closing is a human call). 0/10 stays silent — the 5-attempt HAVING floor only bounds the SQL.
  - Node-level: 7d rate < 0.5 with >= 20 attempts → info `rebalance_degraded`. `rebalance` action emitted ONLY with a viable partner (paid > 0 in window) AND a nonzero supplied imbalance; `amountSat = min(floor(|imbalance|/2), 5_000_000)` ([ASSUMED A5], T-04-15 cap test-asserted); direction from imbalance sign (positive localSat-remoteSat ⇒ "out").

**stuck-pending.ts (PENDING-02 detectors 9–11):**
- `detectStuckPending(view, config, nowMs)` — pure, zero SQL (`grep -c "sql\`" = 0`), consumes the sanctioned `buildPendingView()` output; maturity grace absorbs the 6h collector cadence ([ASSUMED A3]).
- (a) FORCE_CLOSE, limbo > 0, blocks_til_maturity <= -6 → warn, <= -144 → critical; `remediate_pending { case: "restart_procedure" }` (data-only runbook, T-04-14).
- (b) Sweeps (nested AND orphans): attempts > 5 OR age > 14d OR sat_per_vbyte < requested → warn; attempts >= 12 → critical; `remediate_pending { case: "bump_fee", suggestedSatPerVbyte: requested ?? null }`.
- (c) PENDING_OPEN aged > 24h → warn, > 72h → critical; `remediate_pending { case: "aged_funding" }`.
- Every card carries numeric `evidence.detail.limboSat` (limbo_balance for channels, amount_sat for sweeps) coerced in ONE helper.

## Verification

- `npx vitest run src/lib/insight/detectors` — 35/35 green (13 rebalance + 22 stuck-pending)
- `grep -c 'sql\`' src/lib/insight/detectors/stuck-pending.ts` = 0
- Shape test asserts `requesting_node_pubkey`, `paid_status`, `NULLIF`, `HAVING COUNT(*) >= $n`, >= 2 bound params
- Cap fixture (-100B sat imbalance) → amountSat exactly 5,000,000
- All emitted cards parse via `InsightCardSchema` (frozen remediate_pending variants exact-matched)
- `npx tsc --noEmit` and `npx eslint src/lib/insight/detectors/` clean

## Deviations from Plan

### Minor documented choices (no Rule 1-3 fixes needed)

**1. buildRebalanceSql signature gained a second defaulted param**
- **Found during:** Task 1
- **Issue:** Plan's prose signature was `buildRebalanceSql(windowDays = 7)` but also required the HAVING floor as a bound param with >= 2 bound params total, and D-13 forbids restating knob values in detector code.
- **Resolution:** `partnerMinAttempts` param defaulting to `INSIGHT_CONFIG.lnd.rebalancePartnerMinAttempts` — bound, not restated.
- **Commit:** 3c9f960

**2. Sweep under-fee evidence unit "sat/vB"**
- **Found during:** Task 2
- **Issue:** Plan's unit list ("blocks"/"attempts"/"hours") covers the three primary observations; a sweep firing solely on under-fee would otherwise show an attempts observation below its own threshold.
- **Resolution:** Per-reason evidence (attempts > age > under-fee priority); under-fee uses observed=sat_per_vbyte, threshold=requested_sat_per_vbyte, unit "sat/vB".
- **Commit:** c889f10

## Known Stubs

None — both detectors are fully wired to their data sources; the `rebalance` action's third argument (liquidityImbalanceByPubkey) is supplied by the 04-09 engine per that plan's explicit contract.

## Self-Check: PASSED

- src/lib/insight/detectors/rebalance.ts — FOUND
- src/lib/insight/detectors/rebalance.test.ts — FOUND
- src/lib/insight/detectors/stuck-pending.ts — FOUND
- src/lib/insight/detectors/stuck-pending.test.ts — FOUND
- Commits 071c213, 3c9f960, 0917a49, c889f10 — FOUND
