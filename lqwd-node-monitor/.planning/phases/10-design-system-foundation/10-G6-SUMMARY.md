---
phase: 10
plan: G6
subsystem: design-system / df primitives
tags: [severity-card, hero-card, composition, ds-02, fidelity-gap]
requires: [EvidenceChart, EvidencePanel, BlastRadius, WhyChain, AiReadPanel, SeverityRow, CommandModal, ImplTag, FreshnessChip, Severity]
provides: [SeverityCard (full v2), SeverityHeroCard, chartAccentFor]
affects: [src/components/df/SeverityCard.tsx, src/components/df/SeverityHeroCard.tsx]
tech-stack:
  added: []
  patterns: [server-component-composing-client-primitives, additive-back-compat-props, ssr-chrome-assert-not-recharts-svg]
key-files:
  created:
    - src/components/df/SeverityHeroCard.tsx
  modified:
    - src/components/df/SeverityCard.tsx
    - src/components/df/SeverityCard.test.tsx
decisions:
  - Rebuilt SeverityCard to full prototype fidelity by COMPOSING existing df/* primitives, not reimplementing them.
  - Renamed the grouped-children prop to `childAlerts` so the v1 gallery's JSX `children` body still compiles (back-compat).
  - Hero split into its own co-located SeverityHeroCard.tsx (distinct grammar from the queue card).
metrics:
  duration: ~30m
  completed: 2026-06-24
---

# Phase 10 Plan G6: SeverityCard Full-Fidelity Rebuild (+ Hero variant) Summary

Rebuilt the `SeverityCard` from a one-line header strip to the full Data-Forward v2
incident card, and added the `SeverityHeroCard` "Top priority" block — closing ranked
fidelity gaps #2 (SeverityCard) and #3 (hero/blast-radius) by COMPOSING the Wave-A
primitives rather than reimplementing them.

## What was built

### Standard `SeverityCard` (`src/components/df/SeverityCard.tsx`)
The header strip now carries the full prototype composition below the title:

1. **Header grammar** — a 38×38 washed **icon tile** (per-severity wash from tokens) +
   a white-on-accent **sev chip** (`severityAccent`) + the title + an optional gold
   dashed **STALE DATA pill**.
2. **Inline evidence panel** — the 212px inset, composing `EvidencePanel` + `EvidenceChart`
   (label + bold value + note + sparkline). Hidden on `<sm` (no horizontal room).
3. **Meta row** — layer chip (`ImplTag` "Routing · LND"), freshness (`FreshnessChip`,
   relative age), and a chevron **expand toggle** (rotates 90° when expanded).
4. **Expand drawer** — animated with the existing `v2drop` keyframe; a 2-col grid with the
   **why-chain timeline** (`WhyChain`), an **AI-read callout** (`AiReadPanel`), grouped
   **child rows** (`SeverityRow`), and an **export affordance** (`CommandModal`).

Every region is OPTIONAL and degrades gracefully — a bare `{ sev, title }` card still
renders; the v1 JSX-`children`/`body` evidence line is preserved as a back-compat muted
body line.

### `SeverityHeroCard` (`src/components/df/SeverityHeroCard.tsx`)
The prototype "Top priority" hero block:
- "Top priority" eyebrow + rule, a **pulsing CRITICAL chip** (`v2pulse` dot), a
  "ROOT CAUSE · N nodes roll up" chip, and a "data fresh · Ns" indicator.
- 23px **headline** + multi-line **narrative** + **meta chips**.
- The **392px evidence sparkline panel** (`EvidencePanel`/`EvidenceChart`, `height=104`,
  `area:'above'`, threshold + note).
- The **BLAST RADIUS** diagram (`BlastRadius`) inside the prototype's `#FCF8F7`/`#F2E0DD`
  section, with the green-check **resolution callout**.
- Footer **expand toggle** + navy **primary action** (`CommandModal`), and an expand grid
  (why-chain + AI grouping + grouped children) under `v2drop`.

## Composition over reimplementation
No primitive was edited. The two card files IMPORT and arrange: `EvidenceChart`,
`EvidencePanel`, `BlastRadius`, `WhyChain`, `AiReadPanel`, `SeverityRow`, `CommandModal`,
`ImplTag`, `FreshnessChip`, plus `Severity` (ramp). `chartAccentFor(sev)` is the one new
exported helper (maps a severity to its bright accent hex from `tokens.ts`), shared by both
cards.

## SSR contract
Both cards are Server Components. The composed `"use client"` primitives (EvidenceChart,
AiReadPanel, CommandModal) render their SSR-safe **chrome** server-side; only the Recharts
SVG plot is client-only. Tests therefore assert the surrounding card chrome (evidence-panel
label/value/note, BlastRadius SVG, WhyChain spine, AI band safety label) under
`renderToStaticMarkup`, never the Recharts `<svg>`.

## Deviations from Plan

### [Rule 3 - Blocking] Renamed grouped-children prop to `childAlerts`
- **Found during:** gallery compile check (tsc on `src/app/(design)`).
- **Issue:** The v1 gallery passes the evidence line as JSX `children` (a `ReactNode`).
  My first cut typed the grouped-children prop as `children: SeverityChild[]`, which
  collided with the gallery's JSX body → `TS2322` in `design-system/page.tsx`.
- **Fix:** Renamed the grouped-children array prop to `childAlerts` on both cards, and kept
  a back-compat `children?: ReactNode` that falls through to the muted body line (`body`
  wins if both given). The frozen gallery now compiles unchanged.
- **Files modified:** SeverityCard.tsx, SeverityHeroCard.tsx, SeverityCard.test.tsx.

## Constraint compliance
- **No tokens/globals edits.** Consumed existing df-* tokens + `v2drop`/`v2pulse`/`v2flow`
  keyframes. A handful of prototype one-off hexes (`#FCF8F7`/`#F2E0DD`/`#9A5B55`/`#F2E5E3`
  for the blast-radius section wash/border, which have no DF token) are component-local
  literals, mirroring the precedent already set inside `BlastRadius`/`EvidenceChart`. No
  new global token is required.
- **Additive props only.** Existing callers + the gallery keep compiling.
- **Only SeverityCard (+ new SeverityHeroCard) files written.** All other primitives are
  imported, not edited.

## Self-check gates (mandated)
- `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` →
  **13 files, 101 tests passed**.
- `npm run lint:noc-guard` → **v2 surfaces clean (exit 0)**.
- `npx tsc --noEmit` → **0 errors** (full repo, incl. df + `(design)` gallery).
- `eslint` on the three changed files → clean (no output).
- Known pre-existing `src/lib/queue/*` Postgres permission-denied failures were not run /
  not in scope (df-scoped vitest only). No `next build` (env hang). No `timeout` used.

## Known Stubs
None. Both cards are fully props-driven with graceful empty states; no hardcoded
empty/placeholder data flows to UI.
