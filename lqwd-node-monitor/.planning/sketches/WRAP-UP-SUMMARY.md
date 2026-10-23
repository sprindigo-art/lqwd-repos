# Sketch Wrap-Up Summary

**Date:** 2026-06-11
**Sketches processed:** 3
**Design areas:** Fleet Triage Layout · Grade & Signal Unit · Console Panels & Theme
**Skill output:** `./.claude/skills/sketch-findings-nodemonitor/`

## Included Sketches
| # | Name | Winner | Design Area |
|---|------|--------|-------------|
| 001 | fleet-triage-board | A: Attention Queue | Fleet Triage Layout |
| 002 | grade-signal-unit | B: Tinted chip | Grade & Signal Unit |
| 003 | console-panels | Synthesis: B rail + top signals | Console Panels & Theme |

## Excluded Sketches
| # | Name | Reason |
|---|------|--------|
| — | none | — |

## Design Direction
Light-first mission-control NOC. Navy `#1A3C79` is structural; severity color is state-only; IBM Plex Mono for data, Saira Semi Condensed for headers. Light mode is primary and likely the only mode (supersedes Phase 2 dark default). No emoji/dots — breaches as plain uppercase text, grades as severity-tinted letter chips with pct in tooltips.

## Key Decisions
- **Layout:** fleet page = attention queue (worst-first incident feed + collapsible healthy grid); console = 3-slot header + full-width Active Signals panel + sticky rail + per-dimension evidence panels with sparklines
- **Palette:** NOC Light tokens in `themes/light.css`; darkened severity hues for white surfaces; readability-fixed text scale (#0D1626/#34435E/#5A6880)
- **Typography:** IBM Plex Mono (data/labels), Saira Semi Condensed (display), Inter (body)
- **Component unit:** severity-tinted grade chip (StatusColor, not band color); no-data dims render an inert en-dash chip
- **Interaction:** deep links `open {tab} →` from signals and evidence panels; pending count in tab bar; freshness always in a dedicated slot

These findings feed the Phase 3 gap-closure plans (`/gsd-plan-phase 3 --gaps`) addressing the failed visual gate.

---

# Sketch Wrap-Up Summary — Session 2 (append)

**Date:** 2026-06-16
**Sketches processed:** 2 (004, 005)
**Design areas:** Inbox Triage Layout · Pending Board Density
**Skill output:** `./.claude/skills/sketch-findings-nodemonitor/` (appended)

## Included Sketches
| # | Name | Winner | Design Area |
|---|------|--------|-------------|
| 004 | pending-board-density | B: Counts + Drill-in | Pending Board Density |
| 005 | inbox-triage | E: Synthesis (spine + rail + drawer) | Inbox Triage Layout |

## Excluded Sketches
| # | Name | Reason |
|---|------|--------|
| — | none | — |

## Design Direction
Both extend the NOC Light language to dense, fleet-scale lists. Shared principle: **answer "what's
wrong / how bad" before rendering the bulk, and never hide a row to do it** — collapse, fade, and fold
the routine mass so the emergencies stay structurally dominant.

## Key Decisions
- **005 Inbox Triage (winner E)** — the Phase 7 `/inbox` rebuild contract: severity *spine* (crit/warn
  rows on load; the 81% fee bulk folds into per-signal→per-node counts) + collapsible *facet rail*
  (severity/node/signal/action, live counts) + slide-in *detail/act drawer* on row-click; bulk-enqueue
  through the Phase-6 signed queue. Maps to shadcn Sidebar + main + Sheet.
- **004 Pending Board Density (winner B)** — `/pending` as a totals strip + one collapsed row per
  node-with-pending (quiet nodes hidden, zero counts faded, sweeps folded).
- Triage visible on load; filtering (rail) and detail (drawer) are additive, never a precondition.

005's findings feed Phase 7 (Inbox Triage Rebuild) planning.
