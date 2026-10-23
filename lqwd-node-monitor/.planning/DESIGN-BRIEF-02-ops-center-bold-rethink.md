# Design Brief 02: NodeMonitor Ops Center — BOLD VISUAL RETHINK (v1: Overview)

> Paste the fenced block into claude.ai/design. This REPLACES the visual approach
> of brief 00/01 — it deliberately drops the old NOC-instrument tokens and grammar
> (mono-everything, no icons, tinted chips, packed density) because the operator
> found that look cold, cramped, flat, and dated. Authored 2026-06-19.

---

```markdown
# Design: NodeMonitor "Operations Center — Overview" — premium visual rethink

## Your role
You are a senior product designer with a strong visual eye. Design 2–3 GENUINELY
DISTINCT, premium visual directions for ONE screen, each as a self-contained,
interactive HTML/CSS file I can open in a browser and click through. Light mode.

This is a deliberate REDESIGN. An earlier version of this tool exists and its
information and structure are right — but its presentation fails: it feels COLD
and CLINICAL (like a raw terminal), CRAMPED (walls of tiny text), FLAT (nothing
pops, can't tell what matters), and DATED/UNREFINED. Your job is to fix all four
with a modern, considered, premium look. Do not reproduce a dense monospace
"instrument panel" aesthetic — push somewhere better.

## Quality bar
Aim for the polish of Linear, Vercel's dashboard, Stripe's dashboard, Raycast —
calm, confident, modern, beautiful, but still serious and information-dense
enough for a professional operator. NOT a toy, NOT a consumer app, NOT a
spreadsheet, NOT a 2015-era admin template.

## The product
NodeMonitor is the operations console for LQWD Technologies' fleet of ~26
Lightning Network nodes (mixed routing nodes + LSP nodes), each running on a
server with services like bitcoind. The operator opens this screen to answer one
question instantly: "What needs my attention right now, across the whole stack?"
It is an ATTENTION QUEUE — the urgent few surface loud; the healthy majority
recedes. They then act safely (some actions are exported as commands they run,
never executed silently by the dashboard).

## The screen: "Operations Center — Overview"
Design the top-level home. It must surface, with a clear hierarchy (most urgent
biggest/highest/loudest):

1. **An AI "WHAT NEEDS YOU NOW" summary** — 1–4 plain-language lines naming the
   most urgent situations and WHY, e.g. "bitcoind on host-7 stalled 22 min —
   3 nodes' pending HTLCs at risk." Clearly an AI voice, visually distinct,
   dismissible. Advisory only — it never shows a runnable command.
2. **The incident / attention queue** — prioritized rows of what's wrong, each
   with: a clear severity level, a short title, a one-line "why", and which layer
   it's on (server / service / bitcoind / Lightning node / storage). GROUP by root
   cause so one host outage doesn't spray 8 separate child alerts — show the
   rollup.
3. **A fleet-wide health overview** — at-a-glance counts/health across the layers
   (nodes, hosts, services, bitcoind, storage capacity). Make it glanceable.
4. **The healthy majority, collapsed** — e.g. "23 nodes healthy", expandable, out
   of the way.

Use realistic content: plausible node names, severities, and incidents — never
"Lorem" or "foo". Make it feel like a real fleet mid-incident.

## What to fix — be explicit about each
- NOT cold/clinical → warm, premium, human; something an operator is glad to open.
  Considered surfaces, light and tasteful depth, real visual craft.
- NOT cramped → generous spacing and grouping, breathing room, progressive
  disclosure (summarize, let detail expand). Density with rhythm, not a wall.
- MAKE IT POP → unmistakable hierarchy; severity reads in a glance (color + form +
  size + iconography working together); the worst thing is impossible to miss.
- REFINED/MODERN → a real type pairing, consistent spacing scale, alignment and
  rhythm, modern iconography, tasteful color. Nothing accidental.

## Creative freedom (this is a bold rethink)
You choose: typography, the full color palette, iconography, card vs list vs board
layouts, depth/shadow, motion-at-rest, how much density. Give each of the 2–3
directions a genuinely different PERSONALITY (e.g. one calm & editorial, one
vivid & data-forward, one focused & minimal) — don't ship three skins of the same
layout. Use modern icons freely (severity, layer types, actions).

## Guard rails (do not cross)
- Light theme only (no dark mode).
- **LQWD navy #1A3C79 is the brand anchor** — build a fuller, modern palette
  around it. NEVER use Bitcoin orange (#F7931A) or position this as a Bitcoin-
  retail product; this is enterprise infrastructure tooling.
- WCAG AA contrast minimum.
- Operator-grade: data must stay legible and scannable; severity unambiguous.

## Safety/truth cues to keep visible (don't design these away)
- The dashboard holds zero node credentials and never silently changes the fleet —
  high-risk actions are exported as commands the operator runs. Make that posture
  feel intentional, not hidden.
- The AI summary explains and prioritizes only; it never emits an executable command.
- Honest states: "stale / no data / unknown" must be representable, with a
  freshness indicator — never fake freshness.

## Deliver
Start with ONE short paragraph stating the information hierarchy you're designing
to. Then produce 2–3 self-contained interactive HTML directions for this screen.
For each: a name + one-line personality, and a few sentences on how it fixes the
four problems above. Mark ★ the one you'd ship and say why. Then ask me what to
push further.
```
