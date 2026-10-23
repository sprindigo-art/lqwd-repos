# Grade & Signal Unit

## Design Decisions
- **Tinted chip won** over a bare colored letter (A) and a severity-underline treatment (C). The grade letter sits in a faint severity-tinted chip with a hairline border of the same hue. Most scannable in dense lists; survived the "13 healthy cards each carrying a chip" noise test.
- The letter takes its **StatusColor** (`ok | warn | critical | nodata`) — NOT a letter-band color. This preserves D-07: only tier-1 breaches make anything red.
- **No dot, no emoji, ever.** The chip replaces the rejected D-14 dot+letter unit.
- Percentage appears in exactly two places: the chip's tooltip (`title="71% composite"`) everywhere, and as text next to the composite chip in the console header only.
- No-data dimensions render an en-dash chip (`–`) in the gray nodata tint — deliberately inert, not broken.
- Signals (breaches, outliers) are always separate text elements, never fused into the grade unit.

## CSS Patterns
```css
/* The chip — letter colored by StatusColor, tinted bg, matching hairline border */
.chip {
  font-family: var(--font-mono); font-weight: 600; display: inline-flex;
  align-items: center; justify-content: center; border-radius: var(--radius-sm);
  padding: .1em .45em; border: 1px solid;
}
.chip.ok       { color: var(--color-ok);       background: var(--color-ok-dim); }
.chip.warn     { color: var(--color-warn);     background: var(--color-warn-dim); }
.chip.critical { color: var(--color-critical); background: var(--color-critical-dim); }
.chip.nodata   { color: var(--color-stale);    background: var(--color-stale-dim); }
/* Implementation note: derive border-color from the severity token
   (e.g. color-mix(in srgb, var(--color-ok) 30%, transparent)) rather than
   the hardcoded rgba values used in the throwaway sketches. */
```

Size scale used across contexts (font-size on the chip):
- Composite header: 24–26px
- Queue row: 18px
- Dimension tile/row: 15px
- Healthy card / rail list: default (inherits ~0.85rem)

## HTML Structures
```html
<span class="chip warn" title="71% composite">C</span>   <!-- graded -->
<span class="chip nodata" title="no data">–</span>        <!-- no-data dim -->
```

## What to Avoid
- Bare colored letter (rejected): too quiet in dense lists; loses scannability at small sizes.
- Severity underline (rejected): bar reads as decoration at dimension-tile size; letter color ambiguity.
- Colored dot next to an uncolored letter — the original rejected pattern.
- Showing pct inline anywhere except the composite header.

## Origin
Synthesized from sketch: 002 (winner B)
Source: sources/002-grade-signal-unit.html
