---
phase: 05-command-export-prong-2
plan: 04
subsystem: command-export
tags: [export, ui, client-leaf, clipboard, noc-light, inbox]
requires:
  - "src/lib/export/commands.ts — buildExportBlock(card) dispatcher (plan 05-03)"
  - "src/lib/export/block.ts — ExportBlock/ExportStep contract (plan 05-01)"
  - "src/components/ui/button.tsx — buttonVariants outline chrome (Phase 2)"
  - "src/components/insight/InsightCardRow.tsx — suggested-action box mount point (Phase 4)"
provides:
  - "src/components/export/CommandExport.tsx — the ONE client leaf (expand + per-button copy state)"
  - "InsightCardRow export mount — buildExportBlock computed server-side, leaf rendered under the suggested-action box"
affects:
  - "plan 05-05+ (console Active Signals mount) — reuses the same CommandExport leaf, second mount surface"
tech-stack:
  added: []
  patterns:
    - "Server Component builds ExportBlock strings → thin \"use client\" leaf receives plain serializable props (FleetPendingBoard/NarrateButton precedent)"
    - "buildExportBlock null-gate is the SOLE export gate — no duplicated JSX type checks (Pitfall 5; absence IS the signal)"
    - "feature-detected navigator.clipboard.writeText with locked honest failure copy + aria-live (Pitfall 6)"
    - "plain text-node containment only — no raw-HTML sink, no markdown (T-05-09)"
key-files:
  created:
    - src/components/export/CommandExport.tsx
  modified:
    - src/components/insight/InsightCardRow.tsx
decisions:
  - "blockId derived from card.id (`export-${card.id}`) for aria-controls — the schema's stable per-card id, already a string."
  - "CopyButton extracted as an inner sub-component so each COPY / COPY ALL owns independent copied/failed state with its own 1.5s revert timer (no shared state bleed between per-step and copy-all)."
  - "The leaf imports ONLY react + buttonVariants + cn + the ExportBlock type — no fetch, no server action; clipboard write is the only side effect (T-05-10, D-03 locked)."
metrics:
  duration: ~10 min
  completed: 2026-06-12
  tasks: 2
  files: 2
requirements: [EXPORT-01, PENDING-03]
---

# Phase 5 Plan 04: CommandExport Leaf + Inbox Mount Summary

The single `"use client"` CommandExport leaf — expand toggle plus per-button copy state implementing the full UI-SPEC interaction contract — and its first mount on the `/inbox` InsightCardRow, where the Server Component computes `buildExportBlock(card)` and hands plain serializable strings to the leaf (the FleetPendingBoard/NarrateButton precedent). NOC Light grammar throughout: mono uppercase text controls, no icons-for-state, no animation, navy reserved for focus rings; honest clipboard failure that is never silent.

## What Was Built

**Task 1 — CommandExport client leaf (commit 96f8f2e)**
- `src/components/export/CommandExport.tsx` — `"use client"`, named export, props `{ block: ExportBlock; blockId: string }`. Header comment marks it presentational-only: owns nothing but `open` + per-button copy state, no card knowledge, no write path beyond clipboard.
- Toggle button: `export commands` / `hide commands` (uppercase via CSS), the `ExportButton` outline chrome (`buttonVariants({ variant: "outline", size: "sm" })` + `font-mono text-xs font-semibold tracking-[0.14em] uppercase`), `aria-expanded` + `aria-controls={blockId}`, instant expand (`{open && …}`, no animation).
- Expanded block (`mt-2`): (1) contextLines as key/value rows (`gap-3`, key `text-foreground/45`, value `tabular-nums text-foreground/60`); (2) safetyLines with `safety:` prefix in `text-status-warn` semibold + body `text-foreground/60`; (3) per step a header row (mono semibold `tracking-[0.14em]` uppercase label + a COPY button `ms-auto` rendered only when `step.command` non-null) above a `<pre className="rounded-[3px] border border-border bg-muted/40 px-3 py-2 font-mono text-xs leading-5 overflow-x-auto whitespace-pre">`; when `command` is null the step's `note` renders as mono semibold uppercase `tracking-[0.06em]` honest-state text instead of the `<pre>`; (4) footer `COPY ALL` right-aligned, rendered only when `copyAll` non-null.
- `CopyButton` sub-component encapsulates the verbatim copy handler from the interfaces section: feature-detect `navigator.clipboard`, swap the label to `COPIED` (ok tint) / `COPY FAILED` (warn tint) in place, revert after ~1.5s via `setTimeout`, render the locked helper line `copy failed — select the text manually` on failure, announce via `aria-live="polite"`. Per-step COPY copies `step.command` ONLY; COPY ALL copies `block.copyAll`.
- Plain-text containment: every block field renders as a text node — no raw-HTML sink, no markdown. No lucide imports, no new tokens, no navy fills, no toast.

**Task 2 — Inbox mount: InsightCardRow export gate + block computation (commit dc72dbb)**
- `InsightCardRow.tsx` stays a Server Component (no `"use client"`). Added imports of `buildExportBlock` (`@/lib/export/commands`) and `CommandExport` (`@/components/export/CommandExport`).
- Computes `const exportBlock = card.suggestedAction !== null ? buildExportBlock(card) : null;` once at the top of the component, and renders `<CommandExport block={exportBlock} blockId={`export-${card.id}`} />` at the bottom edge of the existing suggested-action box when non-null.
- The gate lives entirely in `buildExportBlock` (returns null for update_fee / investigate / suppressed / fleet / structural-fail) — no duplicated type checks in JSX beyond the null check; absence IS the signal (no placeholder, no disabled button). Withheld-action rendering for suppressed cards (null suggestedAction) is untouched and never reaches this branch.
- Updated the file header to document the Phase 5 export mount and the close_channel/rebalance/remediate_pending-only surface via the buildExportBlock gate (Pitfall 5), and that the leaf receives plain ExportBlock strings, never the card (T-05-03).

## Verification Results

- `npx tsc --noEmit` → clean (after both tasks).
- `npm test` (full vitest suite) → 572 passed | 20 skipped, 0 failures. The existing `insight-cards.test.ts` renders `InsightCardRow` via `renderToStaticMarkup` under the node environment; `buildExportBlock(card)` now runs during those renders and returns blocks/null without throwing — no regression.
- `grep -c "lucide-react" CommandExport.tsx` → 0.
- `grep -c "dangerouslySetInnerHTML" CommandExport.tsx` → 0.
- Required strings present in CommandExport.tsx: `aria-expanded`, `aria-controls`, `aria-live="polite"`, `navigator.clipboard.writeText`, `copy failed — select the text manually`, `export commands`, `hide commands`.
- `grep -rl '"use client"' src/components/export/` → exactly one file (CommandExport.tsx).
- No `fetch(` / `use server` / `"POST"` in CommandExport.tsx (no write path — clipboard is the only side effect).
- `InsightCardRow.tsx` contains `buildExportBlock(card)` and `<CommandExport`; `grep -c '"use client"'` → 0 (stays a Server Component).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Comment text tripped the dangerouslySetInnerHTML grep guard**
- **Found during:** Task 1 verification.
- **Issue:** the containment comments literally spelled out the token `dangerouslySetInnerHTML` ("no dangerouslySetInnerHTML, no markdown"), so the acceptance grep `grep -c "dangerouslySetInnerHTML"` returned 1 instead of the required 0 — even though the API is never used.
- **Fix:** reworded the two comments to "no raw-HTML injection sink, no markdown rendering" / "no raw-HTML sink", preserving the intent while making the guard read 0. No code behavior changed.
- **Files modified:** src/components/export/CommandExport.tsx. **Commit:** 96f8f2e.

No other deviations — both tasks executed as written.

## Threat Model Coverage

- **T-05-03** (Info disclosure, suppressed params in DOM) — mitigated: `buildExportBlock` null-gates upstream (plan 05-03); InsightCardRow passes only the post-gate `ExportBlock` strings to the leaf, never the card. Suppressed cards arrive with null `suggestedAction` and never reach the export branch.
- **T-05-09** (Tampering, DOM injection via block strings) — mitigated: all block content renders as plain text nodes; no `dangerouslySetInnerHTML`, no markdown. Acceptance grep enforces 0.
- **T-05-10** (EoP, leaf gaining a write path) — mitigated: the leaf imports only react + buttonVariants + cn + the ExportBlock type; no fetch, no server action; clipboard write is the only side effect; D-03 locked — no auto-run affordance.
- **T-05-11** (Repudiation, silent clipboard failure) — mitigated: feature-detect + locked `copy failed — select the text manually` copy + `COPY FAILED` label + `aria-live="polite"` announcement (Pitfall 6). Never silent.

No new threat surface introduced — the leaf adds no endpoint, no fetch, no schema change; the only new browser capability is `navigator.clipboard.writeText` (feature-detected, write-only to the user's own clipboard).

## Known Stubs

None. The honest-state renders (null-command steps showing the note as inert text, the locked clipboard-failure copy) are intentional UI-SPEC-locked states fed by buildExportBlock / clipboard outcome, not placeholder data. The second mount surface (console Active Signals) is explicitly a later plan (05-05+) per the PATTERNS map, not a stub of this plan.

## Self-Check: PASSED

- FOUND: src/components/export/CommandExport.tsx (starts with `"use client"`, props `{ block: ExportBlock; blockId: string }`, contains `navigator.clipboard.writeText` + the locked failure copy)
- FOUND: src/components/insight/InsightCardRow.tsx (contains `buildExportBlock(card)` + `<CommandExport`, no `"use client"`)
- FOUND commit: 96f8f2e (Task 1 — CommandExport client leaf)
- FOUND commit: dc72dbb (Task 2 — InsightCardRow mount)
