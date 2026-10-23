---
phase: 03-per-node-console-pending-monitor
plan: 12
subsystem: ui
tags: [react, nextjs, tailwind, scorecard, sketch-findings, gap-closure]

# Dependency graph
requires:
  - phase: 03-per-node-console-pending-monitor (03-10)
    provides: NOC Light theme tokens — the -dim status tint family (bg-status-*-dim) the chip recipe composes
provides:
  - GradeBadge severity-tinted chip (sketch 002 winner B) — colored letter in tinted chip with hairline border, color/letter/title/size API, nodata en-dash chip
  - CriticalChip as plain uppercase mono breach text in critical red (no emoji, no box)
  - FreshnessStamp STALE marker as plain mono text (no warning glyph anywhere, including comments)
  - OutlierMarker as plain amber mono "fleet outlier" text (no diamond glyph, no violet box)
  - All four owned call surfaces migrated to the chip API; pct in tooltips everywhere + one inline console-header span
affects: [03-13, 03-14, 03-15, 03-16]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Grade chip recipe: text-status-X bg-status-X-dim border-status-X/30 triplets keyed by StatusColor (CLASS_BY_COLOR record); nodata wears the stale tokens"
    - "Pct placement: chip title tooltip everywhere; the console [tab] header is THE one inline-pct surface"
    - "State signals are plain mono text — no emoji, no dots, no glyphs, ever (sketch rule, absolute)"

key-files:
  created: []
  modified:
    - src/components/scorecard/GradeBadge.tsx
    - src/components/scorecard/CriticalChip.tsx
    - src/components/scorecard/FreshnessStamp.tsx
    - src/components/scorecard/OutlierMarker.tsx
    - src/components/scorecard/DimensionRow.tsx
    - src/components/scorecard/ScorecardPanel.tsx
    - src/app/(overview)/page.tsx
    - src/app/(overview)/[pubkey]/[tab]/page.tsx

key-decisions:
  - "GradeBadge keeps its named export but the prop is now `color` (StatusColor incl. nodata) — consumers in 03-13/03-14/03-15 build against the Interfaces contract verbatim"
  - "CriticalChip keeps its export name despite no longer being a chip — avoids import churn across surfaces 03-13/03-15 will overhaul anyway"
  - "REQUIREMENTS.md left untouched in the worktree — NODE-01 spans the remaining wave-3 gap-closure plans; the orchestrator owns shared-artifact writes"

patterns-established:
  - "CLASS_BY_COLOR/SIZE_CLASS record maps keyed by union types — purely presentational, no color derivation in JSX (T-02-07 preserved)"

requirements-completed: [NODE-01]

# Metrics
duration: 5min
completed: 2026-06-11
---

# Phase 3 Plan 12: Sketch-Validated Signal Primitives Summary

**Severity-tinted grade chip (sketch 002 winner B) replaces the rejected dot+letter unit, and every breach/stale/outlier signal is now plain mono text — zero emoji or glyph state indicators left in src/**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-11T16:37:30Z
- **Completed:** 2026-06-11T16:42:30Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- **Gap 2 closed:** the grade letter itself is colored, sitting in a faint severity-tinted chip with a matching hairline border (`text-status-X bg-status-X-dim border-status-X/30`) — no dot anywhere. nodata renders an en-dash chip in the stale tint.
- **Gap 1 closed:** `grep -rn "🔴\|🟡\|🟢\|⚠\|◆" src/` returns empty, including comments. Tier-1 breaches are plain uppercase mono in critical red, stale is `STALE — data as of {date}`, fleet-outlier is plain amber mono text per the console-panels finding.
- Percentages now live in chip `title` tooltips everywhere, plus exactly one inline span next to the composite chip in the console `[tab]` header (verified: line 160 of the console page is the sole inline pct render).
- New GradeBadge API (`color`/`letter`/`title`/`size` with sm/md/lg scale) is the contract 03-13/03-14/03-15 layouts build against.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite GradeBadge as the severity-tinted chip** - `f4aea64` (feat)
2. **Task 2: Plain-text signal primitives — CriticalChip, FreshnessStamp, OutlierMarker** - `022909f` (feat)
3. **Task 3: Mechanical call-site updates for the new GradeBadge API** - `86f30ce` (feat)

## Files Created/Modified

- `src/components/scorecard/GradeBadge.tsx` - Severity-tinted chip: CLASS_BY_COLOR triplets per StatusColor, SIZE_CLASS scale (sm/md/lg), title passthrough, sr-only color word, en-dash for nodata/null letter
- `src/components/scorecard/CriticalChip.tsx` - Plain uppercase mono breach text (`tracking-[0.06em] uppercase text-status-critical`); red-circle glyph, `critical:` prefix, and box removed
- `src/components/scorecard/FreshnessStamp.tsx` - Stale branch renders `STALE — data as of {date}`; warning glyph removed from JSX and doc comment
- `src/components/scorecard/OutlierMarker.tsx` - `fleet outlier` in `text-status-warn` amber mono inside the existing tooltip; diamond glyph and violet box removed
- `src/components/scorecard/DimensionRow.tsx` - Chip title carries the pct + grade-band explanation; LabeledTooltip wrapper around the grade unit removed
- `src/components/scorecard/ScorecardPanel.tsx` - Composite header chip carries pct in its tooltip (no inline pct in the modal)
- `src/app/(overview)/page.tsx` - FleetRow uses the size="md" queue-row chip with tooltip pct
- `src/app/(overview)/[pubkey]/[tab]/page.tsx` - lg chip + the ONE inline pct sibling span (sketch rule)

## Decisions Made

- Kept the `CriticalChip` export name although it no longer renders a chip — the plan mandated this to avoid import churn; 03-13/03-15 overhaul those surfaces anyway.
- Reworded the GradeBadge title-prop doc comment to avoid the substring `pct` so the acceptance grep (`no pct prop remains`) is unambiguous.
- Did NOT modify `.planning/REQUIREMENTS.md` in the worktree: NODE-01 also gates the remaining wave-3 gap-closure plans, and parallel worktree writes to shared planning artifacts conflict at merge. `requirements-completed: [NODE-01]` is recorded in this frontmatter for the orchestrator's central update.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Note for the record: the plan's `@.claude/skills/frontend-design/SKILL.md` context reference is untracked in the main repo, so it was absent from the worktree — read from the main repo path instead (read-only, no path-safety impact).

## Known Stubs

None — no hardcoded empty values, placeholder copy, or unwired components introduced. The `--color-status-outlier` token remains in globals.css with a comment noting it is no longer the outlier presentation color (left for 03-13+ to retire if no consumer remains; removal was out of this plan's files_modified scope).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The GradeBadge `color`/`letter`/`title`/`size` contract is live — 03-13 (fleet attention-queue layout), 03-14, and 03-15 (console panel overhaul) can build their layouts directly against it.
- `src/components/console/PendingBoard.tsx` still carries its `dot:` section-marker field — explicitly out of scope here, owned and gated by 03-13 (wave 3).
- Verification gates all green: emoji grep empty repo-wide, `npx tsc --noEmit` clean, `npm run build` clean, 264 tests passing, `dangerouslySetInnerHTML` grep empty.

---
*Phase: 03-per-node-console-pending-monitor*
*Completed: 2026-06-11*

## Self-Check: PASSED
