---
phase: 03-per-node-console-pending-monitor
plan: 03
subsystem: ui
tags: [d-14, density, scorecard, fleet-overview, typography, tailwind]
requires: []
provides:
  - "GradeBadge dot+letter unit with opt-in showPct (D-14 rule 1/2)"
  - "DimensionRow three-slot tile: mono label / dot+letter / raw evidence (D-14 rule 3)"
  - "Composite scorecard header as the single pct surface (D-14 rule 2)"
  - "One micro text size (text-xs) across the console (D-04 polish)"
affects:
  - "03-04..03-06 (console shell builds against the simplified grade grammar)"
  - "03-08 (triage strip untouched, five-block-ready)"
tech-stack:
  added: []
  patterns:
    - "Opt-in prop gating (showPct) instead of caller-side conditional rendering"
    - "Detail demoted to tooltip: pct + grade-band explanation live in LabeledTooltip"
key-files:
  created: []
  modified:
    - src/components/scorecard/GradeBadge.tsx
    - src/components/scorecard/DimensionRow.tsx
    - src/components/scorecard/ScorecardPanel.tsx
    - src/app/(overview)/page.tsx
    - src/app/(overview)/layout.tsx
    - src/components/scorecard/BackendBadge.tsx
decisions:
  - "GradeBadge pct prop made optional (default null) so callers drop it entirely rather than passing null"
  - "Dimension pct tooltip reuses the existing LabeledTooltip helper, body = pct + grade-band anchors (A>=90 B>=80 C>=70 D>=60 F<60)"
  - "Grade column head right-aligns with its right-aligned cells (rule 5: alignment is a feature)"
  - "Empty-state heading moved text-xl -> text-2xl (Display 24) per Typography contract (no 20px size)"
  - "NODE-01 left unmarked in REQUIREMENTS.md — the per-node console (03-04..06) completes it, not this density pass"
metrics:
  duration: "~6 min"
  completed: "2026-06-10"
---

# Phase 3 Plan 03: D-14 Density Revision Summary

Grade unit simplified fleet-wide to dot + letter; the percentage survives only in the scorecard composite header (showPct) and dimension tooltips, with the micro text size unified to text-xs.

## What Was Built

- **GradeBadge** (`src/components/scorecard/GradeBadge.tsx`): added `showPct?: boolean` (default false); the pct span renders only when `showPct && pct !== null`, in both `sm` and `lg` variants. `pct` became optional (`?: number | null`, default null) so D-14-compliant callers omit it entirely. The "component NEVER derives color" contract is untouched.
- **DimensionRow** (`src/components/scorecard/DimensionRow.tsx`): tile re-laid to the three aligned slots — mono console-label top-left (`text-foreground/45` per plan spec), dot+letter GradeBadge top-right (right-aligned), raw evidence bottom-left (Heading role, AFM-002 pre-formatted string unchanged). The dimension percentage moved into a LabeledTooltip on the grade unit, paired with the grade-band explanation. Strict state precedence (nodata > partial > peer-relative), CriticalChip, OutlierMarker, and partial/no-data notes all survive unchanged. No deep-linking added (that is plan 03-06).
- **ScorecardPanel** (`src/components/scorecard/ScorecardPanel.tsx`): composite header GradeBadge passes `showPct` — the ONE place the percentage renders (`B · 84%` style). No text-[11px] was present here.
- **Fleet overview** (`src/app/(overview)/page.tsx`): fleet-row GradeBadge drops the pct prop (the % column dies, rule 4) and right-aligns in its column; the Grade column head right-aligns to match (rule 5). All seven `text-[11px]` occurrences swept to `text-xs`. Empty-state heading `text-xl` → `text-2xl`. Triage stat strip structure untouched (clean four-block grid, five-block-ready for 03-08).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] text-[11px] sweep extended to two files outside the plan's files_modified list**
- **Found during:** Task 2
- **Issue:** The automated verify (`! grep -rq "text-\[11px\]" src/app src/components`) and the must-have truth ("no text-[11px] remains") could not pass with only the four listed files — `src/app/(overview)/layout.tsx:32` (header chrome) and `src/components/scorecard/BackendBadge.tsx:16` also carried the 11px micro size.
- **Fix:** Swept both to `text-xs`, same class otherwise.
- **Files modified:** src/app/(overview)/layout.tsx, src/components/scorecard/BackendBadge.tsx
- **Commit:** 8a72749

No other deviations — both tasks otherwise executed exactly as written.

## Verification

- `npx tsc --noEmit` — clean (both tasks)
- `npx vitest run` — 141 passed, 14 skipped, 0 failed (zero data-layer impact, as expected)
- `grep -rn "text-\[11px\]" src/` — 0 matches
- `grep -n "pct" src/components/scorecard/DimensionRow.tsx` — pct appears only in the tooltip block (guard + body)
- "NEVER derives color" contract comment survives in GradeBadge.tsx
- CriticalChip, OutlierMarker, and the state-precedence comment survive in DimensionRow.tsx
- ScorecardPanel composite header passes `showPct`; fleet-row invocation has no `pct=` prop

All six UI-SPEC §Density Revision rules implemented. Visual confirmation of the "aligned items, not over-explained" bar lands at the 03-09 checkpoint.

## Known Stubs

None — purely presentational changes; every surface remains wired to its existing data source.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes (matches the plan's threat model: presentational-only). Surviving non-redundant signals (T-03-06) asserted present.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | 857ee9a | GradeBadge showPct gate + DimensionRow three-slot tile |
| 2 | 8a72749 | Fleet-row pct removal, composite-header showPct, text-[11px] sweep |

## Self-Check: PASSED

All claimed files exist; commits 857ee9a and 8a72749 verified in git log.
