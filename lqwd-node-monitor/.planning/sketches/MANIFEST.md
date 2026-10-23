# Sketch Manifest

## Design Direction
Mission-control NOC for the LQWD Lightning fleet — dense but disciplined. **Theme decision (2026-06-11): light mode is the primary — and likely only — mode** (`themes/light.css`, NOC Light); this supersedes Phase 2's dark-default constraint. The dark NOC Navy theme is retained in sketches for comparison only. The operator's single job on the fleet page is **spot what's wrong fast**. Severity color (red/amber/green/gray) is reserved exclusively for state: grade letters are themselves colored (no dots), tier-1 breaches render as plain uppercase text (no emoji), and LQWD navy `#1A3C79` does all structural work (chrome, selection, focus). IBM Plex Mono carries data and labels; Saira Semi Condensed carries display headers. Panels separate signals from grades — the direct answer to the Phase 3 gate verdict ("signals and grade are feeling all one… try panels"). Designed to read like the fleet-health pane of the future AI-powered Operations Center (alert ingestion, AI incident summaries, change-request queue — captured separately as a roadmap-level idea, not sketched here).

## Reference Points
NOC / mission-control aesthetics; operator rejected the current "all one" uniform styling. Brand: LQWD navy, never Bitcoin orange. Data shapes from the real scorecard contracts (7 graded dimensions, tier-1 breach labels `fee crash` / `close storm` / `unreachable`, StatusColor ok|warn|critical|nodata, triage strip Critical/Warn/Healthy/Stale data/Pending).

## Sketches

| # | Name | Design Question | Winner | Tags |
|---|------|----------------|--------|------|
| 001 | fleet-triage-board | How should the fleet overview surface what's wrong fast? | A: Attention Queue | layout, fleet-overview, triage, noc |
| 002 | grade-signal-unit | What does a grade/signal unit look like without the dot or emoji? | B: Tinted chip | component, grade, density |
| 003 | console-panels | How do panels organize the node console (scorecard tab + header)? | Synthesis: B rail + top signals panel | layout, node-console, panels |
| 004 | pending-board-density | How does /pending get short without hiding any sat in limbo? | B: Counts + Drill-in | layout, pending, density |
| 005 | inbox-triage | How should the inbox organize 531 cards so emergencies surface and the fee-bulk collapses? | E: Synthesis (A spine + B rail + drawer) | layout, inbox, triage, faceting, bulk-action, noc |
