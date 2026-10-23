---
phase: 05-command-export-prong-2
plan: 05
subsystem: command-export
tags: [export, ui, console, active-signals, second-mount, noc-light]
requires:
  - "src/components/export/CommandExport.tsx — the ONE client leaf (plan 05-04)"
  - "src/lib/export/commands.ts — buildExportBlock(card) dispatcher (plan 05-03)"
  - "src/lib/export/block.ts — ExportBlock contract (plan 05-01)"
  - "src/components/console/ActiveSignalsPanel.tsx — verbatim SignalRow renderer (Phase 2/4)"
  - "src/app/(overview)/[pubkey]/[tab]/page.tsx — buildInsightSignals computation (Phase 4)"
provides:
  - "SignalRow.exportBlock optional field — pre-built ExportBlock threaded from the page"
  - "ActiveSignalsPanel insight-row CommandExport mount — the SECOND export surface (D-01 one component, both surfaces)"
  - "buildInsightSignals exportBlock: buildExportBlock(card) ?? undefined — the per-node export computation path"
affects:
  - "Phase 5 export prong complete — inbox (05-04) + per-node console (05-05) now share one leaf + one computation"
tech-stack:
  added: []
  patterns:
    - "Second mount of the same client leaf: page (Server Component) computes ExportBlock strings, panel renders verbatim — never threads the card (T-05-03 / Pitfall 7)"
    - "Optional SignalRow field gated by buildExportBlock null semantics (?? undefined) — non-exportable rows render nothing, no placeholder"
    - "Panel stays a Server Component + dumb renderer (T-02-07): zero health/gate logic, the caller owns all computation"
key-files:
  created: []
  modified:
    - src/components/console/ActiveSignalsPanel.tsx
    - src/app/(overview)/[pubkey]/[tab]/page.tsx
decisions:
  - "blockId derived as `export-signal-${i}` from the signals.map index — unique per row within the panel (matches the plan's interface note; the index is stable for a single render pass and the panel renders one SignalRow[] at a time)."
  - "exportBlock typed as optional (not nullable) on SignalRow — buildInsightSignals normalizes buildExportBlock's null to undefined at the boundary (?? undefined), so the panel's `{signal.exportBlock && …}` truthy guard is the only check; absence IS the signal (no disabled control)."
  - "CommandExport imported as a value (client leaf) and ExportBlock as a type-only import — keeps the panel's module surface minimal and the Server/client boundary explicit."
metrics:
  duration: ~6 min
  completed: 2026-06-12
  tasks: 2
  files: 2
requirements: [EXPORT-01, PENDING-03]
---

# Phase 5 Plan 05: Console Active Signals Export Mount Summary

The second export mount (RESEARCH Pattern 3): the per-node console's Active Signals panel now renders the SAME `CommandExport` leaf as `/inbox` on exportable insight rows. The page's `buildInsightSignals()` pre-builds the `ExportBlock` (strings only, after the null/type gate) and threads it through a new optional `SignalRow.exportBlock` field; `ActiveSignalsPanel` stays a Server Component and a verbatim renderer (T-02-07), mounting the leaf only when a row carries a block. This closes D-01's "one component, one computation path, both surfaces" with a minimal DOM surface — the console never receives the card object.

## What Was Built

**Task 1 — SignalRow.exportBlock + console panel mount (commit 825bead)**
- `ActiveSignalsPanel.tsx` stays a Server Component (no `"use client"`). Added a type-only `import type { ExportBlock } from "@/lib/export/block"` and a value `import { CommandExport } from "@/components/export/CommandExport"`.
- Extended the `SignalRow` interface with `exportBlock?: ExportBlock` carrying the same doc-comment voice as the existing optional fields ("Insight rows only — pre-built export block (Phase 5); strings only, never the card.").
- In the insight-row branch, after the existing `stateLine` paragraph, renders `{signal.exportBlock && <CommandExport block={signal.exportBlock} blockId={`export-signal-${i}`} />}` — the `i` is the `signals.map` index, unique per row within the panel. No health/gate logic added: the row is pre-computed by the caller; absence of `exportBlock` renders nothing.

**Task 2 — Console page threading (commit b6fb4b1)**
- `page.tsx` imports `buildExportBlock` from `@/lib/export/commands` (alphabetically placed in the import block).
- Inside `buildInsightSignals(cards, pubkey)`'s existing `.map((card) => …)` return object, added `exportBlock: buildExportBlock(card) ?? undefined`. The `?? undefined` normalizes the builder's `null` (non-exportable: update_fee / investigate / suppressed / fleet / structural-fail) to `undefined` at the boundary so the panel's truthy guard is the sole check.
- No other changes — the per-pubkey filter, label/detail/stateLine assembly, the deep-link tab-segment parse, and the `.catch(() => null)` insight-view degradation are untouched. No new reads, no new error handling, no route/validation changes.

## Verification Results

- `npx tsc --noEmit` → clean (after both tasks).
- `npm test` (full vitest suite) → 572 passed | 20 skipped, 0 failures, both after Task 1 and after Task 2. No regression.
- `grep -c '"use client"' src/components/console/ActiveSignalsPanel.tsx` → 0 (panel stays a Server Component).
- `grep -c 'buildExportBlock' src/components/console/ActiveSignalsPanel.tsx` → 0 (the panel never computes — the caller does).
- `grep -c '<CommandExport' src/components/console/ActiveSignalsPanel.tsx` → 1.
- `grep -c '"use client"' src/app/(overview)/[pubkey]/[tab]/page.tsx` → 0 (page stays a Server Component).
- `git diff` on page.tsx touches ONLY the import block and the `buildInsightSignals` map return — no route, no validation, no read-layer change.

## Deviations from Plan

None — both tasks executed exactly as written. No bugs, missing functionality, or blocking issues encountered; the buildExportBlock gate and CommandExport leaf were already complete (plans 05-03 / 05-04), so this plan was pure threading.

## Threat Model Coverage

- **T-05-03** (Information disclosure — suppressed params in console DOM) — mitigated: `buildInsightSignals` calls `buildExportBlock(card)` which null-gates and validates upstream (plan 05-03), then threads only the post-gate `ExportBlock` strings into `SignalRow.exportBlock`. The card object never crosses into the panel; the panel receives strings only (RESEARCH Pitfall 7). The acceptance grep proves the panel never computes (`buildExportBlock` count = 0 in the panel).
- **T-05-10** (Elevation of privilege — console gaining a write surface) — mitigated: zero new reads/writes. The page change is one mapped field; the panel change adds one truthy-guarded leaf mount. The mounted leaf (CommandExport, plan 05-04) has no fetch / no server action — clipboard write is its only side effect. The panel stays a verbatim renderer.

No new threat surface introduced — no endpoint, no fetch, no schema change. The only new browser capability reaching the console is the leaf's already-vetted `navigator.clipboard.writeText` (feature-detected, plan 05-04).

## Known Stubs

None. Non-exportable insight rows correctly carry `exportBlock: undefined` and render no export control — this is the locked "absence IS the signal" behavior (no placeholder, no disabled button), not a stub. The honest-state command renders inside the leaf are fed by `buildExportBlock`, not placeholder data.

## Self-Check: PASSED

- FOUND: src/components/console/ActiveSignalsPanel.tsx (contains `exportBlock?: ExportBlock` and `<CommandExport`; no `"use client"`; no `buildExportBlock`)
- FOUND: src/app/(overview)/[pubkey]/[tab]/page.tsx (contains `buildExportBlock(card) ?? undefined`; no `"use client"`)
- FOUND commit: 825bead (Task 1 — SignalRow.exportBlock + console panel mount)
- FOUND commit: b6fb4b1 (Task 2 — console page buildExportBlock threading)
