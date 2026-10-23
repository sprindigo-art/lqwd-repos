---
name: sketch-findings-nodemonitor
description: Validated design decisions, CSS patterns, and visual direction from sketch experiments. Auto-loaded during UI implementation on NodeMonitorDashboard.
---

<context>
## Project: NodeMonitorDashboard

Mission-control NOC for the LQWD Lightning fleet — dense but disciplined. **Light mode is the primary — and likely only — mode** (operator decision 2026-06-11, supersedes Phase 2's dark default). Navy `#1A3C79` does structure (chrome, active states, links, focus); severity color (critical/warn/ok/stale) does state and appears nowhere else. IBM Plex Mono carries all data and labels; Saira Semi Condensed carries display headers; Inter is body. The fleet page's single job: **spot what's wrong fast**.

These findings came out of the Phase 3 gate rejection ("signals and grade are feeling all one… this is hideous") — every decision below was validated by the operator against interactive mockups. Designed to read like the fleet-health pane of a future AI-powered Operations Center (that larger vision is a roadmap item, not part of these findings).

Sketch sessions wrapped: 2026-06-11, 2026-06-16
</context>

<design_direction>
## Overall Direction

- **Light NOC theme** (`sources/themes/light.css`): white/pale blue-gray surfaces, dark navy-gray text scale (`#0D1626` / `#34435E` / `#5A6880` — do not lighten), darkened severity hues for contrast (`#D92638` / `#8F5D00` / `#0B8A51` / `#5D6A80`) with faint matching tints for chip backgrounds.
- **No emoji, no dots, no icons for state** — plain uppercase mono text for breaches (`CLOSE STORM`, `UNREACHABLE`), grade letters in severity-tinted chips.
- Percentages live in tooltips; the composite header is the only inline %.
- Panels separate concerns: signals are physically severed from grades.
- Tight radii (3/6/10px), hairline borders, mono-first density — instruments, not bubbles.
</design_direction>

<findings_index>
## Design Areas

| Area | Reference | Key Decision |
|------|-----------|--------------|
| Fleet Triage Layout | references/fleet-triage-layout.md | Attention-queue fleet page: incident feed on top with breach text + "why" line, healthy fleet collapses below |
| Grade & Signal Unit | references/grade-signal-unit.md | Severity-tinted chip around the letter; StatusColor not band color; pct in tooltip |
| Console Panels & Theme | references/console-panels-theme.md | 3-slot header (freshness owns a slot), top Active Signals panel, sticky rail + evidence panels with sparklines; light theme tokens |
| Inbox Triage Layout | references/inbox-triage-layout.md | Severity spine (triage on load) + collapsible facet rail + slide-in detail/act drawer; routine fee bulk folds into per-signal→per-node counts; maps to shadcn Sidebar+main+Sheet |
| Pending Board Density | references/pending-board-density.md | Totals strip + one collapsed row per node-with-pending (quiet nodes hidden, zero counts faded); sweeps fold |

## Theme

Primary theme: `sources/themes/light.css` (NOC Light). Dark comparison theme: `sources/themes/default.css` (NOC Navy).

## Source Files

Original interactive sketch HTML files are preserved in `sources/` — open them in a browser for complete reference (each contains all variants with the winner marked ★).
</findings_index>

<metadata>
## Processed Sketches

- 001-fleet-triage-board (winner: A — Attention Queue)
- 002-grade-signal-unit (winner: B — Tinted chip)
- 003-console-panels (winner: Synthesis — B rail + top signals)
- 004-pending-board-density (winner: B — Counts + Drill-in)
- 005-inbox-triage (winner: E — Synthesis: severity spine + facet rail + detail drawer)
</metadata>
