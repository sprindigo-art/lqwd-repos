---
phase: 04-insight-engine
plan: 10
subsystem: ui
tags: [inbox, insight-cards, rsc, noc-light, triage]
requires:
  - 04-02 (SIGNAL_LABELS vocabulary, InsightCard schema/types)
  - 04-08 (loadInsightView engine, guardrail state on cards)
  - 04-09 (NarrateButton, narrate server action, llmEnabled/ap12Placeholder on InsightView)
provides:
  - /inbox triage page (INSIGHT-03 fleet-wide recommendation surface)
  - InsightCardRow / InsightCardList rendering primitives for engine cards
affects:
  - 04-11 (console SignalRows share the SIGNAL_LABELS vocabulary, not these components)
  - 04-12 (operator visual gate verifies this surface)
tech-stack:
  added: []
  patterns:
    - renderToStaticMarkup component-test harness under plain node vitest (no jsdom, no react plugin)
    - severity-section partition of a pre-ranked array (stable filter, zero ranking logic in UI)
key-files:
  created:
    - src/components/insight/InsightCardRow.tsx
    - src/components/insight/InsightCardList.tsx
    - src/components/insight/insight-cards.test.ts
    - src/app/(overview)/inbox/page.tsx
  modified: []
decisions:
  - "Deep-link tab label derived from the validated deeplink.ts path shape (segment 2, '/pending' → 'pending') — presentation-only string split, no new link construction"
  - "Suppressed cards render a muted WITHHELD block showing only evidence.detail.withheldAction — params are structurally null (T-04-29), so disabled means visibly muted, never hidden params"
  - "Component tests render Server Components via react-dom/server renderToStaticMarkup in the existing node vitest env — next/link renders fine without a router context; no jsdom or testing-library dependency added"
metrics:
  duration: ~4 min
  completed: 2026-06-12
---

# Phase 4 Plan 10: Triage Inbox Summary

Dedicated /inbox RSC page renders loadInsightView's pre-ranked cards verbatim in severity sections with suppression/hysteresis/rate-limit state visible, the honest empty state, the AP-12 page-copy placeholder, and the llmEnabled-gated fleet narrate button.

## What Was Built

### Task 1 — Card rendering primitives (commit 6af3736)

**InsightCardRow** (Server Component, logic-free per T-02-07):
- Signal label from the shared `SIGNAL_LABELS` map (`@/lib/insight/labels`) — plain uppercase mono text in the severity tint (`text-status-critical` / `text-status-warn` / `text-foreground/60`), no emoji/dots/icons.
- Node identity: alias + `BackendBadge` (reused from scorecard); fleet cards show "FLEET-WIDE" + member count from `target.pubkeys.length`.
- Mono evidence line: metric, observed vs threshold with unit, window — sat-denominated values route through AFM-002 `formatSats`; display-only `toLocaleString`/`toFixed` elsewhere, no unit conversion.
- `open {tab} →` deep link rendering `card.evidence.deepLink` unmodified (T-04-28).
- State lines: SUPPRESSED reason verbatim in warn tint (D-14 fail-loud), hysteresis from `evidence.detail.hysteresis`, `rateLimitGuidance` text.
- Suggested-action block: type + flat params as mono key/value rows (sat-keyed params via `formatSats`); suppressed cards get a muted (opacity-50) WITHHELD block showing only the `withheldAction` type string — params never reach the DOM (T-04-29).

**InsightCardList**: partitions the pre-ranked array into CRITICAL/WARN/INFO sections ("CRITICAL — n" uppercase mono heads), stable filter preserves engine order within sections, empty sections render nothing, fully-empty set renders nothing (page owns the empty state).

**insight-cards.test.ts** (11 tests): one rendered card per severity shows its `SIGNAL_LABELS` entry verbatim; source-scan asserts InsightCardRow imports the shared map and no `components/insight` file defines a local label map; suppression reason verbatim + disabled area; hysteresis line; AFM-002 param formatting (1,500,000 not 1500000); fleet card identity; deep-link href verbatim; section order/counts; empty-set null render. All fixtures pass `InsightCardSchema.parse` so contract drift fails in the test, not at render.

### Task 2 — /inbox page (commit 0011671)

- `force-dynamic` + `revalidate = 0` RSC copying the pending/page.tsx skeleton; single `loadInsightView()` call (D-08 one engine, two views).
- try/catch degrade branch with the locked copy ("Couldn't load the Inbox." + warehouse-didn't-respond read-only reassurance).
- Header: "← Fleet overview" nav, display-font uppercase "Triage inbox" h1, FreshnessStamp from `view.fetchedAt` in its own slot, NarrateButton (`{level:"fleet"}`) rendered ONLY when `view.llmEnabled` (D-17).
- Empty state: "No active recommendations" + mono "fleet clear at {yyyy-mm-dd hh:mm} UTC" — absence IS the signal.
- AP-12A/B placeholder section renders `view.ap12Placeholder` as static page copy in a hairline-bordered info section, never a card (D-12).
- Severity color only via existing `text-status-*` tokens; navy only on chrome/links; no new color values.

## Verification

- `npx vitest run src/components/insight src/lib/insight` — 212 passed, 4 skipped (live golden)
- `npx tsc --noEmit` — clean
- `npx next build` — succeeds; `/inbox` registered as a dynamic route
- All plan acceptance criteria greps pass (shared labels import, zero emoji/dot markers, no "use client" in InsightCardRow, suppressed reason verbatim, force-dynamic, conditional NarrateButton, "fleet clear at" literal, placeholder-not-card)
- Threat register: no `dangerouslySetInnerHTML` anywhere in components/insight or the inbox page (T-04-27); deepLink rendered unmodified (T-04-28); suppressed params structurally absent (T-04-29)

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. The AP-12A/B placeholder copy and the suppressed "params withheld" text are intentional D-12/D-14 honesty copy, not stubs.

## Threat Flags

None — no new network endpoints, auth paths, or schema surface beyond the plan's threat model.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 6af3736 | InsightCardRow + InsightCardList + insight-cards.test.ts |
| 2 | 0011671 | /inbox RSC triage page |

## Self-Check: PASSED

All 4 created files exist on disk; commits 6af3736, 0011671, 66b3f13 present in git log; working tree clean.
