---
sketch: 001
name: fleet-triage-board
question: "How should the fleet overview surface what's wrong fast?"
winner: "A"
tags: [layout, fleet-overview, triage, noc]
---

# Sketch 001: Fleet Triage Board

## Design Question
How should the fleet overview be structured so the operator spots what's wrong in two seconds — replacing the current uniform table where "signals and grade feel all one"?

## How to View
open .planning/sketches/001-fleet-triage-board/index.html

## Variants
- **A: Attention Queue** — incident-feed panel on top (worst first, with breach text and a one-line "why"), healthy fleet collapsed into a compact grid below. Triage-first; healthy nodes get out of the way.
- **B: Status Wall** — dense NOC tile wall, severity edge + tinted wash on the left of each tile, whole fleet visible at once. Big-picture first; scan the wall like a rack.
- **C: Severity Ledger** — single worst-first table with a severity rail per row and per-dimension grade columns (routing/revenue/liquidity/force close). Closest to the current implementation; most data per square inch.

## What to Look For
- Grade letters carry their own status color — no dot, no emoji anywhere. Breaches are plain uppercase text (`CLOSE STORM`, `UNREACHABLE`) in red.
- Severity color appears ONLY on state (letters, edges, breach text) — the navy brand does all the structure. Does that make the reds/ambers pop enough?
- Freshness stamps live in a dedicated right-aligned slot in every variant — nothing can collide.
- Which variant would you actually leave open on a second monitor?
- All three share the same triage strip (Critical / Warn / Healthy / Stale data / Pending →) — confirm the strip still earns its row in each layout.
