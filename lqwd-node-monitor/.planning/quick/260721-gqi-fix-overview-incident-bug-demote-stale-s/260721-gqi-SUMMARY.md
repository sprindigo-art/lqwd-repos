---
phase: quick-260721-gqi
plan: 01
subsystem: overview / attention-queue
tags: [funds-safety, staleness, rollup, render, incidents]
requires:
  - src/lib/overview/severity-map.ts (worstSeverity stale-VALUE filter)
  - src/lib/insight/labels.ts (SIGNAL_LABELS)
  - src/lib/scorecard/types.ts (ScorecardView.stale)
provides:
  - staleNodes stale-VALUE demotion of insight-derived children
  - per-(node,signal) rollup of noisy stuck_*/htlc_* criticals
  - node-child reason render in QueueIsland
affects:
  - overview page attention queue (OVW-01/OVW-04)
tech-stack:
  added: []
  patterns: [flag⟺value coupling for stale, first-seen Map rollup, renderToStaticMarkup render test]
key-files:
  created:
    - src/components/overview/QueueIsland.test.tsx
  modified:
    - src/lib/overview/incidents.ts
    - src/lib/overview/incidents.test.ts
    - src/components/overview/QueueIsland.tsx
decisions:
  - "Demotion keys ONLY on staleNodes membership (ScorecardView.stale), never on severity — a FRESH stuck-force-close keeps its critical VALUE (no-mask funds-safety)."
  - "Demotion sets the child severity VALUE to \"stale\" (not just the flag) because worstSeverity filters the VALUE (severity-map.ts:101), so the flag alone would not demote the parent."
  - "Reason-render gated strictly to layer === \"nodes\"; bitcoind/host telemetry rows keep their entityLabel."
metrics:
  duration: ~25m
  completed: 2026-07-21
  tasks: 3
  files: 4
---

# Phase quick-260721-gqi Plan 01: Overview Incident Bug (Stale-Critical + Rollup + Reason) Summary

Demote stale-sourced insight criticals via the severity VALUE `"stale"` (funds-safe, no-mask), roll up noisy per-channel `stuck_*`/`htlc_*` criticals into one count-summary child per (node, signal), and render a human-readable reason on every node child row in the attention queue.

## What changed

### Task 1 — Stale-VALUE demotion (funds-safety)
`assembleIncidents` now builds a `staleNodes` set from `input.nodes` (`ScorecardView.stale`). At the insight-leaf construction the child now sets BOTH `severity: nodeStale ? "stale" : severity` and `stale: nodeStale`, mirroring the flag⟺value coupling used at bitcoind/services/hosts/gradeNode. Because `worstSeverity` filters the severity VALUE `"stale"` (severity-map.ts:101), a stale-source critical no longer promotes its parent host — while a FRESH node keeps its `critical` VALUE and still promotes (no-mask guarantee). Tests A/B/C added.

### Task 2 — Per-(node,signal) rollup
Added `ROLLUP_SIGNALS` (`stuck_fc_past_maturity`, `stuck_sweep`, `stuck_open`, `htlc_timeout_fc`). These are intercepted BEFORE the generic leaf path (mirroring the `FEE_SIGNALS` intercept) into a first-seen-order `Map` keyed by `(pubkey, signal)`, then emitted as ONE count-summary child per group after the card walk: `why = "${count} channel${s} · ${SIGNAL_LABELS[signal]}"`, `key = rollup:${signal}:${pubkey}`, `count`, `layer: "nodes"`. The same staleness demotion applies (`severity ← "stale"` when the source node is stale). 17 `stuck_fc` → one `"17 channels · STUCK FORCE-CLOSE"` row. Tests D/E/F/G + non-rolled-signal guard added.

### Task 3 — Render the reason (gated to layer === "nodes")
`toSeverityChild` now renders the node row's reason instead of the bare `entityLabel`: a raw `DetectorId` `why` humanizes through `SIGNAL_LABELS`, a rollup/scorecard human phrase passes through verbatim, and an empty `why` falls back to `entityLabel`. Gated strictly to `layer === "nodes"` so bitcoind (`why="bitcoind"`) and host (`why="host-metrics"`) rows keep their hostname. New `QueueIsland.test.tsx` (renderToStaticMarkup, node env) proves Tests H/I/J.

## Deviations from Plan

Tasks 1 and 2 were committed together in one atomic commit (`3252e9b`) rather than two — they modify the same two files (`incidents.ts` + `incidents.test.ts`) and are tightly coupled (Task 2's rollup reuses Task 1's `staleNodes` set and demotion pattern). Task 3 is its own commit (`479f5ad`). No behavior deviation; all plan tasks executed as specified.

## Verification

- `npx vitest run src/lib/overview/incidents.test.ts src/components/overview` → 3 files, 36 tests passed (22 incidents + 4 QueueIsland + 10 pre-existing QueueFilters/SeverityCard adjacent in dir).
- `npx tsc --noEmit` → exit 0, no type regressions.
- `npm run lint:noc-guard` → v2 surfaces clean.
- No existing assertion in `incidents.test.ts` was weakened or removed (locked suite extended only).

## Known Stubs

None.

## Self-Check: PASSED

- src/lib/overview/incidents.ts — FOUND (modified)
- src/lib/overview/incidents.test.ts — FOUND (modified)
- src/components/overview/QueueIsland.tsx — FOUND (modified)
- src/components/overview/QueueIsland.test.tsx — FOUND (created)
- Commit 3252e9b — FOUND (tasks 1+2)
- Commit 479f5ad — FOUND (task 3)
