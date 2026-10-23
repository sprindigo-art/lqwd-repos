---
phase: 03-per-node-console-pending-monitor
plan: 14
subsystem: ui
tags: [react, nextjs, server-components, svg, sparkline, tailwind-v4, sketch-003]

# Dependency graph
requires:
  - phase: 03-per-node-console-pending-monitor (03-11)
    provides: "TrendPoint shape from src/lib/console/trends.ts (daily-bucket sparkline series)"
  - phase: 03-per-node-console-pending-monitor (03-12)
    provides: "GradeBadge severity-tinted chip API (color/letter/title/size)"
provides:
  - "Sparkline: pure 160x40 navy-bright SVG polyline Server Component (no chart lib, null below 2 points)"
  - "EvidencePanel: per-dimension panel — head (name + chip + open-tab deep link), evbody grid (mono evidence line + optional sparkline)"
  - "ActiveSignalsPanel: red-tinted top-of-console signals panel severed from grades; null on healthy nodes"
  - "ConsoleRail: sticky rail with composite chip (pct tooltip-only) + worst-first dimension index, nodata rows inert at half opacity"
affects: [03-15 console page wiring, 03-16, per-node-console]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-rolled SVG sparkline (no Recharts for a 160x40 polyline — T-03-SC zero new deps)"
    - "SignalRow[] built by the caller, rendered verbatim (T-02-07 — components never derive health)"

key-files:
  created:
    - src/components/console/Sparkline.tsx
    - src/components/console/EvidencePanel.tsx
    - src/components/console/ActiveSignalsPanel.tsx
    - src/components/console/ConsoleRail.tsx
  modified: []

key-decisions:
  - "DIMENSION_NAMES duplicated locally in ConsoleRail with a source-of-truth pointer comment — ScorecardPanel.tsx belongs to 03-15's wave-4 file set, so no export was added there"
  - "Rail dimension rows are unlinked (name + chip only) — sketch .rail-dim grammar carries no links; only nodata inertness is mandated"
  - "Sparkline stroke is var(--color-brand-light) per plan spec — structural navy, never a health color"

patterns-established:
  - "Evidence panel grammar: panel-head (mono uppercase name + sm chip + ms-auto deep link) over evbody grid-cols-[1fr_auto]"
  - "open {tab} → deep-link affordance in font-mono text-brand-light hover:text-brand-glow"

requirements-completed: [NODE-01]

# Metrics
duration: 6min
completed: 2026-06-11
---

# Phase 3 Plan 14: Console Components (Sketch 003 Synthesis) Summary

**Four Server Components for the gap-4 console rework — red-headed ActiveSignalsPanel physically severed from grades, sticky worst-first ConsoleRail, per-dimension EvidencePanel, and a hand-rolled 160x40 navy SVG Sparkline**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-11T17:04:22Z
- **Completed:** 2026-06-11T17:10:30Z
- **Tasks:** 2
- **Files modified:** 4 (all created)

## Accomplishments
- Signals and grades never share a container: breaches/outliers render in their own red-tinted panel (null on healthy nodes), grades live in chips in the rail and evidence-panel heads
- Inline-pct rule enforced structurally: neither the rail nor any evidence panel renders an inline `%` — percentages live only in GradeBadge `title` tooltips, reserving the single on-page inline pct for 03-15's 3-slot header
- Zero new dependencies: the sparkline is a hand-rolled min-max-normalized `<polyline>` (T-03-SC), numeric-only props through React attribute escaping (T-03-26)
- The existing no-`"use client"` grep gate over `src/components/console/` keeps passing; `npx tsc --noEmit` and `npm run build` green

## Task Commits

Each task was committed atomically:

1. **Task 1: Sparkline + EvidencePanel** - `17d38df` (feat)
2. **Task 2: ActiveSignalsPanel + ConsoleRail** - `d533f47` (feat)

## Files Created/Modified
- `src/components/console/Sparkline.tsx` - Pure 160x40 SVG polyline, `var(--color-brand-light)` stroke at 1.5, 2px x-inset / 3px y-inset, flat series → midline, returns null below 2 points, `aria-hidden`
- `src/components/console/EvidencePanel.tsx` - Per-dimension panel: head (mono uppercase name + GradeBadge sm + `open {tab} →` link), body `grid-cols-[1fr_auto]` (mono tabular evidence line + optional sparkline when series ≥ 2 points)
- `src/components/console/ActiveSignalsPanel.tsx` - `border-status-critical/40` panel, red mono head with right-aligned count; breach rows red uppercase, outlier rows amber lowercase, mono detail + `ms-auto` deep link; early `return null` for empty signals
- `src/components/console/ConsoleRail.tsx` - `sticky top-6` aside wrapping a bg-card block: composite GradeBadge lg (pct in title tooltip only), worst-first dimension rows (pct ascending nulls-last, nodata last at `opacity-50`, en-dash chip, no link)

## Decisions Made
- DIMENSION_NAMES map duplicated locally in ConsoleRail (with a comment pointing at ScorecardPanel.tsx as source of truth) instead of exporting from ScorecardPanel.tsx — that file is owned by 03-15's wave-4 file set
- Rail dimension rows render name + chip with no links for ALL rows — the sketch `.rail-dim` grammar carries no link affordance and the plan only mandates inertness for nodata; 03-15 can extend if the wiring plan calls for it
- Deep-link text falls back to `open evidence →` when `href` is set without `tabLabel` (both props optional in the contract)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None — all four components are complete presentational implementations; they intentionally render caller-provided data verbatim (props contracts for 03-15 wiring), which is the plan's design, not a stub.

## Threat Flags
None — no new network endpoints, auth paths, file access, or schema surface. T-03-26 (SVG XSS) mitigated via numeric-only props through React attribute escaping; T-03-SC mitigated via zero new dependencies.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four components match the Interfaces contracts in 03-14-PLAN.md exactly — 03-15 can wire them into the console page without modification
- Console page, tab files, ScorecardPanel.tsx, fleet overview, PendingBoard, and /pending were NOT touched (file-ownership boundaries respected)

---
*Phase: 03-per-node-console-pending-monitor*
*Completed: 2026-06-11*

## Self-Check: PASSED

All 4 created files exist on disk; commits 17d38df and d533f47 present in git log.
