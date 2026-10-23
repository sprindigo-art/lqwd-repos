---
phase: 05-command-export-prong-2
plan: 02
subsystem: insight-engine
tags: [export, evidence-detail, enrichment, zero-new-reads]
requires:
  - "src/lib/insight/detectors/fee-signals.ts (close-candidate cards, latest-channel rows)"
  - "src/lib/insight/detectors/rebalance.ts (partner aggregate, remote_alias column)"
  - "src/lib/insight/engine.ts (nodeMetaFromFleet alias map, assembleCards pipeline)"
provides:
  - "evidence.detail.capacitySat on channel_close_candidate cards (raw sats)"
  - "evidence.detail.partnerAlias on rebalance_partner_failure + rebalance_degraded cards"
  - "evidence.detail.peerAlias on intra-fleet channel_close_candidate cards"
  - "exported enrichCloseCardPeerAlias(cards, metaByPubkey) pure post-pass"
affects:
  - "plan 05-03 export blocks (consume capacitySat/peerAlias/partnerAlias for context echo)"
tech-stack:
  added: []
  patterns:
    - "Conditional detail-add (unknown ≠ 0 / fake value) — T-05-08"
    - "Open z.record detail keys ride the frozen schema — no version bump (T-05-07)"
    - "Thread the selected partner back from the action helper (no second sort re-derivation)"
key-files:
  created: []
  modified:
    - src/lib/insight/detectors/fee-signals.ts
    - src/lib/insight/detectors/fee-signals.test.ts
    - src/lib/insight/detectors/rebalance.ts
    - src/lib/insight/detectors/rebalance.test.ts
    - src/lib/insight/engine.ts
    - src/lib/insight/engine.test.ts
decisions:
  - "capacitySat scoped to close-candidate cards only (matches the must_have truth + minimal blast radius)"
  - "rebalanceActionFor refactored to return { action, bestPartner } so partnerAlias always matches the action's selected partner — never re-derived with a second sort"
  - "enrichCloseCardPeerAlias scoped to channel_close_candidate only; all other cards pass through by reference"
metrics:
  duration: ~6m
  completed: 2026-06-12
  tasks: 2
  files: 6
---

# Phase 5 Plan 02: Contract-Safe Evidence Detail Enrichment Summary

Contract-safe `evidence.detail` enrichment (`capacitySat`, `peerAlias`, `partnerAlias`) from data already in hand — zero new SQL, zero schema changes, zero version bumps — so plan 05-03 export blocks can echo capacity and peer/partner aliases without a new read.

## What Was Built

**Task 1 — capacitySat + partnerAlias (commit e421e5b)**
- `fee-signals.ts`: added `capacitySat: number | null` to `ChannelFacts`, populated in `factsFor()` from `row.capacity` (the `lnd_node_channel_info.capacity` column already on the `latestChannelsForNode` rows). Conditional-add to close-candidate card detail as raw sats (AFM-002 formatter applies at render only).
- `rebalance.ts`: added `partnerAlias: string | null` to `PartnerAgg`, populated from `row.remote_alias` in the byNode grouping. Conditional-add to `rebalance_partner_failure` card detail. Refactored `rebalanceActionFor` to return `{ action, bestPartner }` so the `rebalance_degraded` card's `partnerAlias` matches the SAME partner the action selected — no second sort, no drift on ties.

**Task 2 — peerAlias post-pass (commit a45b550)**
- `engine.ts`: added exported pure `enrichCloseCardPeerAlias(cards, metaByPubkey)`. Stamps `evidence.detail.peerAlias` on `channel_close_candidate` cards whose `target.remotePubkey` is an intra-fleet node with a non-null alias, using the fleet alias map `nodeMetaFromFleet` already derives (zero new queries). Non-fleet / null-alias peers and all non-close cards pass through by reference; spread-copy never mutates inputs.
- Wired into `assembleCards` immediately after the detection array and BEFORE `applyHysteresis` (so enrichment precedes the schema-parse gate); guardrail ordering contract untouched.

## Verification

- `npx vitest run src/lib/insight` — 213 passed, 4 skipped (detectors + engine + schema.contract + golden-insight all green)
- `npx tsc --noEmit` — exit 0
- `git diff --stat src/lib/insight/schema.ts src/lib/insight/guardrails.ts src/lib/insight/types.ts` — empty (frozen contract untouched)

## Threat Model Compliance

- **T-05-07 (frozen schema)**: detail keys ride the open `z.record`; schema.ts zero diff; contract test green. ✓
- **T-05-08 (invented values)**: every new key is conditional-add — null capacity/alias produce NO key (unknown ≠ 0 / fake). ✓
- **T-05-06 (alias tampering)**: aliases stored RAW as data here; sanitization is the export layer's single point (plan 05-01), no double-encoding introduced. ✓

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/lib/insight/detectors/fee-signals.ts (contains capacitySat)
- FOUND: src/lib/insight/detectors/rebalance.ts (contains partnerAlias)
- FOUND: src/lib/insight/engine.ts (contains export function enrichCloseCardPeerAlias)
- FOUND commit e421e5b (Task 1)
- FOUND commit a45b550 (Task 2)
