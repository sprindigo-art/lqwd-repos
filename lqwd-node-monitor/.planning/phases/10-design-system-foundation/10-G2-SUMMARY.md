---
phase: 10
plan: G2
subsystem: design-system / df primitives
tags: [blast-radius, why-chain, timeline, svg, ssr, gap-closure]
requires:
  - df severity ramp (Severity.ts)
  - df tokens (lib/df/tokens.ts) + globals.css df-* utilities
  - v2flow keyframe (globals.css)
provides:
  - BlastRadius primitive (root-cause → impacted-nodes SVG diagram)
  - WhyChain primitive (detection-chain timeline spine)
affects:
  - Future hero-card / incident-card composition (these two were the unbuilt #3/#4 gaps)
tech-stack:
  added: []
  patterns:
    - Pure-SVG / plain-HTML SSR primitive (renderToStaticMarkup-renderable, no Recharts)
    - df hexes via tokens.ts for SVG fill/stroke (CSS vars don't resolve SSR-safe)
    - canonical Severity ramp re-keyed onto prototype evColors
key-files:
  created:
    - src/components/df/BlastRadius.tsx
    - src/components/df/BlastRadius.test.tsx
    - src/components/df/WhyChain.tsx
    - src/components/df/WhyChain.test.tsx
  modified: []
decisions:
  - WhyChain consumes the canonical 5-state Severity ramp (not the prototype's info/warn/crit keys) and maps healthy→the prototype neutral "info" timeline row
  - BlastRadius height scales with target count so 1..N targets stay centered (prototype hard-coded 3)
metrics:
  duration: ~25m
  completed: 2026-06-24
---

# Phase 10 Plan G2: BlastRadius + WhyChain Primitives Summary

Built the two prototype primitives the codebase entirely lacked (ranked fidelity gaps #3 and #4): **BlastRadius** — the host→N-targets animated dashed-edge diagram with root-cause + HTLC-at-risk labels — and **WhyChain** — the per-severity dot-and-line detection-chain timeline spine. Both are props-driven, pure SVG/HTML, and SSR-renderable under `renderToStaticMarkup`.

## What was built

### BlastRadius (`src/components/df/BlastRadius.tsx`)
Ported from the locked snapshot `blastRadius()` (Ops Center v2, lines 533–558). A host/root-cause card on the left fans out to `targets.length` impacted-node pills on the right via dashed, `v2flow`-animated red bezier edges, each terminating in a small dot. The host card carries the soft halo ring, the mini node-"stack" glyph, the mono `host-03` id, the red `bitcoind stalled` status line, and the `ROOT CAUSE · FIX HERE` eyebrow. Target pills show a mono node id + a muted-red at-risk note.

Props: `{ host, hostStatus, targets: [{ name, note }], rootCauseLabel? }`. Unlike the prototype's hard-coded 3 targets, the canvas height + vertical centering scale with `targets.length` (verified for 1 and 6).

### WhyChain (`src/components/df/WhyChain.tsx`)
Ported from `evColors`/`buildTimeline` (lines 686–688) and the expand-drawer timeline markup (lines 192–203). A vertical timeline: each event is a severity-colored dot, a connector down to the next event (transparent on the last so the spine terminates), a mono timestamp, and AA-ink event text.

Props: `{ events: [{ time, text, severity }], label? }`. Consumes the canonical `Severity` ramp; the per-severity dot/connector hexes ARE the prototype `evColors` values re-keyed onto the canonical ramp (critical→crit, warning→warn, watch, stale; healthy→the prototype neutral "info" row).

## Verification

- `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` → **12 files / 46 tests pass** (10 new across the two shape tests).
- `npm run lint:noc-guard` → **v2 surfaces clean** (exit 0).
- `eslint` on the 4 new files → clean (exit 0).
- NO `next build` run (per constraints).

Shape tests cover: BlastRadius structure (host card, eyebrow, status, critical accent), one animated dashed edge + one pill **per target**, the **1..N scaling** (1 target → singular aria + 1 edge; 6 targets → 6 edges), and custom root-cause label. WhyChain covers: eyebrow + every timestamp/sentence, **per-severity dot colors across all five ramp states**, the **transparent terminal connector**, a single-event chain, and custom label.

## Deviations from Plan

None — plan executed exactly as written. Two notes:
- The noc-guard regex matches literal forbidden token *strings* anywhere (including comments). Initial doc comments mentioned `--color-status-*` to explain the color discipline and tripped the guard; reworded to "the legacy NOC chrome tokens" — a comment-only adjustment, no behavior change.
- `df-faint` (`#9AA3B4`, flagged DECORATIVE-ONLY) is used only for the eyebrow caption and the mono timestamp — both decorative metadata matching the prototype; the load-bearing event text uses `text-df-ink`.

## Known Stubs

None. Both components are fully props-driven with no hardcoded data sources, placeholder text, or TODOs. The prototype's literal demo strings (`host-03`, `bitcoind stalled`, etc.) appear only in tests as fixtures, never baked into the components.

## Constraints honored

- Only the 4 new files touched; no edits to globals.css, tokens.ts, or any existing df/* primitive.
- Consumed existing df-* tokens + `v2flow` keyframe; added no global tokens.
- Both SSR-renderable (no Recharts) so `renderToStaticMarkup` works directly.

## Self-Check: PASSED

- FOUND: src/components/df/BlastRadius.tsx
- FOUND: src/components/df/BlastRadius.test.tsx
- FOUND: src/components/df/WhyChain.tsx
- FOUND: src/components/df/WhyChain.test.tsx
- Commit: d63a764 (verified on branch gap-g2).
