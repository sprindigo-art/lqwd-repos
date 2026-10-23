---
phase: 07-inbox-triage-rebuild
plan: 03
subsystem: insight-inbox-ui
tags: [inbox, triage, severity-spine, facet-rail, rsc, sketch-005-winner-e]
requires:
  - "src/lib/insight/triage.ts (07-01): partitionTriage, facetCounts, applyFacets"
  - "src/lib/insight/triage-facets.ts (07-01): parseFacets, serializeFacets, FacetState"
  - "src/lib/insight/engine.ts: loadInsightView (force-dynamic data path)"
  - "src/lib/queue/enqueue-props.ts: resolveEnqueueAffordance (server-only gate)"
provides:
  - "src/app/(overview)/inbox/page.tsx: triage spine server shell (partition + facets + counts + island mount)"
  - "src/components/insight/SeveritySpine.tsx: critical+warn drawer-trigger rows"
  - "src/components/insight/InfoGroups.tsx: native <details> signal->node folds + enqueue/checkbox slots"
  - "src/components/insight/SuppressedBlock.tsx: always-visible suppressed block (verbatim reason)"
  - "src/components/insight/FacetRail.tsx: .syn-grid rail, live counts, URL-link filters (strip ?card)"
  - "src/components/insight/InboxTriage.tsx: client island stub (stable 07-04 prop seam)"
affects:
  - "src/app/globals.css: inbox triage CSS grammar (.sectionbar/.fold/.syn/.facet)"
tech-stack:
  added: []
  patterns:
    - "Server-computes / thin-client-leaf split: 4 server presentation components + 1 client interaction island"
    - "URL-as-source-of-truth facets (D-09); native <details> zero-JS folds (D-02)"
    - "OQ-1 settled: facet links strip ?card by construction (serializeFacets only)"
key-files:
  created:
    - "src/components/insight/SeveritySpine.tsx"
    - "src/components/insight/InfoGroups.tsx"
    - "src/components/insight/SuppressedBlock.tsx"
    - "src/components/insight/FacetRail.tsx"
    - "src/components/insight/InboxTriage.tsx"
  modified:
    - "src/app/(overview)/inbox/page.tsx"
    - "src/app/globals.css"
decisions:
  - "InboxTriage shipped as a minimal client island (rail-toggle + selection shell) exposing the STABLE prop seam (activeCardId, cardViewModels, batchEligibleIds, rail, children) that 07-04 builds the DetailDrawer/BatchConfirm against — page compiles now, no stub thrown away later."
  - "Facet links are built from serializeFacets(nextFacetState) ONLY and never carry ?card (OQ-1 settled); the drawer opens solely off ?card, so a facet change closes the drawer by construction."
  - "Inbox CSS grammar (.sectionbar/.fold/.syn/.facet) bound to the repo's real @theme tokens (the sketch draft used shorthand names that don't exist here) — severity=state-only, navy=structure/act-only."
  - "A warn overflow tail (>8 rows) folds into a native <details>; a critical is NEVER folded (D-04/Pitfall 6)."
metrics:
  duration: ~20 min
  completed: 2026-06-17
---

# Phase 7 Plan 03: Inbox Triage Spine + Facet Rail Summary

The `/inbox` surface is rebuilt from a flat severity-sectioned card list into the sketch-005 winner-E triage spine: a `force-dynamic` server page that calls `loadInsightView()` once, partitions the pre-ranked cards into a critical+warn severity spine + collapsed per-signal→per-node info folds + an always-visible suppressed block, computes facet counts over the unfiltered set, applies URL-param facets to narrow the visible set, and renders four server presentation components plus a collapsible `FacetRail` under one `InboxTriage` client island — no card is ever dropped and the page never renders a flat 531-row list.

## What Was Built

**Task 1 — three server presentation components (commit d94bc5e):**
- `SeveritySpine.tsx` — renders the `partitionTriage` `spine` (critical + warn, non-suppressed) as individual `.sectionbar`-headed rows reusing `InsightCardRow`'s identity/evidence grammar. Each row is a `<Link>` that sets `?card={id}` while preserving the active facets (drawer trigger for 07-04). A critical is never folded; a `warn` overflow tail (>8) collapses into a native `<details>`.
- `InfoGroups.tsx` — renders the two-level native-`<details>` nest (per-signal → per-node), all collapsed on load, counts mono tabular-nums right-aligned. Per-node headers carry an `ENQUEUE ALL` slot and per-row a checkbox slot with `data-*` hooks; the actual interactive trigger + selection `Set` live in the 07-04 island. Selectable rows are gated by the server-resolved `resolveEnqueueAffordance` (LND update_fee only).
- `SuppressedBlock.tsx` — a distinct, always-visible (never folded) block; `card.suppressed.reason` renders verbatim in the warn tint as a React text node; the disabled `withheld — {type}` area shows the withheld action type only, never params, with no enqueue affordance.
- `globals.css` — the inbox triage CSS grammar (`.sectionbar.crit/.warn/.info/.suppressed`, `.fold` native-details marker rotation, `.syn`/`.syn.railoff` grid swap, `.facet`/`.facet.on`) bound to the repo's real `@theme` tokens.

**Task 2 — FacetRail server component (commit f307e89):**
- `FacetRail.tsx` — `.facetgroup` blocks for severity / node / signal / action, each a `<Link>` that toggles that facet value in the query string via `serializeFacets`. Counts come from `facetCounts(view.cards)` over the unfiltered set, so they never drift when a facet is active. The active facet highlights in navy (`.facet.on`). CSS-grid rail (`.railpane`), not a shadcn sidebar. Every href is `serializeFacets(next)` only and never carries `?card` (OQ-1 settled contract — a facet change closes the drawer by construction).

**Task 3 — inbox/page.tsx rewrite + island (commit b7e8b46):**
- Preserved verbatim: `force-dynamic`, `revalidate = 0`, `metadata`, the masthead nav + header (display title + `FreshnessStamp` + conditional `NarrateButton`), the try/catch honest read-only error state, the honest empty state, the AP-12 page-copy section.
- Added: async `searchParams` → `URLSearchParams` → `parseFacets`; `facetCounts(view.cards)` (unfiltered); `applyFacets` + re-`partitionTriage` of the visible set; a per-card `resolveEnqueueAffordance` map → serializable `cardViewModels` + the `InfoGroups` affordance map + the batch-eligible id set; `?card` whitelist-validated against the live card-id set (unknown → no drawer).
- Renders `FacetRail` (rail) + `SeveritySpine` + `InfoGroups` + `SuppressedBlock` under the `InboxTriage` client island. Flat `InsightCardList` removed; no `@modal/inbox` present to touch.
- `InboxTriage.tsx` — minimal client island owning interaction state (rail on/off `.syn.railoff` swap, multi-select `Set` shell) and exposing the stable typed prop seam (`activeCardId`, `cardViewModels`, `batchEligibleIds`, `rail`, `children`) that 07-04's DetailDrawer / BatchConfirmDialog build against.

## Verification

- `npx tsc --noEmit` — clean across the whole project (0 errors).
- `npm test` — 668 passed / 20 skipped (61 files); the 07-01 triage tests still green against the new consumers.
- `npx next build` — compiles successfully; `/inbox` is `ƒ` (dynamic, server-rendered on demand), confirming `force-dynamic` is honored and the server-children-into-client-island RSC boundary is valid.
- Per-task greps: no `"use client"` in the four server components; `InfoGroups` uses native `<details>`; the page has no flat `InsightCardList`; `FacetRail` passes the OQ-1 strip grep (`! grep -Eq '[?&]card=|set("card"|"card",'`) — the only `card` text hits are doc comments and the `bg-card` class, no code constructs a `?card` param.
- `eslint` — clean on all six touched files.

## Threat Model Compliance

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-07-08 (tampered `?card`/facet params) | mitigate | `parseFacets` whitelists facets (07-01); `?card` validated against the live card-id set before the island receives it — unknown degrades to no-drawer. |
| T-07-09 (XSS via suppression reason/evidence) | mitigate | All rendered as React text nodes; no `dangerouslySetInnerHTML` in any new component. |
| T-07-10 (suppressed card showing enqueue) | mitigate | `SuppressedBlock` renders the disabled `withheld` area only — no enqueue slot; `suggestedAction === null` structurally excludes it. |
| T-07-11 (facet counts leaking post-filter) | mitigate | `facetCounts(view.cards)` computed over the unfiltered set, independent of active facets. |

## Deviations from Plan

None — plan executed as written. The plan explicitly permitted shipping a minimal `InboxTriage` that compiles now and is extended (not replaced wholesale) in 07-04; that is what was built, with a stable typed prop seam rather than a throwaway stub.

## Known Stubs

- `InboxTriage.tsx` is an intentional partial: it owns the rail-toggle and a multi-select `Set` shell but does NOT yet mount the `DetailDrawer` (reads `?card`), the `BatchConfirmDialog`, or wire the multi-select checkboxes / `ENQUEUE ALL` triggers. This is by design — those interactions are 07-04's scope (the next plan in this wave). The page is fully functional at the server-render + facet-navigation level now; the prop seam (`activeCardId`, `cardViewModels`, `batchEligibleIds`) is the stable contract 07-04 consumes. The unused-now props are referenced via `void` so the seam is type-checked and not tree-shaken before 07-04.

## Notes for 07-04

- The drawer opens solely off `?card`; `activeCardId` (already whitelist-validated) and `cardViewModels[activeCardId]` are the hydration inputs — never import the server-only engine on the client.
- `data-select-card` / `data-select-node` mark selectable rows in `InfoGroups`; `data-enqueue-node` / `data-enqueue-card-ids` mark the per-node `ENQUEUE ALL` slots. Bind the selection `Set` and the `enqueueBatch` call (07-02) to these.
- `batchEligibleIds` is the structurally-LND-update_fee selectable universe; suppressed/LDK/non-fee rows are already excluded server-side.

## Self-Check: PASSED

All 7 created/modified files exist on disk; all 3 task commits (d94bc5e, f307e89, b7e8b46) present in git history.
