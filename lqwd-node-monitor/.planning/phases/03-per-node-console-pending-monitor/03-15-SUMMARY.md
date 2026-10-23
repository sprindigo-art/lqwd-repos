---
phase: 03-per-node-console-pending-monitor
plan: 15
subsystem: ui
tags: [nextjs, app-router, server-components, tailwind-v4, sparkline, scorecard, console]

# Dependency graph
requires:
  - phase: 03-per-node-console-pending-monitor (03-11)
    provides: forwardsDailySeries/closesDailySeries trend readers (TrendPoint)
  - phase: 03-per-node-console-pending-monitor (03-12)
    provides: severity-tinted GradeBadge chip API, plain-text CriticalChip
  - phase: 03-per-node-console-pending-monitor (03-13)
    provides: fleet Attention Queue + dot-free pending surfaces
  - phase: 03-per-node-console-pending-monitor (03-14)
    provides: Sparkline/EvidencePanel/ActiveSignalsPanel/ConsoleRail props contracts
provides:
  - 3-slot console header (identity / composite / freshness in its own border-left slot) — gap 3 structurally closed
  - Scorecard tab composes ActiveSignalsPanel + sticky ConsoleRail + worst-first EvidencePanels with sparklines — gap 4 closed on the console
  - ConsoleTabs pendingCount prop — pending tab count in navy when > 0
  - rawDisplayFor / DIMENSION_NAMES / EVIDENCE_TAB as named exports from ScorecardPanel
  - Modal scorecard with signals severed from the composite strip
affects: [03-16 re-verification gate, phase-04 recommendation cards deep links]

# Tech tracking
tech-stack:
  added: []
  patterns: "scorecard-tab-only trend fetches inside a per-page Promise.all with .catch(() => null) degrades; signals built by the page, rendered verbatim by ActiveSignalsPanel"

key-files:
  created: []
  modified:
    - src/app/(overview)/[pubkey]/[tab]/page.tsx
    - src/components/console/ConsoleTabs.tsx
    - src/components/scorecard/ScorecardPanel.tsx

key-decisions:
  - "Pending count fetched on EVERY tab (recency-bounded, .catch degraded); trend series fetched only when tab === scorecard — same Promise.all, conditional members"
  - "Task 2 (ConsoleTabs prop) committed before Task 1 so every commit typechecks standalone — the page passes pendingCount in Task 1"
  - "Revenue sparkline remaps TrendPoint feesSat into the polyline n channel — display shape only, no unit math"

patterns-established:
  - "EVIDENCE_TAB/DIMENSION_NAMES/rawDisplayFor are single-source named exports from ScorecardPanel — console surfaces import, never duplicate"

requirements-completed: [NODE-01, PENDING-01]

# Metrics
duration: 9min
completed: 2026-06-11
---

# Phase 03 Plan 15: Console Wiring (Gaps 3 + 4) Summary

**3-slot console header (freshness owns a bordered slot — collision structurally impossible) plus the signals/rail/evidence scorecard tab with navy sparklines, pending count in navy on the tab bar, and the modal scorecard's signals severed from the grade strip**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-06-11T17:16:52Z
- **Completed:** 2026-06-11T17:25:30Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments

- **Gap 3 closed (structural):** the console header is one `grid-cols-1 md:grid-cols-[1fr_auto_auto]` panel — identity / composite / freshness. The FreshnessStamp lives in its own `md:border-l md:pl-6` slot; no `ms-auto` float remains, so it physically cannot collide with buttons (sketch 003 rule).
- **Gap 4 closed (console):** the scorecard tab now composes `ActiveSignalsPanel` (tier-1 breaches + uncovered critical chips + fleet outliers, built by the page from `node.dimensions`) above a `lg:grid-cols-[280px_1fr]` railwrap — sticky `ConsoleRail` left, worst-first `EvidencePanel` list right with sparklines on routing (forwards count), revenue (feesSat remapped), and force-close (closes count). `<ScorecardPanel` no longer appears in the page.
- The header slot 2 carries the ONLY inline `%` on the page; the pending tab shows its in-flight count in `text-brand-light` navy when > 0 (zero-quiet otherwise).
- Modal scorecard: `criticalChips` removed from the composite strip and rendered in a separate red-bordered `Active signals` block between header and dimension grid — the "feeling all one" failure is gone at modal scale too.
- All new reads (`forwardsDailySeries`, `closesDailySeries`, `currentPendingChannels`) execute strictly AFTER the PUBKEY_RE → TAB_KEYS → WINDOW_PRESETS gauntlet, Promise.all'd, every one `.catch` degraded (T-03-27 / T-03-28). Zero new dependencies (T-03-SC).

## Task Commits

Each task was committed atomically (Task 2 committed first — see Deviations):

1. **Task 2: ConsoleTabs — pending count in navy** - `b5553a6` (feat)
2. **Task 1: 3-slot console header + signals/rail/evidence scorecard tab** - `9a63cf3` (feat)
3. **Task 3: ScorecardPanel (modal) — sever signals from the composite strip** - `7f9faf9` (feat)

## Files Created/Modified

- `src/app/(overview)/[pubkey]/[tab]/page.tsx` - 3-slot header, scorecard-tab synthesis composition, trend/pending Promise.all with degrades, pendingCount passthrough
- `src/components/console/ConsoleTabs.tsx` - optional `pendingCount?: number | null` prop; navy count span on the pending tab when > 0; still a Server Component of next/link anchors
- `src/components/scorecard/ScorecardPanel.tsx` - `rawDisplayFor`/`DIMENSION_NAMES`/`EVIDENCE_TAB` named exports; signals block severed from the strip; modal-only role documented

## Decisions Made

- Pending count fetches on every tab (the tab bar renders on all eight tabs; the must-have truth requires the count wherever the bar shows) while the two trend series fetch only on the scorecard tab — one Promise.all with conditional members, matching the threat model's "2 trend + 1 pending" per-page read budget.
- EvidencePanel `title` reuses DimensionRow's exact band-pct tooltip string (`{pct}% — grade bands: A ≥90 …`) so the grade-band explanation reads identically across surfaces.
- Uncovered composite-level critical chips get a signals row with an empty detail line (plan specifies no detail source for them; ActiveSignalsPanel renders the label alone).

## Deviations from Plan

**1. [Commit sequencing] Task 2 committed before Task 1**
- **Found during:** Task 1 (page passes `pendingCount` to ConsoleTabs)
- **Issue:** Task 1's `npx tsc --noEmit` verify would fail standalone because the `pendingCount` prop only lands in Task 2
- **Fix:** Implemented and committed the standalone-safe ConsoleTabs prop (Task 2, `b5553a6`) first, then Task 1 (`9a63cf3`) — every commit typechecks green
- **Files modified:** none beyond plan scope
- **Verification:** `npx tsc --noEmit` green at both commits

---

**Total deviations:** 1 (commit ordering only — no scope change, no code deviation)
**Impact on plan:** None on content; the history stays green at every commit.

## Verification Results

- `npx tsc --noEmit` — green
- `npm test` — 264 passed | 16 skipped (30 files)
- `npm run build` — green (all console routes dynamic)
- `! grep -rq '"use client"' src/components/console/` — green (all Server Components)
- Live probe set (production build on :3777, real warehouse): `/{valid}` → 307, `/{valid}/scorecard` → 200, `/{valid}/forwards` → 200, `/{valid}/pending` → 200, `/{valid}/badtab` → 404, `/{64-char}` → 404
- Rendered scorecard HTML confirmed: `md:grid-cols-[1fr_auto_auto]` header present, `lg:grid-cols-[280px_1fr]` railwrap present, 3 sparkline polylines (routing/revenue/forceClose)

## Known Stubs

None blocking — one note: ActiveSignalsPanel rows for composite-level chips not covered by a dimension breach carry an empty `detail` string (plan-directed; no detail source exists for them).

## Issues Encountered

- `curl` unavailable in the sandbox shell — probes run via `node` fetch instead. No code impact.

## Carried Note (for orchestrator / future plan)

- `ConsoleRail.tsx` still carries its local `DIMENSION_NAMES` duplicate with a source-of-truth comment pointing at ScorecardPanel. The plan forbade modifying 03-14 files ("wire verbatim, do not modify"), and its export-consumption was not in this plan's task set — the map IS now exported from ScorecardPanel, so a one-line import swap in ConsoleRail is available to any future plan that owns that file.

## Next Phase Readiness

- All eight console tabs render on the new chrome; gaps 3 and 4 are closed on the console surface — ready for the 03-16 re-verification gate.
- The modal quick-look and the console scorecard tab now share display maps from a single export point.

## Self-Check: PASSED

All 3 modified files exist on disk; all 3 task commits (`b5553a6`, `9a63cf3`, `7f9faf9`) present in git log; SUMMARY committed as the plan-metadata docs commit; working tree clean.

---
*Phase: 03-per-node-console-pending-monitor*
*Completed: 2026-06-11*
