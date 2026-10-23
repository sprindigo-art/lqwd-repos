---
created: 2026-06-09
source: phase-02 / plan 02-07 human-verify checkpoint
area: ui
resolves_phase: 12
---

> Note (2026-06-22): superseded by milestone v2.0 — Phase 12 (Ops Center Overview)
> rebuilds the fleet overview on the new Data-Forward design system, replacing the
> UI this polish debt tracked. The original suggested route below is obsolete; the
> rebuild addresses it wholesale.

# Fleet console UI polish

Operator verdict at the 02-07 checkpoint: redesign is "better than it was" but
"still needs a lot of improvement." Checkpoint was approved-with-notes to unblock
the milestone; the visual polish debt is tracked here.

## Suggested route

1. `/gsd-ui-review` — 6-pillar visual audit of `src/app/(overview)/` +
   `src/components/scorecard/` to produce a scored punch list.
2. Optionally `/gsd-sketch` to iterate aesthetic direction cheaply (throwaway
   HTML mockups) before committing to a polish pass.
3. One focused polish plan executing the punch list.

## Constraints to preserve

- Display contract D-07/D-09/D-11/D-13 (critical-chip pairing, triage sort,
  cohort-of-1 messaging, restart-excluded freshness headline)
- LQWD navy `#1A3C79` is chrome/brand only — never a health signal; no `#F7931A`
- Honest partial / no-data states stay visible
- `frontend-design` skill installed at `.claude/skills/frontend-design` — use it
