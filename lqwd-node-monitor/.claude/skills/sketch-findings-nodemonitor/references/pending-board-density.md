# Pending Board Density

The `/pending` board (and the fleet pending triage block) at fleet scale — every pending channel
across ~28 nodes, where most nodes have nothing pending. The job: get the page short and answer
"how bad, fleet-wide" first, without hiding any sat in limbo.

## Design Decisions

**Winner: B — Counts + Drill-in.**

- **A totals strip answers "how bad" before any list:** a 4-cell stat grid (Opens / Coop closes /
  Force closes / Sat in limbo) at the top, severity-typed.
- **One collapsed row per node-with-pending; quiet nodes never render.** ~21 of 28 nodes have nothing
  pending and simply don't appear. Each node row carries a per-type count strip
  (`0 OPEN · 1 COOP · 1 FORCE`), the limbo total, and the oldest age — click to drill into its items.
- **Zero counts are faded (zero-quiet):** `.cnt.zero` drops opacity and weight so the eye lands on
  the non-zero severity counts.
- **Sweeps fold:** a force-close row with N sweeps shows a `12 sweeps ▸` toggle rather than 12 rows;
  expand only when investigating.
- **One line per item.** No multi-line cards.

## CSS Patterns

```css
/* totals strip — hairline-separated stat cells */
.totals { display:grid; grid-template-columns:repeat(4,1fr);
  background:var(--color-border); gap:1px; border-radius:var(--radius-lg); overflow:hidden; }
.tstat { background:var(--color-surface); padding:12px 16px; display:flex; flex-direction:column; gap:5px; }
.tstat .val { font-family:var(--font-mono); font-size:var(--text-xl); font-weight:600; }

/* node row — count strip + limbo + oldest, as a grid button */
.noderow > button { display:grid;
  grid-template-columns:minmax(0,1fr) 5.5rem 5.5rem 5.5rem 9rem 5.5rem; gap:24px; }
.cnt.zero { color:var(--color-text-faint); opacity:0.45; font-weight:400; }  /* zero-quiet */

/* drill-in + sweep fold */
.drill { display:none; } .drill.open { display:block; }
.sweep-detail { display:none; } .sweep-detail.open { display:block; }
```

## HTML Structures

- `.totals` strip of `.tstat` cells (label + colored value).
- `.noderow` = a grid `<button>` (alias + pubkey, per-type `.cnt` counts, `.limbo`, `.oldest`) +
  a hidden `.drill` body of `.item` rows; force-close items carry a `.sweep-toggle` + folded
  `.sweep-detail`.
- Type chips reuse pending semantics: `.t-open` (ok/green), `.t-coop` (warn), `.t-force` (critical).

## What to Avoid

- **Rendering all 28 nodes** including the ~21 quiet ones — the original density problem.
- **Bold zero counts** competing with the real ones — fade them.
- **Sweeps expanded by default** — a single force-close can have 50+ sweeps; fold them.
- The "compressed groups" variant (C) kept today's section structure but still rendered empty
  sections — rejected for not going far enough on density.

## Origin
Synthesized from sketch: 004 (winner B). Rejected: A (flat queue, node as a column — loses the
"how bad per node" read), C (compressed groups — still renders empties).
Source: `sources/004-pending-board-density.html` — the ★ tab is winner B.
