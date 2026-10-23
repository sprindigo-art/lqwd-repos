---
phase: 14-hosts-infra-monitoring
plan: 01
subsystem: design-system
tags: [df-primitive, threshold-meter, tdd, gallery, d-03]
requires: []
provides:
  - "ThresholdMeter df primitive (D-03) — the severity fill meter every Wave-2 HOST-01/HOST-02 composition consumes"
  - "/design-system gallery Section covering all severity states + stale + 0%/100% edges"
affects:
  - 14-02 and all Wave-2 plans (HOST-01 card CPU/MEM/DISK meters, HOST-02 storage volume rows)
tech-stack:
  added: []
  patterns:
    - "severityAccent[sev] class lookup (no if-chain) for the fill hue"
    - "honest-stale gold dashed + repeating-linear-gradient hatched track with NO fill"
key-files:
  created:
    - src/components/df/ThresholdMeter.tsx
    - src/components/df/ThresholdMeter.test.tsx
  modified:
    - src/app/(design)/design-system/page.tsx
    - src/app/(design)/design-system/fixtures.ts
key-decisions:
  - "aria-valuenow reports the CLAMPED pct (valid ARIA requires valuenow within min/max) — pct=140 exposes 100"
  - "Stale hatch uses a repeating-linear-gradient of --color-df-stale-border over the df-stale-tint track, echoing StaleChart's gold stripes without SVG"
  - "Gallery stale cell shows a mono em-dash value — never a fresh-looking number off stale data"
duration: 6min
completed: 2026-07-13
---

# Phase 14 Plan 01: ThresholdMeter df Primitive (D-03) Summary

**One-liner:** Presentation-pure 6px severity-fill meter (`severityAccent[sev]` fill, honest-stale gold hatched track with no fill) shipped TDD-first with 7 vitest behaviors and registered in the /design-system gallery across all ramp states + stale + 0%/100% edges.

## What Was Built

- **`ThresholdMeter.tsx`** — the ONE sanctioned Phase-14 design-system addition. Server Component (no `"use client"`), props `{ pct, sev, stale?, label?, className? }`. 6px `rounded-df-pill` track on `df-border-soft`; fill class comes exclusively from `severityAccent[sev]` (zero `if (sev ===` chains); fill width is the literal clamped pct. `stale=true` renders the gold `df-stale-*` dashed + hatched track with NO severity fill — a meter can never paint green or red off old data (T-14-01). The component never derives severity from pct (T-14-02, the 12-10 lesson) — callers compute `sev` from read-time bands.
- **`ThresholdMeter.test.tsx`** — 7 tests via the existing `renderToStaticMarkup` df harness: per-sev ramp class, literal pct width, [0,100] clamp edges (0/100/140/−5), stale-no-fill (asserts every ramp class absent), `role="meter"` + aria attrs, default aria-label fallback, `cn()` merge.
- **Gallery registration** — `THRESHOLD_METER_FIXTURES` (deterministic constants, no Date.now/fetch — T-10-10) driving a `<Section name="ThresholdMeter">` with cells for critical/warning/watch/healthy, the stale treatment, and the 0%/100% edges; every cell renders the adjacent mono value (never color alone).

## Task Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 (RED) | `5b4aeac` | test(14-01): failing ThresholdMeter D-03 contract tests |
| 1 (GREEN) | `c6d24f1` | feat(14-01): implement ThresholdMeter df primitive |
| 2 | `b146959` | feat(14-01): register ThresholdMeter in the /design-system gallery |

## Verification Evidence

- `npx vitest run src/components/df/ThresholdMeter.test.tsx` → 7/7 passed
- `npx tsc --noEmit` → exit 0
- `npx eslint` on all four touched files → clean
- Acceptance greps: `severityAccent\[` ≥ 1 ✓ · `if (sev ===` = 0 ✓ · `"use client"` = 0 ✓ · `ThresholdMeter` in gallery page = 4 (≥ 2) ✓
- No package.json diff — zero packages installed (T-14-SC honored)
- D-02 boundary holds: the only new df files are ThresholdMeter.tsx + its test

## Deviations from Plan

### Scope-boundary note (not a code deviation)

**Repo-wide `npm run lint` exits non-zero from 4 PRE-EXISTING errors** unrelated to this plan (`.prototype-snapshot/support.js` ×2, `NavRailShell.test.tsx`, `ServiceHealthGrid.tsx`) — verified present on the base commit `74a8b8d` with this plan's changes stashed. All touched files lint clean when linted directly. Per the scope boundary rule these were NOT fixed; logged in `deferred-items.md`.

No other deviations — plan executed as written.

## TDD Gate Compliance

RED (`5b4aeac` test commit, verified failing) → GREEN (`c6d24f1` feat commit, 7/7 passing). No refactor pass needed.

## Known Stubs

None — the primitive is fully wired and the gallery renders from real fixtures.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema surface; purely presentational primitive + static-fixture gallery.

## Self-Check: PASSED

All created files exist on disk; commits 5b4aeac, c6d24f1, b146959 verified in git log; working tree clean; no unintended deletions.
