---
phase: 07-inbox-triage-rebuild
plan: 04
subsystem: insight-inbox-ui
tags: [inbox, triage, detail-drawer, bulk-enqueue, url-sync, sheet, sketch-005-winner-e]
requires:
  - "src/components/insight/InboxTriage.tsx (07-03): stable prop seam (activeCardId, cardViewModels, batchEligibleIds, rail, children)"
  - "src/app/(overview)/inbox/page.tsx (07-03): force-dynamic server shell mounting the island + resolving enqueue props"
  - "src/components/ui/sheet.tsx (07-01): vendored radix Sheet, side='right', tw-animate-css slide"
  - "src/app/actions/queue.ts (07-02): enqueueBatch(inputs: EnqueueInput[]) -> { results, queued, skipped }"
  - "src/lib/insight/triage.ts (07-01): seriesKindFor(card)"
  - "src/components/queue/EnqueuePreview.tsx / export/CommandExport.tsx / console/Sparkline.tsx: verbatim leaves"
  - "src/lib/console/trends.ts: forwardsDailySeries / closesDailySeries"
provides:
  - "src/components/insight/DetailDrawer.tsx: URL-synced (?card) Sheet drawer — evidence <dl> + sparkline + verbatim action leaf"
  - "src/components/insight/BatchConfirmDialog.tsx: aggregate-scope confirm + enqueueBatch + verbatim per-row tally"
  - "src/components/insight/InboxTriage.tsx: the single interaction island — rail toggle, multi-select Set, ENQUEUE ALL, drawer/dialog host"
  - "src/app/(overview)/inbox/page.tsx: full view-model + batch-row build + opened-card series fetch"
affects:
  - "CardViewModel contract extended additively (signalLabel, nodeLabel, severity, evidence, exportBlock, runbookNote)"
tech-stack:
  added: []
  patterns:
    - "URL-as-source-of-truth drawer: open = ?card present; close = router.replace stripping ?card (reload/back-safe)"
    - "Event-delegation over server-rendered data-* slots: the client island owns selection state without re-rendering server children"
    - "Opened-card-only series fetch (no Promise.all fan-out) gated by seriesKindFor; .catch(()=>null) honest fallback"
key-files:
  created:
    - "src/components/insight/DetailDrawer.tsx"
    - "src/components/insight/BatchConfirmDialog.tsx"
  modified:
    - "src/components/insight/InboxTriage.tsx"
    - "src/app/(overview)/inbox/page.tsx"
decisions:
  - "CardViewModel was EXTENDED additively (not rewritten) to carry the drawer's full hydration surface (signalLabel/nodeLabel/severity/evidence/exportBlock/runbookNote) — the 07-03 stable seam (activeCardId/cardViewModels/batchEligibleIds/rail/children) is preserved; a new batchRows + activeSeries pair was added alongside."
  - "Multi-select + ENQUEUE ALL are wired by click-delegation on the server-rendered children container, reading the 07-03 data-select-card / data-enqueue-card-ids slots — the island never re-renders the server presentation, honoring the server-computes/thin-client-leaf law."
  - "The drawer action leaf switches: enqueueProps (LND update_fee) -> EnqueuePreview; else exportBlock (close/rebalance/remediate) -> CommandExport; else a verbatim runbook/investigate note. No new action component; no signer/engine import."
  - "Series fetch is opened-card-only (Pitfall 5): seriesKindFor maps the card's signal; forwards-fees remaps feesSat into the polyline n channel (console precedent); closes uses closesDailySeries(30); all guarded .catch(()=>null)."
metrics:
  duration: ~25 min
  completed: 2026-06-17
---

# Phase 7 Plan 04: Inbox Detail Drawer + Bulk Enqueue Summary

The `/inbox` triage cockpit becomes interactive: a URL-synced `Sheet` detail/act drawer that opens off `?card` (deep-linkable, back-button-closable, reload-safe), renders the card's full evidence as a mono tabular-nums `<dl>`, draws the 14-day trend sparkline with an honest "no trend data" fallback, and acts in place by embedding the verbatim existing action leaf (`EnqueuePreview` for LND update_fee, `CommandExport` for close/rebalance/remediate, or a runbook note) — INBOX-03; plus the bulk path where per-node `ENQUEUE ALL` and cross-node multi-select drive one aggregate-scope confirm dialog that fires `enqueueBatch` and renders the verbatim per-row tally grouped by node — INBOX-04; all under the single `InboxTriage` client island, which also toggles the facet rail off for a full-width view.

## What Was Built

**Task 1 — DetailDrawer (URL-synced Sheet) + InboxTriage drawer/select host (commit d3f1a5c):**
- `DetailDrawer.tsx` — `"use client"`. Open state = `activeCardId !== null && card !== null` (the page whitelist-validates `?card`); `onOpenChange(false)` → `router.replace` stripping `?card` while preserving facets (reload-safe, back-button-safe). Uses the vendored `Sheet` (`side="right"`, tw-animate-css `slide-in-from-right` — NOT tailwindcss-animate), NOT `Dialog`. Header = signal label + node·severity (severity tint = state color only). Evidence `<dl>`: metric, observed vs threshold (with unit), window, freshness — every value via AFM-002 `formatSats` / `toLocaleString`, mono tabular-nums right-aligned. `.spark` renders `<Sparkline points={series} />` only when `series.length >= 2`, else a literal "no trend data" text node. `.dact` switches on the view-model: `enqueueProps` → `<EnqueuePreview {...} />`, else `exportBlock` → `<CommandExport block blockId />`, else the `runbookNote`. Never imports the signer/engine.
- `InboxTriage.tsx` — extended the 07-03 island in place. `CardViewModel` gained `signalLabel`, `nodeLabel`, `severity`, `evidence`, `exportBlock`, `runbookNote` (additive). New props `batchRows` (id → `BatchRow`) and `activeSeries` were added alongside the stable seam. The island hosts `DetailDrawer` (off `activeCardId`/`cardViewModels`) and `BatchConfirmDialog`, owns the rail on/off `.syn.railoff` swap, the multi-select `Set<cardId>`, and `dialogIds` (which rows the confirm targets). Selection + ENQUEUE ALL are handled by click-delegation on the server-rendered children container, reading the 07-03 `data-select-card` and `data-enqueue-card-ids` slots; a selection action bar surfaces "N selected → enqueue selected ▸". The eligible set is `batchEligibleIds` (server-resolved LND update_fee); suppressed/LDK/non-fee ids are structurally absent.

**Task 2 — BatchConfirmDialog (commit 106fb9b):**
- `BatchConfirmDialog.tsx` — `"use client"`. Receives `BatchRow[]` (`{pubkey, params}` + `nodeLabel` + `rateLimitGuidance`). States the aggregate scope BEFORE firing (D-06): "N intents → M nodes · ppm range X–Y · all engine-suggested · expires +24h", every numeric via `toLocaleString` (no inline math). Rate-limit guidance surfaces as de-duped advisory text (D-08 — still enqueue all). NO editable `<input>` (engine values only, Pitfall 4). On confirm: disables the button (`submitting` single in-flight, T-07-15), calls `enqueueBatch(rows)` with `{pubkey, params}[]` ONLY (the client never sends an HMAC — CLAUDE.md §5), then renders the `{ results, queued, skipped }` tally inline grouped by node, each skip's `error` verbatim as a text node (V5).

**Task 3 — inbox/page.tsx wiring (commit 272c56c):**
- `viewModelFor` rebuilt to populate the full `CardViewModel` (label via `SIGNAL_LABELS`, node label, severity, structured evidence, `buildExportBlock(card)` for the export leaf, and an honest `runbookNote` for LDK/investigate/no-action).
- `batchRowFor` builds a `BatchRow` per LND update_fee card (engine `params` verbatim + node label + `rateLimitGuidance`).
- Trend series fetched for the OPENED `?card` card ONLY via `seriesForActiveCard` — `seriesKindFor` maps the signal; `forwards-fees` remaps `feesSat` into the polyline `n` channel (console `[tab]/page.tsx` precedent), `closes` uses `closesDailySeries(30)`, all guarded `.catch(() => null)`. No `Promise.all` series fan-out.
- Passes `batchRows` + `activeSeries` into `<InboxTriage>`. `@modal/inbox/page.tsx` untouched (D-11).

## Verification

- `npx tsc --noEmit` — clean across the whole project (0 errors).
- `npm test` — 668 passed / 20 skipped (61 files); the known Phase-6 `stub-executor.test.ts` flake did not collide this run.
- `npx next build` — compiles successfully; `/inbox` is `ƒ` (dynamic, server-rendered on demand), confirming the `force-dynamic` server-children-into-client-island RSC boundary is valid.
- `eslint` — clean (0 warnings, 0 errors) on all four touched files after removing an unused import.
- Per-task greps all green: DetailDrawer has `"use client"` + `useSearchParams` + `EnqueuePreview|CommandExport` + `Sparkline`, no signer/engine import; BatchConfirmDialog has `enqueueBatch`, no `<input>`, no `signature`/`canonicalPayload`; InboxTriage has no signer/enqueue/enqueue-props import; page has `forwardsDailySeries|closesDailySeries` and NO `Promise.all`.
- Containment battery: no `dangerouslySetInnerHTML` in any island; drawer imports `ui/sheet` and not `ui/dialog`.

## Threat Model Compliance

| Threat ID | Disposition | Status |
|-----------|-------------|--------|
| T-07-12 (client signature / mutated bulk params) | mitigate | Bulk sends `{pubkey, params}[]` from each card's `suggestedAction.params` verbatim; no editable input (D-06); `enqueueBatch` re-validates + signs server-side. |
| T-07-13 (suppressed/LDK/non-fee in the bulk set) | mitigate | Selectable universe = `batchEligibleIds` (server-resolved `kind === "lnd"`); `batchRowFor` returns null for non-update_fee/no-node; delegation re-checks `eligible.has(id)`. |
| T-07-14 (XSS via tally/runbook/evidence) | mitigate | All rendered as React text nodes; no `dangerouslySetInnerHTML` in any island. |
| T-07-15 (double-clicked confirm) | mitigate | Confirm disabled on `submitting` (single in-flight). |
| T-07-16 (client importing server-only signer/engine) | mitigate | Islands receive serializable props only; grep-gated — no `@/lib/queue/sign`/`enqueue`/`enqueue-props` or `@/lib/insight/engine` import in any of the three islands. |

## Deviations from Plan

None — plan executed as written. The plan explicitly directed EXTENDING the 07-03 `InboxTriage` prop seam rather than rewriting it; `CardViewModel` was extended additively and two new props (`batchRows`, `activeSeries`) were added alongside the stable seam, exactly as the dependency context required.

## Known Stubs

None. Every interaction is wired: the drawer opens off `?card` and acts inline via the verbatim leaves; multi-select and per-node ENQUEUE ALL both drive the aggregate confirm → `enqueueBatch` → verbatim tally; the rail toggles to full-width. The opened-card sparkline falls through to the honest "no trend data" label for latest-state dimensions and fleet-target cards (where `seriesKindFor` returns null by design).

## Notes for 07-05 (operator visual gate)

- Manual checks to run: select a spine card → drawer opens with evidence + sparkline/fallback + inline act; reload the `?card` URL and press back; per-node ENQUEUE ALL and cross-node multi-select → confirm scope → rows land on `/queue`; a missing-secret node shows a verbatim skip while good rows still queue; the rail `◧/▸ filters` toggle collapses to full-width.
- Selection visual feedback on the server-rendered checkbox slots is applied via `data-state`/`aria-checked` on the slot element (the island can't re-render server children); the action bar "N selected" is the primary affordance.

## Self-Check: PASSED

All 4 created/modified files exist on disk; all 3 task commits (106fb9b, d3f1a5c, 272c56c) present in git history.
