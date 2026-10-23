# Console Panels & Theme

## Design Decisions
- **Synthesis won**: variant B's sticky summary rail + full evidence panels, with the full-width **Active Signals panel at the top** (A/C placement) instead of inside the rail.
- **Console header is a 3-slot grid** — identity (alias, backend badge, truncated pubkey) / composite (the ONLY on-page %) / freshness in its own border-left slot. The freshness stamp physically cannot collide with buttons — this fixes the Phase 3 gate layout bug structurally.
- **Active Signals panel** is visually severed from grades: red-tinted border, red panel-head, one row per tier-1 breach (red) or fleet-outlier marker (amber), each with a mono detail line and an `open {tab} →` deep link. Panel disappears entirely on healthy nodes — the page still composes (rail + evidence panels carry it).
- **Sticky left rail**: composite chip + pct, then a compact dimension list (mono uppercase label + small chip per row), worst-first. Acts as a mini index of the evidence panels.
- **Evidence panels** (right column): one per graded dimension, worst-first — panel-head carries the dimension name, its chip, and the deep link; body is a mono evidence line + a 160×40 navy sparkline SVG. No-data dimensions (stability, pg health, visibility) appear only in the rail, inert at half opacity.
- Tab bar: mono uppercase, navy underline on active tab, Pending tab carries its count in navy.
- **Light mode is the primary — likely only — mode** (operator decision 2026-06-11, supersedes Phase 2 dark default).

## CSS Patterns
```css
/* 3-slot console header — freshness owns a slot, collision impossible */
.console-head {
  display: grid; grid-template-columns: 1fr auto auto; gap: 24px;
  align-items: center; padding: 16px;
  background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}
.console-head .fresh {
  font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-text-faint);
  border-left: 1px solid var(--color-border); padding-left: 16px;
  text-align: right; white-space: nowrap;
}

/* Signals panel — severed from grades */
.signals { border-color: /* critical @ 40% */; }
.signals .panel-head { color: var(--color-critical); }
.signal-row { display: flex; gap: 16px; align-items: baseline; padding: 12px 16px; }
.signal-row .go { margin-left: auto; color: var(--color-navy-bright); }

/* Rail + evidence layout */
.railwrap { display: grid; grid-template-columns: 280px 1fr; gap: 16px; align-items: start; }
.rail { position: sticky; top: 60px; }
.rail-dim { display: flex; justify-content: space-between; align-items: center;
  padding: 8px 0; border-bottom: 1px solid var(--color-border); }

/* Evidence panel body */
.evbody { padding: 16px; display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
.spark polyline { fill: none; stroke: var(--color-navy-bright); stroke-width: 1.5; }
```

## Theme (NOC Light — primary)
Both theme files live in `sources/themes/` (`light.css` primary, `default.css` = dark NOC Navy kept for comparison). Contract shared by both:
- Navy `#1A3C79` (bright variant `#2C5CB4` light / `#3E6FC4` dark) is structural only.
- Severity tokens: `--color-critical/-warn/-ok/-stale` + matching `-dim` tints; darkened on light surfaces (ok `#0B8A51`, warn `#8F5D00`, critical `#D92638`).
- Light text scale (post readability fix): text `#0D1626`, muted `#34435E`, faint `#5A6880` — do not lighten; mono at text-xs eats contrast.
- Fonts: display "Saira Semi Condensed" (uppercase, letterspaced), data/labels "IBM Plex Mono", body "Inter".
- Radii tight (3/6/10px) — instruments, not bubbles.

## What to Avoid
- Signals mixed into the grade list or rail (the "feeling all one" failure).
- 2-column dimension panel grid (variant A, rejected) and severity-row list (variant C, rejected) — both lost to rail + evidence.
- Pale gray text on light surfaces (original light.css was "faint" per operator; fixed values above).
- Freshness stamps positioned absolutely or floated near buttons.
- Over-explained evidence: one mono line + one sparkline per dimension is the ceiling.

## Origin
Synthesized from sketch: 003 (winner Synthesis) + theme decision
Source: sources/003-console-panels.html, sources/themes/
