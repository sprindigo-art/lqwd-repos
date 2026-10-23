---
phase: 13-nodes-service-health
plan: 07
subsystem: node-detail-read-sections
tags: [ui, node-detail, df-composition, lightning, read-only]
requires:
  - "df/* locked primitives (SeverityCard, EvidenceChart, StaleChart, FreshnessChip, CommandModal, AiReadPanel, WhyChain, ImplTag)"
  - "console/* tables (SummaryStrip, EventTable, ExportButton)"
  - "console/* reads (channels/fees/liquidity/forwards/peers TabData)"
  - "src/lib/format/units.ts (feeMsatToSat/formatSats — AFM-002)"
  - "src/lib/overview/service-display.ts (serviceDisplay relabel)"
provides:
  - "src/components/node/NodeHeader.tsx (B1 identity header)"
  - "src/components/node/VmVitals.tsx (B2 VM evidence charts)"
  - "src/components/node/ReadOnlySafetyPosture.tsx (B7 zero-credential strip)"
  - "src/components/node/LightningState.tsx (B5 Lightning performance layer)"
  - "src/components/node/NodeActiveSignals.tsx (B6 adaptive-action signals, inert)"
  - "src/components/node/NodeLogsStream.tsx (B4 service-filterable logs + advisory AI)"
affects:
  - "Plan 08 (assembles these six leaves top-to-bottom into the single-scroll Node Detail)"
tech-stack:
  added: []
  patterns:
    - "Composition leaves over locked df/console primitives — no new primitive, no new dependency"
    - "Presentational + serializable-prop-driven leaves (NodeHeader/VmVitals/NodeActiveSignals/NodeLogsStream)"
    - "Async Server Component wiring shipped console reads with fail-soft .catch (LightningState)"
    - "Severity→class only via the Severity ramp API (no `sev ===` chain in JSX)"
    - "AFM-002 sole unit path (feeMsatToSat/formatSats); no inline msat/sat arithmetic"
key-files:
  created:
    - src/components/node/NodeHeader.tsx
    - src/components/node/VmVitals.tsx
    - src/components/node/ReadOnlySafetyPosture.tsx
    - src/components/node/LightningState.tsx
    - src/components/node/NodeActiveSignals.tsx
    - src/components/node/NodeLogsStream.tsx
  modified: []
decisions:
  - "Leaves take serializable props (NodeHeader/VmVitals/NodeActiveSignals/NodeLogsStream) so Plan 08 owns page-level reads + pubkey→hostId resolution (Drift 3), matching the overview VitalsCard prop-driven analog"
  - "LightningState is an async Server Component that calls the shipped console *TabData(pubkey) readers directly (matching the console panel analog) — zero new SQL, fail-soft per section"
  - "VmVitals renders StaleChart EXPLICITLY (not merely delegated to EvidenceChart) on stale growth so the 'StaleChart, not a projection' honesty invariant is legible in-file"
  - "Adaptive action is a single discriminated-union value per signal — 'exactly one action per signal' is enforced by the type"
metrics:
  duration_minutes: 30
  tasks_completed: 3
  files_created: 6
  completed_date: 2026-07-08
---

# Phase 13 Plan 07: Node Detail READ Sections (B1/B2/B4/B5/B6/B7) Summary

Six Node-Detail composition leaves — identity header, VM evidence charts, Lightning performance layer, inert adaptive-action signals, service-filterable logs with advisory AI, and the zero-credential safety posture — built as thin wires over already-shipped reads and locked df/console primitives, ready for Plan 08 to assemble into the single-scroll Node Detail.

## What Was Built

- **Task 1 — NodeHeader + VmVitals + ReadOnlySafetyPosture (B1/B2/B7)** — commit `4df089a`
  - `NodeHeader`: alias (23px/700 sans) + truncated pubkey (mono) + role chip (`ImplTag`) + host link (Phase-14 target) + worst-of **overall health pill** (sev→class ONLY via the Severity ramp API) + honest `FreshnessChip` + back-to-overview affordance.
  - `VmVitals`: CPU/mem/disk `EvidenceChart`s in `EvidencePanel`s with `df-slate` thresholds; the disk time-to-full projection renders only when fresh — otherwise an **explicit `StaleChart`** ("NO FRESH DATA"), never a projection on stale.
  - `ReadOnlySafetyPosture`: navy-washed (`bg-[#EAEEF6]`) + shield strip with the D-08 reconciled copy **verbatim** from the UI-SPEC "Node Detail safety posture" row (frozen module constants).

- **Task 2 — LightningState (B5)** — commit `29f618f`
  - Async Server Component wiring the shipped console reads (`channelsTabData`/`feesTabData`/`liquidityTabData`/`forwardsTabData`/`peersTabData`) with fail-soft `.catch`. Renders channels/liquidity/fee-policy/forwards/peers via the console `SummaryStrip` + `EventTable`, with `ExportButton` CSV on LND forwards. Every sat/base render routes through `formatSats`/`feeMsatToSat`; ppm is raw; no inline unit math.

- **Task 3 — NodeActiveSignals (B6) + NodeLogsStream (B4)** — commit `9de94ed`
  - `NodeActiveSignals`: this node's signals as `SeverityCard` + `WhyChain` + advisory `aiLines`, each exposing **exactly one** adaptive action (`Export fix`/`Open runbook` → inert copy-only `CommandModal`; `Investigate` → read-only link). No server action, no mutation, no command emission.
  - `NodeLogsStream`: `EventTable` stream filterable by service (chips via `serviceDisplay().label`, never the raw key) + dismissible advisory `AiReadPanel` reads for notable errors. Advisory-only; no queue-write path.

## Acceptance Criteria

- `tsc --noEmit` clean across all six leaves (verified after each task).
- ReadOnlySafetyPosture copy matches the UI-SPEC "Node Detail safety posture" string (zero-credential + signed-intent + node-verifies) — frozen constants.
- VmVitals renders `StaleChart` (not a projection) when growth is stale — explicit in-file branch.
- Severity→class only via the Severity ramp API — no `sev ===` chain in any leaf's JSX.
- LightningState: reuses console read modules (`src/lib/console/*`), no new SQL; `grep` shows no inline `* 1000` / `/ 1000`.
- NodeActiveSignals uses `CommandModal`, emits no server action/mutation; NodeLogsStream has no queue-write import (`grep` clean for enqueue/approve).

## Deviations from Plan

None — plan executed as written. The six leaves are prop-driven composition wires; page-level reads and the `pubkey→hostId` resolution (Drift 3) remain Plan 08's responsibility per the RESEARCH/PATTERNS split.

## Notes for Plan 08 (assembler)

- `NodeHeader`, `VmVitals`, `NodeActiveSignals`, `NodeLogsStream` take serializable props — wire them from the page's fail-soft reads (host-metrics for VmVitals via `ownership.ts` `hostByNode`; incidents for signals).
- `LightningState` takes only `{ pubkey, backend }` and does its own fail-soft console reads.
- Prototype-locked stack order: header → VM vitals → (service grid, Plan 05) → Lightning → (channels, Plan 06) → active signals → safety posture.

## Self-Check: PASSED

- Files: all six `src/components/node/*.tsx` present (verified).
- Commits: `4df089a`, `29f618f`, `9de94ed` present in `git log` (verified).
- Typecheck: `tsc --noEmit` clean (verified).
