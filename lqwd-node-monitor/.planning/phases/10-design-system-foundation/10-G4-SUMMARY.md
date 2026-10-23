---
phase: 10
plan: G4
subsystem: design-system / df primitives
tags: [fidelity, primitives, two-axis-pip, severity-row, freshness-chip, impl-tag]
requires: [df-tokens, v2pulse-keyframe, severityAccent]
provides: [TwoAxisPip-tile, SeverityRow-record, FreshnessChip-relative, ImplTag-role]
affects:
  - src/components/df/TwoAxisPip.tsx
  - src/components/df/SeverityRow.tsx
  - src/components/df/FreshnessChip.tsx
  - src/components/df/ImplTag.tsx
tech-stack:
  added: []
  patterns: [arbitrary-animation-utility (animate-[v2pulse_..]), additive-optional-props, deprecated-prop-aliases]
key-files:
  created: []
  modified:
    - src/components/df/TwoAxisPip.tsx
    - src/components/df/TwoAxisPip.test.tsx
    - src/components/df/SeverityRow.tsx
    - src/components/df/SeverityRow.test.tsx
    - src/components/df/FreshnessChip.tsx
    - src/components/df/FreshnessChip.test.tsx
    - src/components/df/ImplTag.tsx
    - src/components/df/ImplTag.test.tsx
decisions:
  - Kept all changes additive (new optional props) + retained v1 prop aliases so the frozen design-system gallery keeps compiling without edits.
  - Applied v2pulse via the Tailwind v4 arbitrary-animation utility `animate-[v2pulse_1.5s_infinite]` (the keyframe already lives in globals.css; no new global token needed).
  - No Severity.ts change required — severityAccent + the existing ramp covered the square-dot record and tile chrome.
metrics:
  duration: ~25m
  completed: 2026-06-24
---

# Phase 10 Plan G4: Four-Primitive Fidelity Rebuild Summary

Rebuilt TwoAxisPip, SeverityRow, FreshnessChip, and ImplTag to prototype fidelity (ranked gaps #5 and #10) — boxed pulsing service tile, square-dot columnar record row, relative-age freshness chip, and role+impl tag — all via additive props so the frozen gallery compiles unchanged.

## What changed

### 1. TwoAxisPip — full service-tile rebuild (gap #5)
Replaced the inline-span pip with the prototype's complete service tile (Node Detail 154-187):
- **Tile chrome**: 4px left accent bar + per-state tint/border + `rounded-[13px]` card. Healthy → `border-l-df-ok` on white; unhealthy → `border-l-df-critical` on `bg-df-critical-tint`.
- **Pulsing alarm dot**: the status chip's dot now pulses via `animate-[v2pulse_1.5s_infinite]` in the up-but-dead and down states (the `v2pulse` keyframe from globals.css). Healthy stays static.
- **Boxed inset axes**: "Running" / "Functioning" are now bordered inset sub-panels (`AxisBox`) with a 9px uppercase caption + check/cross glyph + yes/no text. The Functioning box red-tints (`bg-df-critical-tint` / `border-df-critical-border`) when it fails — the "up but dead" state now reads clearly alarming.
- **Last-run footer row**: added the divided footer's `last run` row (e.g. "failed 41m ago", red via `text-df-critical` when "failed") alongside `last heartbeat` (gold via `text-df-stale-text` when "stale") and `errors · 1h`.
- New optional props: `name`, `lastRun` (additive; `running`/`functioning`/`heartbeat`/`errorCount` unchanged).

### 2. SeverityRow — square-dot columnar record (gap #10)
Rebuilt to the prototype grouped-child row (Ops Center 213-223):
- **2px SQUARE accent dot** (`rounded-[2px]` + `severityAccent[sev]`), never round.
- **`id · kind · note · detail` columnar record**: mono node id, neutral `kind` chip (`bg-df-border-soft`, not severity-tinted), note clause, right-pinned faint mono `detail`.
- **Dropped the invented "open →" affordance and the sev-label + icon** — the prototype child row relies on the square dot alone.
- New columnar props `id/kind/note/detail`; v1 `identity`/`evidence` retained as deprecated aliases (backfill `id`/`note`) so the frozen gallery still compiles.

### 3. FreshnessChip — relative time (gap #10)
- Switched from absolute UTC `Intl.DateTimeFormat` stamps to a **relative age** ("4s ago", "4m ago", "4h ago", "4d ago") via a `relativeAge(asOf, now)` helper that buckets s/m/h/d and clamps future timestamps to "0s ago".
- Labels now read "data fresh · 4s ago" / "STALE — last good 41m ago" matching the prototype's glanceable recency.
- Kept the shape-distinct honest-stale (square dot + dashed + gold) and the honest `asOf === null → "no data yet"` early-return.
- New optional `now` prop for deterministic SSR/tests (defaults to `new Date()`).

### 4. ImplTag — role + impl label (gap #10)
- Default label is now the two-part `"Routing · LND"` / `"LSP · LDK"` (Node Detail line 88) instead of the bare `LND`/`LDK`.
- New optional `withRole` prop (defaults `true`); `withRole={false}` yields the compact impl-only badge.
- df-lnd / df-ldk tokens unchanged — never the NOC navy.

## Tests
Each component's test was updated for the new structure/states (all states preserved where applicable):
- **TwoAxisPip**: 6 tests — green-only-when-both, pulsing up-but-dead, boxed axis panels, pulsing DOWN, last-run/heartbeat/errors footer (failed=red, stale=gold), non-failed last-run.
- **SeverityRow**: 4 tests — id·kind·note·detail across all 5 severities, square-dot/no-affordance/no-sev-label assertion, formatSats note, optional-column drop.
- **FreshnessChip**: 4 tests — stale shape + relative age, honest no-data, fresh round dot + relative age, s/m/h/d bucketing + future-clamp.
- **ImplTag**: 3 tests — "Routing · LND" / "LSP · LDK" two-part labels with correct tokens, withRole=false compact, never-NOC-navy guard.

## Deviations from Plan
None — plan executed as written. All changes additive; v1 prop aliases preserved on SeverityRow specifically to honor the "gallery keeps compiling, do not edit gallery" constraint.

## Deferred / Out-of-scope Issues
- `src/components/df/EvidenceChart.test.tsx` has 7 pre-existing `TS18047: 'model' is possibly 'null'` type errors. This file is NOT owned by G4 and was not touched — logged here per the scope boundary; another agent owns EvidenceChart.

## Self-Check
- `CI=true npx vitest run --pool=forks --no-file-parallelism src/components/df` → **41 passed (10 files)**.
- `npm run lint:noc-guard` → **exit 0, "v2 surfaces clean"**.
- `tsc --noEmit` on the four touched components + the gallery → **zero errors** (only the unrelated pre-existing EvidenceChart.test.tsx errors remain).
- No `next build` run (forbidden). Only the four primitives + their tests modified (Severity.ts untouched).

## Self-Check: PASSED
