# Design explorations — drop folder

Drop claude.ai/design output here for Claude Code to implement. Per exploration:

1. **The code** — the chosen direction's HTML/React, e.g.
   `ops-center-overview-WINNER.html`. Optionally drop the other 1–2 directions too
   (named `-A` / `-B`) for reference. (If you can't save the file, paste the code
   into chat instead.)
2. **Screenshots** (PNG) — the default view + key states (expanded incident,
   collapsed healthy, copy-command). Named e.g. `ops-center-overview-default.png`,
   `ops-center-overview-incident-expanded.png`. These let Claude verify the build
   matches and catch things code alone won't show.
3. **A note** — which direction won and anything you edited or want different
   (a `CHOSEN.md` here, or just say it in chat).

## What Claude Code does with it
Reads the code + screenshots → extracts a NEW design system (tokens: color, type
scale, spacing, radii, shadows; the visual grammar) → writes a fresh design
reference that REPLACES the rejected NOC-instrument look → rebuilds the screen
for real in the Next.js app (shadcn + real components, wired to live data) via a
GSD workflow. The prototype is reference, not dropped in verbatim.
