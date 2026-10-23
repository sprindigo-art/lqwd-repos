---
phase: 13-nodes-service-health
plan: 16
subsystem: node-detail-ui
tags: [ui, layout, table, stat-strip, gap-closure]
requires:
  - src/components/ui/table.tsx
  - src/components/node/NodeChannelsTable.tsx
  - src/components/console/SummaryStrip.tsx
provides:
  - "channels sub-route table that fills its ~1116px container (scroll only on true overflow)"
  - "SummaryStrip whose column count matches its cell count (no dead trailing cell)"
affects:
  - src/components/node/NodeForwardsTable.tsx
tech-stack:
  added: []
  patterns:
    - "literal-class lookup keyed by cells.length for safelist-safe dynamic Tailwind grid columns"
    - "per-cell whitespace-normal override on soft table columns to let wide tables compress"
key-files:
  created: []
  modified:
    - src/components/node/NodeChannelsTable.tsx
    - src/components/console/SummaryStrip.tsx
decisions:
  - "Fixed G5 at the overflowing table (soft-column wrapping) rather than removing whitespace-nowrap globally — mono numeric columns must stay nowrap for alignment."
  - "table.tsx needed no edit — it already carries w-full on both container and table plus overflow-x-auto (the genuine-overflow fallback)."
metrics:
  duration: ~10m
  completed: 2026-07-10
---

# Phase 13 Plan 16: Node-Detail Gap Closure Round 2 (G5 table full-width + G6 stat-strip fill) Summary

Two presentational layout defects on the routed Node-Detail surfaces closed: the 8-column channels sub-route table now compresses to fit its container (no spurious horizontal scrollbar), and the shared SummaryStrip derives its grid-column count from its cell count so a 4-cell forwards strip no longer leaves an empty trailing gray cell.

## What Was Built

### Task 1 — G5: tables fill width, scroll only on true overflow
`NodeChannelsTable` was the sole true-overflow contributor: every `TableCell`/`TableHead` inherits `whitespace-nowrap` from the shared primitive, forcing the 8-column table wider than the ~1116px node-detail column even when data could wrap. Fixed by adding `whitespace-normal break-words` to the four SOFT wide columns only — Peer, Local/remote, Fee policy, Baseline — leaving the mono numeric columns (Channel, Capacity) and the Fee-queue action cell on inherited nowrap for alignment. Also reduced the `LiquidityBar` bar width from `w-24` to `w-16` to reclaim horizontal space in the Local/remote column.

The shared `Table` primitive was intentionally left untouched: it already carries `w-full` on both the container div and the `<table>` (so the few-column peers/forwards tables already stretch to 100%) and `overflow-x-auto` on the container as the genuine-overflow fallback.

### Task 2 — G6: stat strip columns match cell count
`SummaryStrip` hard-coded `lg:grid-cols-5`, so a 4-cell caller (`NodeForwardsTable`) left the 5th column empty and the `bg-border` ground showed through as a gray trailing cell. Replaced the fixed classes with literal-class lookups keyed by `cells.length`: `LG_COLS` (3→`lg:grid-cols-3`, 4→`lg:grid-cols-4`, 5→`lg:grid-cols-5`, default `lg:grid-cols-5`) and `SM_COLS` capped at `min(cells.length, 3)` so a 2-cell edge never strands. Every class is a static literal the Tailwind compiler can see — no dynamically-built strings (T-13-16-01). The border-ground grammar (`gap-px`, `bg-border`, `rounded-xl`, `overflow-hidden`) and all cell classes are unchanged.

## Deviations from Plan

None — plan executed exactly as written. `table.tsx` was listed in `files_modified` but the plan body explicitly directed preserving its existing `w-full`/`overflow-x-auto`; no edit was required (its behavior was already correct), consistent with the plan's stated rationale.

## Known Stubs

None. Both edits are pure layout/CSS-class changes on existing presentational components; no data, routing, or formatting touched.

## Verification

- `grep` acceptance criteria for both tasks pass (4 soft-column `whitespace-normal` overrides; `w-24` count = 0; `overflow-x-auto` and `w-full` retained in table.tsx; `cells.length` derivation plus literal `lg:grid-cols-4`/`lg:grid-cols-5` present; `bg-border` unchanged).
- `npm run build` compiles successfully after each task.
- COLOR LAW honored: no new color introduced; navy stays structural. AFM-002 formatting untouched (no inline unit math added).
- Final proof is the wave-2 operator visual gate (13-18).

## Commits

- `ea9f4bd` fix(13-16): channels table fills column, scrolls only on true overflow
- `03bf066` fix(13-16): stat strip column count matches cell count, no dead trailing cell

## Self-Check: PASSED
- src/components/node/NodeChannelsTable.tsx — FOUND (modified, committed ea9f4bd)
- src/components/console/SummaryStrip.tsx — FOUND (modified, committed 03bf066)
- Commit ea9f4bd — FOUND
- Commit 03bf066 — FOUND
