---
phase: 02-fleet-overview-health-scorecard
plan: "05"
subsystem: ui
tags: [shadcn, tailwind-v4, scorecard, design-system, presentational-components]
requires:
  - phase: 02-02
    provides: "ScorecardView/GradedDimension/PeerRelative type contracts (@/lib/scorecard/types)"
provides:
  - "shadcn/ui initialized: components.json + vendored card/table/badge/tooltip primitives"
  - "6 health-status tokens in globals.css @theme (ok/warn/critical/nodata/stale/outlier)"
  - "6 presentational scorecard components: GradeBadge, CriticalChip, OutlierMarker, BackendBadge, FreshnessStamp, DimensionRow"
affects:
  - "02-06/02-07 (Wave 4 pages compose these components)"
tech-stack:
  added:
    - "class-variance-authority ^0.7.1 (shadcn dependency, allowlisted)"
    - "radix-ui ^1.5.0 (shadcn dependency, allowlisted)"
  patterns:
    - "Tailwind v4 CSS-first @theme tokens — status palette is a separate family from brand navy"
    - "Presentational server-renderable components: color arrives as a prop, never re-derived (D-07/T-02-07)"
    - "State precedence enforced structurally via early return (nodata > partial > peer-relative)"
key-files:
  created:
    - components.json
    - src/components/ui/card.tsx
    - src/components/ui/table.tsx
    - src/components/ui/badge.tsx
    - src/components/ui/tooltip.tsx
    - src/components/scorecard/GradeBadge.tsx
    - src/components/scorecard/CriticalChip.tsx
    - src/components/scorecard/OutlierMarker.tsx
    - src/components/scorecard/BackendBadge.tsx
    - src/components/scorecard/FreshnessStamp.tsx
    - src/components/scorecard/DimensionRow.tsx
  modified:
    - src/app/globals.css
    - package.json
    - package-lock.json
decisions:
  - "Inlined shadcn dist/tailwind.css verbatim into globals.css instead of taking shadcn as a runtime dependency (outside T-02-SC allowlist)"
  - "Each tooltip usage wraps its own TooltipProvider so components stay self-contained drop-ins"
metrics:
  duration: "~2 sessions (interrupted by provider quota limit mid-plan, resumed by continuation executor)"
  completed: "2026-06-09"
  tasks: 3
  files: 14
---

# Phase 2 Plan 05: Scorecard UI Components Summary

**shadcn/ui initialized with a 6-token health-status palette and six presentational scorecard components that structurally enforce the red-is-Tier-1-only color contract (D-05/D-07/D-12/D-13/D-01).**

## What Was Built

### Task 1 — shadcn init + status tokens (commit 2b5834c)
- `npx shadcn@latest init` + `add card table badge tooltip` — components.json with `@/components` and `@/lib/utils` aliases, 4 vendored primitives in `src/components/ui/`.
- globals.css retains `--color-brand: #1A3C79`, `--color-brand-light: #2A5299`, dark `:root` values (#0b0e14/#f3f4f6), and `@import "tw-animate-css"`; adds the 6 status tokens in `@theme`:
  `--color-status-ok: #22c55e`, `--color-status-warn: #eab308`, `--color-status-critical: #dc2626`, `--color-status-nodata: #6b7280`, `--color-status-stale: #a16207`, `--color-status-outlier: #8b5cf6`.
- No `#F7931A` anywhere under src/. No chart block added.

### Task 2 — Signal atoms (commit d0e9f65)
- **GradeBadge** — dot + letter glyph (16px/600) + tabular-nums pct. Dot maps 1:1 from props via a `Record` lookup; zero letter→color or pct→color derivation (color decided in grade.ts only).
- **CriticalChip** — `🔴 critical: {label}` Badge on `bg-status-critical`; the only chip wearing red.
- **OutlierMarker** — `◆ Worst-in-fleet` on the violet `status-outlier` token (never red), verbatim MAD tooltip with `{backend}` interpolation.
- **BackendBadge** — LND navy `bg-brand` / LDK `bg-brand-light`; replaces the Phase 1 inline-style badge pattern.

### Task 3 — Composite cells (commit 4d0886a)
- **FreshnessStamp** — `data as of {date}` (en-CA date-only format, UTC); stale state renders `⚠ Stale — data as of {date}` on `status-stale` with the verbatim threshold tooltip plus per-table breakdown rows; `asOf: null` renders "no data yet".
- **DimensionRow** — `{name} {dot} {letter} {pct}% — {rawDisplay}` per D-05. Strict precedence `nodata > partial > peer-relative` enforced via early return: a `color: "nodata"` dimension renders only "No data — needs log ingestion" and can never show a peer-baseline label or outlier marker. Tier-1 breach renders CriticalChip inline. `rawDisplay` arrives pre-formatted (no unit math in the component).

## Supply-Chain Evidence (T-02-SC)

package.json dependency diff from the shadcn CLI:

```diff
+    "class-variance-authority": "^0.7.1",   // allowlisted
+    "radix-ui": "^1.5.0",                   // allowlisted
-    "tailwind-merge": "^3.5.0",
+    "tailwind-merge": "^3.6.0",             // version bump of existing dep, not a new package
```

No out-of-allowlist additions. Official shadcn registry only (`registries: {}` in components.json).

## Verification

- `npx tsc --noEmit` — green
- `npm run build` — succeeds (server-component purity holds; `/` dynamic, `_not-found` static)
- `npx vitest run` — 70 passed, 4 skipped (10 files)
- All UI-SPEC verbatim strings greppable; zero `style={{` in `src/components/scorecard/`; no `#F7931A` under src/; OutlierMarker contains no `status-critical` class; no scorecard component imports any `src/lib/db` module

## Deviations from Plan

### Process deviations

**1. Provider quota interruption mid-plan**
- The original executor was terminated by a provider quota limit after writing Task 1's files but before any commit. A continuation executor verified the uncommitted shadcn init against Task 1's requirements and committed it, then completed Tasks 2-3.

**2. [Rule 3 - Blocking] Worktree missing `.env.local` broke `npm run build`**
- **Found during:** Task 1 verification
- **Issue:** `npm run build` failed at page-data collection with `Missing required env: ROUTING_VM_DATABASE_URL` — git worktrees do not share git-ignored env files with the main checkout.
- **Fix:** Copied `.env.local` from the main checkout into the worktree (stays git-ignored, never committed). No code change.

**3. [Rule 3 - Blocking, pre-existing from prior executor] shadcn CLI emitted a runtime `shadcn` dependency**
- The CLI's generated globals.css imported `shadcn/tailwind.css`, requiring `shadcn` as a runtime package — outside the T-02-SC allowlist. The previous executor inlined the pure-CSS file (keyframes + data-state variants + one utility) verbatim into globals.css instead. Verified intact and committed as part of Task 1.

## Known Stubs

None — all six components are fully wired to their typed props; no placeholder data paths.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema changes. Components are presentational with serializable props only (T-02-02 mitigation upheld).

## Self-Check: PASSED

All 11 created files exist on disk; commits 2b5834c, d0e9f65, 4d0886a verified in git log.
