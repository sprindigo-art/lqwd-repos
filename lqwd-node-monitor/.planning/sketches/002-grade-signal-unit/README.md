---
sketch: 002
name: grade-signal-unit
question: "What does a grade/signal unit look like without the dot or emoji?"
winner: "B"
tags: [component, grade, density]
---

# Sketch 002: Grade / Signal Unit

## Design Question
The D-14 dot+letter unit was rejected ("the grade can be colored instead of having a color next to reg letter"). What treatment should the colored letter itself get, and does it hold up at every size it appears?

## How to View
open .planning/sketches/002-grade-signal-unit/index.html

## Variants (side-by-side columns, not tabs)
- **A: Bare letter** — the letter colored by status, nothing else. Quietest; relies on the mono weight.
- **B: Tinted chip** — letter in a faint severity-tinted chip with a hairline border. Most scannable in dense lists; adds visual weight everywhere.
- **C: Severity underline** — neutral letter with a thick colored bar beneath. Letter stays readable at any color-blindness; bar carries state.

## What to Look For
- Each treatment is shown in all four real contexts: queue row, healthy card, dimension tile, composite header (the only place a % appears).
- "No data" state (–) must look deliberately inert, not broken.
- Does B's chip start to feel like noise when 13 healthy cards each carry one?
- Does C survive at dimension-tile size (smallest)?
- Hover any letter — the pct tooltip is the agreed home for percentages.
