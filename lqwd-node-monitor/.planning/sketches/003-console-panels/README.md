---
sketch: 003
name: console-panels
question: "How do panels organize the node console (scorecard tab + header)?"
winner: "Synthesis (B rail + A/C top signals)"
tags: [layout, node-console, panels]
---

# Sketch 003: Console Panels

## Design Question
The scorecard verdict was "signals and grade are feeling all one… try panels." How should the node console separate identity, signals, and dimension grades into distinct panels — and fix the timestamp/button collision structurally?

## How to View
open .planning/sketches/003-console-panels/index.html

Use the bottom-right toolbar to flip between **Brazil (critical node)** and **Vancouver (healthy node)** — a design only works if it looks right in both states.

## Variants
- **A: Panel Grid** — signals panel (red-bordered, distinct) on top, then dimensions as a 2-column panel grid sorted worst-first; deep-link appears on hover.
- **B: Summary Rail** — sticky left rail with composite + compact dimension list + signals; right side gives every graded dimension a full evidence panel with a sparkline. Most room for evidence; longest page.
- **C: Severity Rows** — dimensions as full-width severity-edged rows (the 001-A queue pattern applied inside the console). Densest; reads like an incident list.

## Shared structure (all variants)
- Console header is a 3-slot grid: identity / composite (the only % on the page) / freshness in its own bordered slot — the timestamp physically cannot collide with anything.
- Tab bar: Scorecard · Channels · Fees · Liquidity · Peers · Forwards · Closes · Pending (with count).
- Signals (tier-1 breaches + fleet outlier markers) live in their own panel, visually severed from grades — D-07's "critical is a separate signal" made literal.
- Grade chips are the 002-B tinted chip; no-data dimensions (stability, pg health, visibility) render inert at half opacity.

## What to Look For
- Flip Brazil ↔ Vancouver: does the healthy view still feel composed (not empty) when the signals panel disappears?
- A vs C: is the 2-col grid worth the lost row-scan, or do severity rows read faster?
- B: do sparklines + evidence earn the extra height, or is it over-explained (the original sin)?
