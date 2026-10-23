---
phase: 13-nodes-service-health
plan: 05
subsystem: nodes-service-health
tags: [SVC-01, service-health, two-axis, ownership, node-detail]
requires:
  - src/lib/overview/ownership.ts (buildOwnershipMap)
  - src/lib/read/service-health.ts (ServiceHealthState, getServiceHealth)
  - src/components/df/TwoAxisPip.tsx (LOCKED combinedState color law)
  - src/lib/overview/service-display.ts (serviceDisplay().label)
provides:
  - resolveNodeServices (pubkey→hostId + node/infra service partition)
  - ServiceHealthGrid (SVC-01 centerpiece Server component)
affects:
  - Plan 07/08 Node Detail route (supplies loaded services, mounts the grid)
tech-stack:
  added: []
  patterns:
    - "pure DB-free resolver over already-loaded reads (mirrors incidents.ts host-edge synthesis)"
    - "compose LOCKED TwoAxisPip N× — never re-derive/soften the two-axis color law (D-06)"
key-files:
  created:
    - src/lib/read/node-services.ts
    - src/lib/read/node-services.test.ts
    - src/components/node/ServiceHealthGrid.tsx
  modified:
    - src/components/df/TwoAxisPip.test.tsx
decisions:
  - "infraServices = host-level (nodePubkey === null) services only — kept strictly DISJOINT from the node-scoped LQWD set so the two grid sections never overlap; resolves the plan's 'separated from the node-scoped set' requirement."
  - "Footer heartbeat/lastRun are honest projections of the real Date fields (collectedAt, lastSuccessAt) via a local relativeAge() — ServiceHealthState carries no pre-humanized strings; up-but-dead renders 'failed · last ok <age>', no-data omits the row."
metrics:
  duration: ~12 min
  completed: 2026-07-08
  tasks: 3
  files: 4
---

# Phase 13 Plan 05: Nodes + Service Health — SVC-01 Two-Axis Service Grid Summary

Built the SVC-01 centerpiece — the per-node two-axis service-health grid — plus the load-bearing `pubkey → hostId` resolver it depends on, composing the LOCKED `TwoAxisPip` color law without re-deriving or softening it (D-06).

## What was built

1. **`resolveNodeServices` (`src/lib/read/node-services.ts`)** — a pure, DB-free resolver over already-loaded `ServiceHealthState[]`. It synthesizes the host→node edge from the service `(hostId, nodePubkey)` pairs (mirroring `incidents.ts`), calls `buildOwnershipMap`, derives `hostId = hostByNode.get(pubkey)` **FIRST** (the Drift 3 guard — never keys attribution off the raw pubkey), then returns `{ hostId, lqwdServices, infraServices }`. `lqwdServices` = node-scoped set (`servicesByNode.get(pubkey)`); `infraServices` = host-level null-pubkey services, kept disjoint. An unattached pubkey returns an honest empty result, never a throw.

2. **`ServiceHealthGrid` (`src/components/node/ServiceHealthGrid.tsx`)** — a Server component composing N `TwoAxisPip` tiles under two kicker-grouped sections (`INFRASTRUCTURE` / `LQWD SERVICES`). Each tile is fed the service's TRUE two-axis state verbatim; names flow through `serviceDisplay().label` (no raw machine key on screen); no `"paused"` softener and no severity remap (D-06). Empty resolver result renders an honest "no services attributed" empty state, never a fabricated green tile. No `"use client"`.

3. **Extended `TwoAxisPip.test.tsx`** — added a 5-assertion SVC-01 lock suite pinning the three-way `combinedState` precedence (HEALTHY iff both axes; UP·NOT HEALTHY and DOWN mutually distinct) and the up-but-dead red-Functioning-box + pulsing-alarm-dot treatment. TwoAxisPip source untouched.

## Task commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (RED) | failing resolveNodeServices test | 2582881 |
| 1 (GREEN) | resolveNodeServices implementation | 53d5ecb |
| 2 | ServiceHealthGrid centerpiece | 191dc2f |
| 3 | lock two-axis precedence + up-but-dead distinctness | 7af36a0 |

## Verification

- `npx vitest run src/lib/read/node-services src/components/df/TwoAxisPip` → 16 passed (5 resolver + 11 pip).
- `npx tsc --noEmit -p tsconfig.json` → clean (exit 0).
- Source assertions: grid imports `TwoAxisPip`, defines no local `combinedState` (only a documentary comment reference), labels via `serviceDisplay().label`, no paused softener (only comments documenting its absence).

## Deviations from Plan

**1. [Rule 3 - Blocking] `infraServices` filtered to host-level (null-pubkey) services.**
- **Found during:** Task 1.
- **Issue:** The plan's literal `servicesByHost.get(hostId) ?? []` would include the node-scoped services too, overlapping `lqwdServices` and contradicting behavior test #2 ("separated from the node-scoped LQWD set").
- **Fix:** `infraServices` filters `servicesByHost` to `nodePubkey === null`, yielding a clean partition (infra = host-level deps like bitcoind/esplora/postgres; LQWD = node-scoped). Semantically correct and satisfies the disjoint-set assertion.
- **Files:** src/lib/read/node-services.ts.

**2. [Rule 2 - Missing functionality] Footer heartbeat/lastRun derived via a local `relativeAge()`.**
- **Found during:** Task 2.
- **Issue:** The plan says feed `heartbeat, lastRun` "straight from the service's ServiceHealthState", but that shape carries only raw `Date` fields (`collectedAt`, `lastSuccessAt`), no pre-humanized strings. Passing nothing would drop the footer signal.
- **Fix:** Added a small pure `relativeAge(date, nowMs)` helper deriving honest `"…ago"` strings from the real fields; `heartbeat` gets a gold "stale" prefix when `collectorStale`, `lastRun` reads `"failed · last ok <age>"` for up-but-dead and `"<age> · ok"` otherwise; no-data omits the row. No fabricated values.
- **Files:** src/components/node/ServiceHealthGrid.tsx.

## Known Stubs

None — the grid renders real two-axis state from the resolver; footer strings are honest projections of real Date fields. The route wiring that supplies `services` (from `getServiceHealth` per host) is Plan 07/08 scope by design.

## Self-Check: PASSED

- FOUND: src/lib/read/node-services.ts
- FOUND: src/lib/read/node-services.test.ts
- FOUND: src/components/node/ServiceHealthGrid.tsx
- FOUND: src/components/df/TwoAxisPip.test.tsx (modified)
- FOUND commits: 2582881, 53d5ecb, 191dc2f, 7af36a0
