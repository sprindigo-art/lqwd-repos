# Inbox Triage Layout

The `/inbox` recommendation surface at fleet scale (~531 cards: 83% `info`, 81% fee tweaks,
heavy per-node clustering — Canada alone 155). The job: surface the ~89 critical/warn emergencies
on load and stop the routine fee bulk from drowning them, without hiding any card.

## Design Decisions

**Winner: E — Synthesis (severity spine + facet rail + detail drawer).** Three pieces, each
resolving a different failure mode:

- **Severity spine is the hero (center, zero-click triage).** Critical and warn cards render as
  individual scannable rows above the fold on load. Routine/`info` (fee) cards collapse into
  expandable per-signal → per-node count groups (`Fee raise (303) ▸` → `Canada ·118 ▸`). The page
  opens at ~12 rows, never a flat 531-row scroll. No card is dropped — suppressed cards stay visible
  with their reason; collapsed groups expand on demand.
- **Facet rail is an optional sculptor (left, collapsible).** Filter by severity / node / signal /
  action, each with a live count; facets combine to narrow the spine; a `◧ toggle filters` control
  collapses the rail to `grid-template-columns: 0 1fr` for a full-width view. Filtering is *additive*
  to the spine, never a precondition for seeing the emergencies.
- **Detail + act is a slide-in drawer (right, on demand).** Clicking any row opens a fixed
  right-side drawer (`transform: translateX(100%) → 0`) with the card's full evidence (metric,
  observed vs threshold, window, 14-day trend sparkline) and its action affordance
  (REMEDIATE / ENQUEUE / INVESTIGATE). Default stays a roomy 2-column; the 3rd surface only appears
  when needed.

**Bulk action rides the signed queue.** Fee groups expose per-node `ENQUEUE ALL ▸` and (from the
action-centric exploration) multi-select → batch enqueue. All bulk enqueue flows through the Phase-6
queue and is re-validated/re-signed server-side — the UI never sends a signature.

**Maps cleanly to the real stack:** shadcn collapsible `Sidebar` + main + `Sheet`/drawer — the
path of least resistance to build for real.

## CSS Patterns

```css
/* severity section header — color is a 3px left border + the label, nothing else */
.sectionbar { display:flex; align-items:center; gap:12px; padding:9px 16px;
  font-family:var(--font-mono); font-size:var(--text-xs); font-weight:600;
  letter-spacing:0.14em; text-transform:uppercase; }
.sectionbar.crit { border-left:3px solid var(--color-critical); }
.sectionbar.warn { border-left:3px solid var(--color-warn); }
.sectionbar.info { border-left:3px solid var(--color-border-strong); color:var(--color-text-faint); }

/* severity chip — tinted background, never a dot/icon */
.chip.crit { color:var(--color-critical); background:var(--color-critical-dim); }
.chip.warn { color:var(--color-warn); background:var(--color-warn-dim); }
.chip.info { color:var(--color-pending); background:rgba(44,92,180,0.08); }

/* the deliberate act — navy reserved for enqueue/approve/confirm only */
.act { border:1px solid var(--color-navy); color:var(--color-navy); background:none; }
.act:hover { background:var(--color-navy); color:#fff; }
.act.ghost { border-color:var(--color-border-strong); color:var(--color-text-muted); }

/* bulk fold — native <details> collapse for the routine bulk */
.fold > summary { list-style:none; cursor:pointer; display:grid;
  grid-template-columns:1.4rem minmax(0,1fr) max-content max-content; }
.fold[open] .tw { transform:rotate(90deg); }   /* ▸ → ▾ via rotation */

/* two-column synthesis grid + collapsible rail */
.syn { display:grid; grid-template-columns:200px minmax(0,1fr); gap:var(--space-4);
  transition:grid-template-columns 0.15s; }
.syn.railoff { grid-template-columns:0 minmax(0,1fr); }

/* detail drawer — fixed right, slides in, scoped to the active variant */
.drawer { position:fixed; top:52px; right:0; bottom:0; width:360px;
  border-left:1px solid var(--color-border-strong);
  transform:translateX(100%); transition:transform 0.18s ease; overflow:auto; }
.drawer.open { transform:translateX(0); }
```

## HTML Structures

- **Severity panels:** one `.panel` per severity, each with a `.sectionbar.{crit|warn|info}` header
  (label · short context · count on the right) then individual `.row`s, then a `<details class="fold">`
  for the "N more" tail and the routine bulk.
- **Facet rail:** `.facetgroup` blocks (`<h4>` + `.facet` buttons with a right-aligned `.fc` count);
  `.facet.on` highlights an active filter with `var(--color-navy-glow)`.
- **Drawer:** `.dh` header (display title + node·severity + ✕), a `<dl>` of evidence rows
  (mono, tabular-nums, right-aligned `dd`), a `.spark` trend, and a `.dact` action row.
- Row → drawer wiring carries data on `data-*` attributes (`data-metric`, `data-obs`, `data-thr`…)
  so one drawer template serves every row.

## What to Avoid

- **A flat 531-row list** — the original problem; emergencies drown.
- **Severity gated behind a filter click** (B-alone) — triage must be visible on load.
- **An always-on 3-column layout** (B-alone) — too dense by default; make the detail surface on demand.
- **Grouping only by node** (variant C) — great for "which node is on fire," weak at "show me all
  stuck FCs fleet-wide" (that's the facet rail's job). C was rejected as the *primary* structure.
- **Action-first as the default** (variant D) — buries the emergencies below the 426 fee updates;
  keep it as a secondary lens, not the spine.
- Dots/emoji/icons for state, severity color on anything but state, navy on anything but chrome + the act.

## Origin
Synthesized from sketch: 005 (winner E). Rejected primaries: A (no slice/detail), B (emergencies
behind a click; always 3 dense cols), C (node-only grouping), D (action-first buries emergencies).
Source: `sources/005-inbox-triage.html` — open in a browser; the ★ tab is winner E.
