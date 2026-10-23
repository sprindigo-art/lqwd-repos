---
phase: 12-ops-center-overview
plan: 14
subsystem: overview-ui
tags: [redesign, category-icons, condensed-cards, caps, fee-rows, tree-filter, D-R2, D-R5, D-R6, D-R8, OVW-01, OVW-05]
requires:
  - "src/lib/overview/incidents.ts (12-13 deduped/attributed tree — reused)"
  - "src/lib/overview/filter.ts (12-13 tree-aware applyFilter + child narrowing — reused)"
  - "src/lib/overview/service-display.ts (serviceDisplay label — reused)"
provides:
  - "CategoryIcon.tsx: neutral lucide category glyph labeling WHAT an alert is (never a severity signal)"
  - "SeverityRow.tsx: condensed one-line child row (category icon + single label + right-pinned severity-colored status; note suppressed when == label)"
  - "SeverityCard.tsx: collapsed one-liner-by-default card with childrenFooter slot; criticals never capped, non-critical capped at top 5 + 'show N more'"
  - "QueueIsland.tsx: category rows, caps, fee raise/lower split, tree-filter narrowing + auto-expand wiring"
affects:
  - "12-15 (IA + chrome reorder) renders these condensed cards in the vitals-first layout"
tech-stack:
  added: []
  patterns:
    - "Category (what) and severity (state) are orthogonal channels: icon carries category, tint/edge-bar/status-text carry severity — no severity glyphs on rows"
    - "Collapsed-one-liner default with explicit expand; layer-filter active => auto-expand narrowed children"
key-files:
  created:
    - src/components/df/CategoryIcon.tsx
    - src/components/df/CategoryIcon.test.tsx
  modified:
    - src/components/df/Severity.ts
    - src/components/df/SeverityCard.tsx
    - src/components/df/SeverityCard.test.tsx
    - src/components/df/SeverityRow.tsx
    - src/components/df/SeverityRow.test.tsx
    - src/components/overview/QueueIsland.tsx
decisions:
  - "Severity stays state-only per D-R5 — CategoryIcon is a neutral lucide glyph for WHAT the alert is; a row's colour comes only from its severity tint/edge-bar/status text, never an icon"
  - "Criticals are never capped (D-R6); only non-critical children collapse to top 5 + 'show N more' so an emergency can never be hidden behind a cap"
  - "Child-row note suppressed when it equals the label — kills the 'Address List Sync · services · Address List Sync' echo"
  - "Fee children render as <=2 per-owner summary rows (raise up / lower down) with count N and click-through to /{pubkey}/fees; severity clamp from 12-09 keeps them non-critical"
metrics:
  duration: ~ (backfilled)
  tasks: 3
  files: 7
  completed: 2026-07-02
backfilled: "Summary written 2026-07-07 during Phase 12 close-out; code shipped in commits 2ccc026, 72e6bec, 8457eca (2026-07-02)."
---

# Phase 12 Plan 14: Card & Row Rebuild (Category Icons, Condensed Cards, Caps, Fee Rows)

> **Backfilled summary.** The code shipped 2026-07-02 across commits `2ccc026` (CategoryIcon + severityText + condensed SeverityRow), `72e6bec` (SeverityCard collapsed-one-liner default + childrenFooter slot), and `8457eca` (QueueIsland collapse state, category rows, caps, fee split, auto-expand). This summary was reconstructed from the plan objective and the committed diff during the Phase 12 verification/close-out on 2026-07-07.

Rebuilt the attention-queue card + row presentation on the corrected 12-13 tree so the queue reads as a calm, scannable, one-card-per-owner surface matching the approved redesign sketch.

## What Was Built

**Task 1 — `CategoryIcon` primitive + condensed `SeverityRow` (D-R5):**
- Added `CategoryIcon.tsx` — a neutral lucide glyph that labels WHAT each alert is (category), kept strictly separate from severity so severity remains state-only.
- Condensed each child row to a single line: category icon + one label + a right-pinned, severity-colored status. The redundant middle note is suppressed when it equals the label, killing the `Address List Sync · services · Address List Sync` echo. `Severity.ts` gained the `severityText` helper.

**Task 2 — collapsed-one-liner `SeverityCard` (D-R2/D-R6):**
- Cards default to a collapsed one-liner and expand to show children. Added a `childrenFooter` slot for per-card footer content.
- **Criticals are never capped**; non-critical children collapse to a top-5 view with a "show N more" affordance so an emergency can never be hidden behind a cap.

**Task 3 — `QueueIsland` wiring (D-R6/D-R8):**
- Wired category rows, caps, and the fee raise/lower split (≤2 per-owner summary rows with count N, click-through to `/{pubkey}/fees`, non-critical per the 12-09 clamp).
- Tree-filter narrowing + auto-expand: with a layer filter active, surviving cards show only the 12-13-narrowed children and open automatically.

## How It Was Verified

- Component unit suites (`CategoryIcon`, `SeverityCard`, `SeverityRow`) shipped alongside the code and pass under the overview suite (`vitest run src/lib/overview` + df component tests green at close-out: 103/103 overview units).
- Operator accepted the redesign scope at the Task-3 human-verify gate (per STATE 12-12 note; the redesign 12-13/14/15 was an operator-approved spec, not a defect fix).
