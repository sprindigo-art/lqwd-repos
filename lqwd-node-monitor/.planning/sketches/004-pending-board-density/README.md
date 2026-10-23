---
sketch: 004
name: pending-board-density
question: "How does /pending get short without hiding any sat in limbo?"
winner: "B"
tags: [layout, pending, density, fleet]
---

# Sketch 004: Pending Board Density

## Design Question

The live /pending page renders ~28 node groups × 3 sections each (62 "No pending …"
empty lines) plus 80 always-visible nested sweep lines — most of the scroll is
whitespace and empties. How does the page get short while still accounting for
every sat (03-01 decision: no row ever dropped)?

All variants share one already-decided element: **sweeps collapse behind a
count** ("12 sweeps ▸" → click to expand txid/attempts/fee-rate lines).

## How to View

open .planning/sketches/004-pending-board-density/index.html

## Variants

- **A: Flat Queue** — no node grouping at all; one dense table line per pending
  item, node is a column, fleet-wide oldest-first. Quiet nodes don't exist on
  the page.
- **B: Counts + Drill-in** — totals strip (opens/coops/forces/limbo) up top,
  then one summary row per node-with-pending (zero counts faint); click a node
  to expand its detail items inline.
- **C: Compressed Groups** — keeps today's node-group structure but hides empty
  sections and quiet nodes, tightens rows to one line, inlines per-group counts
  in the header.

## Decision

**Winner: B — Counts + Drill-in** (operator, 2026-06-12). The totals strip
answers "is fleet money stuck, and how much?" before any scrolling; the
node summary list stays short (only nodes-with-pending render), and detail
is one click away. Sweeps fold behind a count inside the drill-in.

**Carry-forward note:** alignment in this sketch is approximate — the build
must lock the count columns (OPEN/COOP/FORCE) and the limbo/oldest columns to
fixed widths so they align vertically across node rows, and align the drill-in
detail columns to the same grid. Operator flagged these as "small issues to
fix in deployment."

## What to Look For

- Which structure answers "is fleet money stuck?" fastest?
- A loses per-node identity — is scanning by node alias as a column enough?
- B requires a click to see channel detail — acceptable, or friction?
- C is the least change from today — is it short enough, or still too tall?
- Sweep fold: is "54 sweeps ▸ … N more · X sat total remaining" enough daily
  signal for the Sweden-style sweep pileups?
- Unattached sweeps (HongKong) and the 144-blocks-til-maturity annotation must
  stay visible in all variants — every sat accounted for.
