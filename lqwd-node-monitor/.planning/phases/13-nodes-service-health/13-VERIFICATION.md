---
phase: 13-nodes-service-health
verified: 2026-07-10T00:00:00Z
status: passed
score: 4/4 requirements verified (all success criteria + must-have truths verified)
overrides_applied: 0
re_verification:
  # No previous VERIFICATION.md — initial verification
gaps: []
---

# Phase 13: Nodes + Service Health Verification Report

**Phase Goal:** The Lightning depth of the redesign — the rebuilt Nodes list and Node Detail carrying the centerpiece per-node two-axis service-health grid, plus Service Detail where one service's full health, logs, and runbook live.
**Verified:** 2026-07-10
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must-haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Nodes list rebuilt: at-risk rows pop (accent + tint), type/status/stale filters, sortable columns, liquidity/forwarding evidence, row→detail nav | ✓ VERIFIED | `nodes/page.tsx` (8KB RSC) + `NodesTable.tsx` (severityAccent/severityVariants/severityLabel pop, sort as pure view, `href = /${row.pubkey}` row nav) + `NodeFilters.tsx` + `node-filter.ts` (`parseNodeFacets`/`applyNodeFilters` pure whitelist-widen). 29 pure unit tests pass. |
| 2 | Node Detail rebuilt: identity, Lightning perf (channels/fees/forwards/peers/history), diagnostics w/ evidence, adaptive action, read-only safety posture | ✓ VERIFIED | Lean `/[pubkey]/page.tsx` (12.8KB) assembles NodeHeader/VmVitals/LightningState/NodeActiveSignals/ReadOnlySafetyPosture + routed sub-routes `/channels`, `/peers`, `/forwards` (each an RSC). NodeDetailTabs wired. |
| 3 | NODE-04 withdraw state: approved→withdrawn transition + enum + WithdrawAffordance | ✓ VERIFIED | `state.ts` LEGAL: `approved → withdrawn` only; `transitions.ts` `withdraw()` guarded `WHERE state='approved'` RETURNING, 0-row → throws WITHDRAW_CLAIMED_ERROR; `command_state` enum incl. `withdrawn` (schema + migration `0002_productive_the_order.sql` ADD VALUE); `withdrawCommand`/`enqueueAndApprove` actions (client sends params only, server signs once); WithdrawAffordance wired via `approvedByChanId` in channels sub-route. 10 unit tests pass. |
| 4 | Two-axis service-health grid: 6 LQWD services + infra deps, green only when running AND functioning, "up but dead" unmistakable | ✓ VERIFIED | `ServiceHealthGrid.tsx` composes `TwoAxisPip` × N under INFRASTRUCTURE / LQWD SERVICES kickers; `resolveNodeServices` (pubkey→hostId via `buildOwnershipMap`, no pubkey-as-hostId); combinedState locked in TwoAxisPip; up-but-dead (running && !functioning) rendered distinct. TwoAxisPip tests pass. Grid wired onto `/[pubkey]` overview. |
| 5 | Service Detail: two-axis health, heartbeat/last-run/error-count, log tail, restart history, dependents, verify-first runbook, infra (bitcoind) + custom (addressBalances) variants | ✓ VERIFIED | `/[pubkey]/service/[service]/page.tsx` (13.2KB, PUBKEY_RE validated) branches `isInfra = service === "bitcoind"` → getChainTelemetry vs resolveNodeServices; components ServiceDetailShell/ServiceVitals/ServiceLogTail/RestartHistory/Dependents/VerifyFirstRunbook all present. |

**Score:** 5/5 truths verified · 4/4 requirements satisfied

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `src/lib/overview/node-filter.ts` | ✓ VERIFIED | parseNodeFacets/applyNodeFilters pure; tests pass |
| `src/app/(overview)/nodes/page.tsx` + NodesTable/NodeFilters | ✓ VERIFIED | Wired to node-filter; row→/[pubkey] link |
| `src/lib/queue/state.ts` / `transitions.ts` | ✓ VERIFIED | approved→withdrawn edge + guarded withdraw() |
| `src/app/actions/queue.ts` | ✓ VERIFIED | enqueueAndApprove + withdrawCommand |
| `drizzle/nodemon/0002_*.sql` | ✓ VERIFIED | ALTER TYPE command_state ADD VALUE 'withdrawn' |
| `src/app/(overview)/[pubkey]/page.tsx` | ✓ VERIFIED | Lean overview; imports+renders NodeDetailTabs/LiquidityGauge/ServiceHealthGrid/resolveNodeServices/aggregateLiquidity |
| `NodeDetailTabs.tsx` / `LiquidityGauge.tsx` | ✓ VERIFIED | Tab bar + navy-local/grey-remote reference gauge (G12) |
| `/[pubkey]/{channels,peers,forwards}/page.tsx` | ✓ VERIFIED | Routed RSC sub-routes; channels wires WithdrawAffordance via approvedByChanId |
| `src/lib/read/node-services.ts` + `ServiceHealthGrid.tsx` | ✓ VERIFIED | resolveNodeServices + TwoAxisPip compose |
| `/[pubkey]/service/[service]/page.tsx` + service/* | ✓ VERIFIED | Route + 6 sub-components, infra/custom variants |

### Key Link Verification

| From | To | Status |
|------|----|--------|
| nodes/page.tsx → node-filter.ts | parseNodeFacets/applyNodeFilters | ✓ WIRED |
| NodesTable → /[pubkey] | row href/router.push | ✓ WIRED |
| queue actions → withdraw()/enqueue()/approve() | server-side sign-once | ✓ WIRED |
| [pubkey]/page.tsx → ServiceHealthGrid/LiquidityGauge/NodeDetailTabs | import+render | ✓ WIRED |
| channels/page.tsx → WithdrawAffordance | approvedByChanId prop | ✓ WIRED |
| node-services.ts → ownership.buildOwnershipMap | hostByNode resolution | ✓ WIRED |
| service page → chain-telemetry / node-services | variant dispatch | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Type surface compiles | `npx tsc --noEmit` | exit 0, 0 errors | ✓ PASS |
| Nodes-list pure filter/sort logic | `vitest run node-filter.test.ts` | 3 files / 29 tests pass (incl. TwoAxisPip, liquidity-split) | ✓ PASS |
| withdraw() guard + audit | `vitest run withdraw.test.ts + NodeFeeEnqueue.test.tsx` | 2 files / 10 tests pass | ✓ PASS |

### Anti-Patterns Found

None. No TBD/FIXME/XXX/HACK/placeholder debt markers in phase-modified surfaces. The `@modal` parallel-route slot (systemic soft-nav 404 root cause) was fully removed in 13-23; no residual `@modal` directory or `default.tsx` remain (only explanatory comments). VM vitals and per-node logs render honest-empty by design (no per-host time-series / per-node log reader exists) — surfaced and accepted at the operator gate, not fabricated data.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| NODE-03 | 13-02, 13-04, 13-23 | ✓ SATISFIED | Nodes list rebuilt + filters/sort/at-risk pop/row nav |
| NODE-04 | 13-01, 13-03, 13-06, 13-07, 13-10..22 | ✓ SATISFIED | Node Detail rebuilt (lean overview + routed tabs) + withdraw state machine + WithdrawAffordance |
| SVC-01 | 13-05, 13-15 | ✓ SATISFIED | Two-axis ServiceHealthGrid + resolveNodeServices |
| SVC-02 | 13-09 | ✓ SATISFIED | Service Detail infra/custom variants + runbook |

No orphaned requirements: REQUIREMENTS.md maps exactly NODE-03/04, SVC-01/02 to Phase 13 — all four covered by plans and verified.

### Human Verification

No outstanding items. All operator visual gates for this phase were conducted and **APPROVED live on 2026-07-10** (documented in 13-NODE-DETAIL-GATE-FEEDBACK.md and plan summaries): the routed-tabs redesign (G1–G4), G5–G9 layout/routing round ("Rest looks great"), G10–G12 (forwards columns / soft-nav 404 / gauge reference color), and the 13-23 `@modal` removal (soft-nav APPROVED across Ops Center → Nodes/alias → node, Overview ↔ Channels/Peers/Forwards). The single-scroll original (13-08) was correctly SUPERSEDED after operator rejection.

### Gaps Summary

None. All 4 requirement IDs satisfied, all 5 observable truths verified against the codebase, all key links wired, typecheck clean, all 39 phase-13 unit tests pass. Known-acceptable exclusions (NOT phase gaps): the pre-existing `src/lib/queue/{approve,claim,enqueue,stub-executor}` live-DB integration tests fail on `nodemon_rw` DELETE grants — a pre-existing environment/grant issue documented in STATE, not introduced by this phase. Honest-empty carry-forwards (VM vitals, per-node logs) are by-design accepted limitations, not stubs of dynamic data.

---

_Verified: 2026-07-10_
_Verifier: Claude (gsd-verifier)_
