---
sketch: 005
name: inbox-triage
question: "How should the inbox organize 531 cards so emergencies surface and the routine fee-bulk collapses?"
winner: "E"
tags: [layout, inbox, triage, faceting, bulk-action, noc]
---

# Sketch 005: Inbox Triage

## Design Question
The `/inbox` recommendation surface renders ~531 cards in one long scroll. The real distribution is
the problem, not the length:

- **Severity:** info **442 (83%)**, critical 48, warn 41 — the ~89 items that need eyes are buried.
- **Signal:** fee_raise 303 + fee_lower 126 = **429 fee tweaks (81%)**; the rest are operational
  (stuck force-closes 31, stuck sweeps 29, stuck opens 12, close candidates 9, …).
- **Action:** update_fee 426, remediate_pending 72, investigate 18, close_channel 9, rebalance 3.
- **Node clustering:** Canada **155**, England 68, Japan 62, France 48 … one node alone is 155 rows.

So the inbox needs **triage** (surface critical/warn first) and **collapse of the 81% fee bulk** into
groups/counts — ideally paired with the bulk-enqueue path shipped in Phase 6.

## How to View
open .planning/sketches/005-inbox-triage/index.html

(All four variants are tabs across the top. The toolbar bottom-right switches theme — light is primary,
navy is the comparison theme — and viewport width.)

## Variants
- **A: Attention Queue** — critical (48) and warn (41) as individual scannable rows pinned at top; the
  442 routine fee signals fold into per-signal → per-node count groups. Opens at ~12 rows, not 531.
  Closest to the validated 001 "Attention Queue" winner.
- **B: Two-Pane Master–Detail** — left faceted filter rail (severity / node / signal / action, all with
  live counts); center compact result list; right detail pane with full evidence + the enqueue/remediate
  act. Nothing leaves the screen. Path of least resistance for shadcn (resizable panels + command palette).
- **C: Grouped-by-Node** — one collapsible line per node, sorted most-critical-first, with a crit/warn/fee
  count strip (zeros faded); expand to drill in. Mirrors the validated 004 "Counts + Drill-in". Strong for
  the per-node clustering; weak at "show me all stuck FCs fleet-wide".
- **D: Action-Centric + Bulk** — grouped by the verb (Fee updates 426 / Pending remediation 72 / Close 9 /
  Rebalance 3 / Investigate 18); multi-select → ENQUEUE batch through the Phase-6 signed queue. Most
  opinionated; best when the day's job is "apply the fee book".
- **E: Synthesis (A+B)** [round 2] — A's severity **spine** stays the hero (triage on load, zero clicks),
  B's facet **rail** rides on the left as a collapsible sculptor (toggle off for a roomy 2-column), and B's
  evidence + act becomes a **drawer** that slides in on row-click (so the 3rd surface only appears on
  demand). Resolves A's "no slicing / no detail" and B's "emergencies hidden behind a click / always 3 dense
  columns". Maps cleanly to shadcn: collapsible sidebar + main + sheet.

## What to Look For
- **Does the emergency surface in < 1 second?** A and C make crit/warn structurally dominant; B needs a
  filter click; D buries them below fee updates (it's optimized for the bulk job, not triage).
- **Does the 81% fee bulk stop drowning the page?** All four collapse it differently — folds (A), facet
  filter (B), per-node fee subgroup (C), a selectable batch (D).
- **Per-node clustering (Canada 155):** C handles it natively; A/D group fees by node inside the fold.
- **Bulk-enqueue ergonomics vs the Phase-6 queue:** D leans hardest into it; A/C expose per-node
  "ENQUEUE ALL"; B enqueues one-at-a-time from the detail pane.
- **Consistency with the NOC language:** severity color only, navy only on the deliberate act, mono data,
  no icons-for-state, tight radii.
- Likely outcome is a **synthesis** (e.g. A's severity spine + B's facet rail + D's bulk bar) — note which
  pieces you'd graft.
