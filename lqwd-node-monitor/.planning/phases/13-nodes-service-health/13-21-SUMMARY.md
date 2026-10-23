---
phase: 13-nodes-service-health
plan: 21
subsystem: node-detail-ui
tags: [design-system, color-law, liquidity-gauge, gap-closure]
requires: [NODE-04, DS-01]
provides:
  - "LiquidityGauge navy-local / grey-remote reference-color split (lg + sm variants)"
affects:
  - src/components/node/LiquidityGauge.tsx
tech-stack:
  added: []
  patterns:
    - "Reference-vs-severity color boundary: navy (df-brand) marks the local side as a REFERENCE distinction, never a health signal"
key-files:
  created:
    - .planning/phases/13-nodes-service-health/13-21-SUMMARY.md
  modified:
    - src/components/node/LiquidityGauge.tsx
decisions:
  - "Local segment fill changed from bg-df-muted to bg-df-brand (navy reference); remote kept neutral grey (df-slate/40)"
  - "Centre 50% mark and thumb kept neutral — they mark position, not a side"
  - "Relaxed the neutral-only grep gate to permit navy+grey while still forbidding the severity ramp (df-crit/warn/ok/watch, red/amber/green)"
metrics:
  duration: ~5m
  completed: 2026-07-10
  tasks: 1
  files: 1
---

# Phase 13 Plan 21: Liquidity Gauge Navy-Local / Grey-Remote Reference Colors Summary

Closed G12 by giving the `LiquidityGauge` distinguishable REFERENCE colors — brand navy for the local side, neutral grey for the remote side — so the local-vs-remote lean reads at a glance without ever invoking the health severity ramp.

## What Was Built

- **Local segment recolor:** `bg-df-muted` → `bg-df-brand` (navy `#1A3C79`), the sanctioned structural/reference hue for the local side.
- **Remote segment:** kept neutral grey (`bg-df-slate/40`) so the navy/grey split reads clearly.
- **Centre mark + thumb:** left neutral (they mark position, not a side).
- **Honest-empty branch:** preserved verbatim — no thumb, no fabricated centred bar.
- **COLOR LAW header comment rewritten:** navy/grey are a REFERENCE distinction (never "good/bad"); severity ramp (red/amber/green, df-crit/warn/ok/watch) remains forbidden here; navy is reference, NOT navy-as-health.
- **Grep gate relaxed:** the old neutral-only assertion now permits exactly navy + grey present while still asserting the severity ramp is absent (verified across non-comment lines).

The recolor flows through to the `size="sm"` per-peer variant consumed by `NodePeersTable` with no prop or signature change (pure presentational change). Server Component, no new deps.

## Verification

Plan acceptance gate passed:
- `grep -c "bg-df-brand"` ≥ 1 (navy local present)
- `grep -Ec "df-slate"` ≥ 1 (grey remote present)
- Severity-ramp count on non-comment lines == 0 (no df-crit/warn/ok/watch, no red/amber/green)
- `npx tsc --noEmit` clean

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/components/node/LiquidityGauge.tsx (modified, bg-df-brand present)
- FOUND: commit 858b392 (gauge recolor)
