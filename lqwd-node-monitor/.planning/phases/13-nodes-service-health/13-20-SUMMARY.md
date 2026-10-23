---
phase: 13-nodes-service-health
plan: 20
subsystem: node-detail-forwards
tags: [forwards, afm-002, component-only, gap-closure]
requires:
  - "src/lib/console/forwards.ts (ForwardRow.fee_msat, ForwardRow.timestamp_ns)"
  - "src/lib/format/units.ts (feeMsatToSat, formatSats)"
provides:
  - "Forwards event-log table with Fees earned + Timestamp columns"
affects:
  - "/[pubkey]/forwards sub-route table"
tech-stack:
  added: []
  patterns:
    - "AFM-002 fee-sat derivation via feeMsatToSat (never raw fee / inline /1000)"
    - "ns → ms timestamp render via /1e6 (forwards.ts asOf precedent)"
key-files:
  created: []
  modified:
    - "src/components/node/NodeForwardsTable.tsx"
decisions:
  - "Component-only change — reader already projects fee_msat + timestamp_ns via SELECT *; no SQL/reader change."
metrics:
  duration: "~5 min"
  completed: "2026-07-10"
  tasks: 1
  files: 1
requirements: [NODE-04]
---

# Phase 13 Plan 20: Forwards Table Fees earned + Timestamp Columns Summary

Added per-forward **Fees earned** (AFM-002 sats via `feeMsatToSat`) and **Timestamp** (ns→ms via `/1e6`) columns to `NodeForwardsTable`, closing gap G10 — a component-only change since the reader already surfaces `fee_msat` and `timestamp_ns` on each `ForwardRow`.

## What Was Built

- **COLUMNS** extended with `{ label: "Fees earned", align: "right" }` and `{ label: "Timestamp", align: "right" }`, appended after "Amt out" — header order is Chan in / Chan out / Amt out / Fees earned / Timestamp.
- **Fees earned cell:** derives sats via `formatSats(feeMsatToSat(Number(row.fee_msat)))`, rendered as `{value} sat`; a null `fee_msat` renders a faint em-dash. Routes exclusively through the AFM-002 helper — the raw `fee` column is never read and no inline `/1000` appears.
- **Timestamp cell:** converts `row.timestamp_ns` (nanoseconds string) to ms with `/ 1e6`, wrapped in `new Date(...)` and rendered via `toLocaleString("en-US")` — a date render, not a sat unit (AFM-002 does not apply). Follows the documented forwards.ts asOf precedent.
- **AFM-002 header comment** updated to state per-forward fee sats are derived from `fee_msat` via `feeMsatToSat`, never raw fee; also documents the ns→ms timestamp conversion.
- Remains a Server Component — no `"use client"`, no new deps. Chan links and `SummaryStrip` (including the empty-state branch) preserved verbatim.

## Verification

- `grep -c "Fees earned"` ≥ 1, `grep -c "Timestamp"` ≥ 1, `grep -c "feeMsatToSat"` ≥ 1 — all pass.
- Raw fee usage: `grep -vE '^\s*(//|\*)' | grep -cE 'row\.fee[^_]'` == 0 (raw `fee` column never read in code).
- `npx tsc --noEmit` passes clean.
- Null-fee row renders "—"; populated rows show a fee-sat value and human-readable timestamp.

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- FOUND: src/components/node/NodeForwardsTable.tsx (modified)
- FOUND: commit cb5cd41
