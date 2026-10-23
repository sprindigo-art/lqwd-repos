---
phase: 04-insight-engine
reviewed: 2026-06-12T00:00:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - src/app/(overview)/[pubkey]/[tab]/page.tsx
  - src/app/(overview)/@modal/inbox/page.tsx
  - src/app/(overview)/@modal/pending/page.tsx
  - src/app/(overview)/inbox/page.tsx
  - src/app/(overview)/layout.tsx
  - src/app/(overview)/pending/page.tsx
  - src/app/actions/narrate.ts
  - src/components/chrome/MastheadNav.tsx
  - src/components/console/ActiveSignalsPanel.tsx
  - src/components/console/FleetPendingBoard.tsx
  - src/components/console/PendingBoard.tsx
  - src/components/insight/InsightCardList.tsx
  - src/components/insight/InsightCardRow.tsx
  - src/components/insight/NarrateButton.tsx
  - src/lib/ai/provider.ts
  - src/lib/console/pending-summary.ts
  - src/lib/insight/config.ts
  - src/lib/insight/deeplink.ts
  - src/lib/insight/detectors/ap12-advisory.ts
  - src/lib/insight/detectors/close-cluster.ts
  - src/lib/insight/detectors/close-storm.ts
  - src/lib/insight/detectors/fee-signals.ts
  - src/lib/insight/detectors/fee-stepdown.ts
  - src/lib/insight/detectors/htlc-timeout.ts
  - src/lib/insight/detectors/rebalance.ts
  - src/lib/insight/detectors/stuck-pending.ts
  - src/lib/insight/engine.ts
  - src/lib/insight/fee-history.ts
  - src/lib/insight/guardrails.ts
  - src/lib/insight/labels.ts
  - src/lib/insight/narrative.ts
  - src/lib/insight/rank.ts
  - src/lib/insight/schema.ts
  - src/lib/insight/types.ts
findings:
  critical: 0
  warning: 6
  info: 5
  total: 11
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-06-12T00:00:00Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

Reviewed the Insight Engine phase: the frozen zod card contract, eight deterministic detectors, the SQL query builders, the three-pass self-guardrail pipeline, the rank, the off-by-default LLM narration layer, and the /inbox + /pending UI surfaces.

The four highest-risk invariants the brief called out all hold up under tracing:

- **SQL injection surface is clean.** Every detector query builder (`close-cluster`, `rebalance`, `htlc-timeout`, `fee-signals`, `fee-stepdown`, `fee-history`) interpolates only number-typed window/count params through Drizzle's `sql` tag, which parameterizes them. No `sql.raw`, no string concatenation, no user-derived value reaches any query. The `close_initiator`/`close_type` enum filters are fixed literals.
- **The D-12 safety invariant holds.** `InsightCardSchema.superRefine` structurally enforces `provenance:"llm-inference" ⇒ severity:"info" AND suggestedAction:null`, and the final `InsightCardArraySchema.parse` gate throws before any invalid card can render. AP-12 advisory cards carry `suggestedAction: null`.
- **The LLM layer never produces numeric params.** `narrateCards`/`ap12AdvisoryCards` return `result.text` verbatim; nothing parses model output back into structured `params`. The `narrate` server action recomputes cards server-side and never accepts client-supplied cards.
- **Limbo/sat aggregation in `pending-summary.ts` is sound** — attached sweeps are folded into their parent channel's `limboBalance` (not double-counted), orphan sweeps are additive, and every unexpected `channel_state` key still feeds the totals.

No BLOCKER-class defects were found. The findings below are correctness/honesty defects in the guardrail post-passes (stale guidance text surviving onto held/suppressed cards), a scope gap in the suppression set (`remediate_pending` is not treated as a write), and several robustness/quality issues.

## Warnings

### WR-01: Stale `rateLimitGuidance` text survives onto hysteresis-held and suppressed fee cards

**File:** `src/lib/insight/detectors/fee-signals.ts:232`, `src/lib/insight/guardrails.ts:62-97,107-122`
**Issue:** `buildCard` pre-stamps every fee card with a non-null `rateLimitGuidance` string at creation. In the engine pipeline (`assembleCards`), `applyHysteresis` runs first and, for a held card, sets `suggestedAction: null` but leaves `rateLimitGuidance` untouched. `applyRateLimitGuidance` then skips that card because `isCountedWrite` is false (action is null), so it returns it via `{ ...card }` unchanged — the stamped guidance string persists. The same happens to suppressed cards: `applySuppression` nulls the action but never clears `rateLimitGuidance`. `InsightCardRow.tsx:131` renders `rateLimitGuidance` whenever it is non-null, so a fee card that has NO actionable write recommendation (held by hysteresis, or write withheld by AP-11 suppression) still displays "Suggested cap: 4 write recommendation(s) per node per day" — a recommendation about a recommendation that no longer exists. This is a fail-loud honesty regression on exactly the cards the guardrails were meant to neutralize.
**Fix:** Do not pre-stamp `rateLimitGuidance` in the detector — leave it `null` and let `applyRateLimitGuidance` own the field exclusively (it already does for surviving writes). Alternatively, null `rateLimitGuidance` in `applyHysteresis` and `applySuppression` whenever they null the action:
```ts
// applyHysteresis held branch / applySuppression write branch:
return { ...withDetail(card, ...), suggestedAction: null, rateLimitGuidance: null };
```

### WR-02: `remediate_pending` actions escape D-14 suppression on AP-11-flagged nodes

**File:** `src/lib/insight/guardrails.ts:29-33,107-122`
**Issue:** `WRITE_ACTION_TYPES` contains only `update_fee`, `close_channel`, `rebalance`. The guardrails banner states suppression "withhold[s] ALL writes on flagged nodes" (D-14), but `remediate_pending` is excluded from the set. `remediate_pending` is a discriminated-union variant in `SuggestedActionSchema` with concrete params (`channelPoint`, `outpointTxid`, `suggestedSatPerVbyte`) that Phase 6 "signs canonical(params)" and exports as an executable command (bump_fee / restart_procedure / aged_funding). So on a node flagged for an AP-11 close storm, a `stuck_sweep` or `stuck_fc_past_maturity` card still surfaces an actionable remediation command with live params, contradicting the stated "all writes withheld" guarantee. Either remediate_pending is genuinely not a write (then the "ALL writes" wording is misleading) or it is (then it must enter the suppression scan).
**Fix:** Decide explicitly. If remediate_pending is operator-run-only and intentionally orthogonal to fee-churn suppression, narrow the D-14 comment to name the three policy-write types it actually covers. If it should be suppressed on flagged nodes, add it to `WRITE_ACTION_TYPES` (note this also pulls it into `applyRateLimitGuidance` counting — confirm that is desired).

### WR-03: `htlc-timeout` critical can fire on a node that never crosses the warn floor

**File:** `src/lib/insight/detectors/htlc-timeout.ts:146-148`
**Issue:** `isCritical = sigCount24h >= htlcTimeoutCriticalCount` (10 in 24h) and `isWarn = sigCount >= htlcTimeoutMinCount` (2 in window). Because `sigCount24h` is a subset of `sigCount`, any node with ≥10 in 24h necessarily has ≥10 in the window, so critical implies warn — that direction is fine. The real edge is the inverse evidence assignment at line 169-172: when `isCritical` is true the evidence reports the 24h count/window, but the *card severity* short-circuits warn entirely. That is intended. The genuine concern: `htlcTimeoutCriticalCount` (10) is compared against the 24h bucket while `htlcTimeoutMinCount` (2) is compared against the configurable `htlcWindowDays` (30d) bucket — a node with exactly 10 closes all inside 24h gets `critical`, but a node with 9 closes in 24h plus 0 older gets `warn` with `observed: 9` against `threshold: 2` over "30d", overstating the window the 9 actually occurred in. The 30d-window label on a 24h-clustered event is misleading evidence for an operator triaging severity.
**Fix:** When the warn path fires but the closes are recent, the window label is still accurate for the count shown (`sigCount` over `htlcWindowDays`), so this is acceptable — but consider surfacing `sigCount24h` in `evidence.detail` on the warn path too so the operator sees the recency split without escalating. Lower priority; document the window semantics if left as-is.

### WR-04: `fee_lower` suggestion can be lower than the channel's current PPM only by assumption, never validated against the floor

**File:** `src/lib/insight/detectors/fee-signals.ts:148-150,206-207`
**Issue:** `fee_lower` fires when `currentPpm > feeCeilingPpm` (500) and emits `suggestedPpm: feeLowerTargetPpm` (150). There is no guard that `feeLowerTargetPpm < currentPpm` in the abstract — it happens to hold because firing requires `currentPpm > 500 > 150`. But the symmetric `fee_raise` path emits `suggestedPpm: feeFloorPpm` (30) only when `currentPpm < feeFloorPpm` (30), so `suggestedPpm > currentPpm` holds there too. The latent risk: these two invariants are enforced implicitly by the firing predicates and the relative ordering of three independent config knobs (`feeFloorPpm`, `feeCeilingPpm`, `feeLowerTargetPpm`). An operator retuning `config.ts` (explicitly invited — "STARTING VALUES, NOT CONTRACT") could set `feeLowerTargetPpm` above `feeCeilingPpm` and produce a `fee_lower` card whose `suggestedPpm` is *higher* than `currentPpm` — a fee raise mislabeled as a lower. No assertion catches this.
**Fix:** In `buildCard`, assert direction consistency before emitting the write, or skip the card when the suggestion contradicts the signal direction:
```ts
if (signal === "fee_raise" && suggestedPpm <= facts.currentPpm) return null;
if (signal === "fee_lower" && suggestedPpm >= facts.currentPpm) return null;
```

### WR-05: `feeSignalChannelsForNode` per-node fan-out has no failure isolation — one node's read failure drops the entire fleet's fee signals

**File:** `src/lib/insight/engine.ts:344-348`
**Issue:** The fee-signal channel read is `degrade("fee-signal channels", () => Promise.all(cardNodes.map(...)), [])`. `Promise.all` rejects on the first node's `latestChannelsForNode` rejection, so a single node's transient read failure makes the whole `degrade` wrapper fall back to `[]` — every node loses its fee_raise / fee_lower / close_candidate cards, not just the failing one. For a ~26-node fleet this means one flaky node silently suppresses fleet-wide fee recommendations. The engine's own banner claims "one broken detector never takes the view down," but here one broken *node* takes a whole detector down.
**Fix:** Use `Promise.allSettled` and keep the successful nodes:
```ts
() => Promise.allSettled(cardNodes.map((n) => feeSignalChannelsForNode(n)))
        .then((rs) => rs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []))),
```

### WR-06: `ap12AdvisoryCards` reuses one batched narrative verbatim across every node and both signals

**File:** `src/lib/insight/detectors/ap12-advisory.ts:128-138`
**Issue:** `generateText` is called once over all contexts, and the single `result.text` is stamped into BOTH the `ap12a_conn_exhaustion` and `ap12b_serialization` card for EVERY node (`contexts.flatMap` produces `2 × contexts.length` cards all carrying the identical `narrative`). So for a 26-node fleet with the LLM on, 52 advisory cards render the same paragraph in `evidence.detail.narrative`. An operator reading node B's "CONN EXHAUSTION" card sees prose that may be discussing node A. The cards are info/non-actionable (D-12), so this is not a safety defect, but it is materially misleading evidence at the per-card level.
**Fix:** Either narrate per-node (one `generateText` per context, higher cost) or, cheaper, make the batched narrative a single fleet-scoped advisory section (like the AP-12 placeholder) rather than fanning the same text onto per-node cards. If kept as-is, the card copy/label should state the narrative is fleet-wide, not node-specific.

## Info

### IN-01: `success_rate` column computed in SQL but never consumed

**File:** `src/lib/insight/detectors/rebalance.ts:52`
**Issue:** `buildRebalanceSql` selects `COUNT(*) FILTER (WHERE paid_status)::float / NULLIF(COUNT(*),0) AS success_rate`, but `detectRebalance` recomputes the rate from `paid/attempts` and never reads `row.success_rate` (it is in the `RebalanceAggRow` type but unused). Dead computed column.
**Fix:** Drop `success_rate` from the SELECT and from `RebalanceAggRow`, or use it instead of recomputing.

### IN-02: `EPOCH` sentinel branch in `detectHtlcTimeout` is unreachable

**File:** `src/lib/insight/detectors/htlc-timeout.ts:125,173`
**Issue:** The comment acknowledges `MAX(timestamp)` is non-null for any row that appears in the GROUP BY, so `row.asOf` is never null for a firing card and the `?? EPOCH` fallback never executes. Defensive but dead. Acceptable; noting for completeness.
**Fix:** Keep as defensive code, or drop the sentinel if the contract guarantees non-null.

### IN-03: `InsightCardRow.formatValue` `"sats"` branch is dead for evidence values

**File:** `src/components/insight/InsightCardRow.tsx:40-44`
**Issue:** No detector emits `evidence.unit === "sats"` (units are ppm/ratio/closes/blocks/hours/attempts/nodes/sat-per-vB/n-a). The `formatSats` branch never fires for `card.evidence.observed`/`threshold`. The sat-denominated values live in `evidence.detail.limboSat`, which is rendered elsewhere. Harmless dead branch.
**Fix:** Remove the `"sats"` branch or leave as forward-compatibility for a future sat-unit metric.

### IN-04: Magic numbers in `ap12-advisory` evidence (`observed: 0`, `threshold: 0`, `unit: "n/a"`)

**File:** `src/lib/insight/detectors/ap12-advisory.ts:97-100`
**Issue:** AP-12 cards carry placeholder `observed: 0 / threshold: 0 / unit: "n/a"` purely to satisfy the schema's required evidence shape. These zeros feed `rank.ts:magnitudeOf` → `|0-0|/max(0,1) = 0`, so AP-12 cards always sort last in the info band by magnitude (then by id). Functionally fine, but the zeros are semantically meaningless evidence numbers an operator might misread.
**Fix:** Consider making `evidence.unit:"n/a"` cards skip the metric line in the row, so the meaningless `0 n/a · threshold 0` is not rendered.

### IN-05: `DEFAULT_TIME_LOCK_DELTA = 80` magic value documented but unverified at apply time

**File:** `src/lib/insight/detectors/fee-signals.ts:52,209`
**Issue:** `update_fee` params pass a hardcoded `timeLockDelta: 80` because the warehouse snapshot carries no TLD column. The comment correctly notes the node re-enforces actual bounds on apply, so this is a display/intent default, not an enforcement value — acceptable for Phase 4. Flagging so Phase 6 reviewers confirm the node-side executor never trusts this field as authoritative.
**Fix:** No change needed in Phase 4; ensure the Phase-6 node-side executor reads the real TLD and ignores the card's placeholder.

---

_Reviewed: 2026-06-12T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
