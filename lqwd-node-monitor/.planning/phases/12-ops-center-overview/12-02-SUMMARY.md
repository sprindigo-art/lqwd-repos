---
phase: 12-ops-center-overview
plan: 02
subsystem: overview
tags: [ownership, containment-map, root-cause-grouping, pure-module, tdd]
requires:
  - "@/lib/read/service-health (ServiceHealthState type)"
  - "hosts.node_pubkeys + service_inventory.{host_id,node_pubkey} columns (read-time only, no new schema)"
provides:
  - "buildOwnershipMap → { nodesByHost, hostByNode, servicesByHost, servicesByNode }"
  - "OwnershipMap interface — parent↔child edges for Wave-2 incident roll-up"
affects:
  - "incidents.ts (Wave 2) — consumes the map to fold child alerts up to their host"
tech-stack:
  added: []
  patterns:
    - "Pure module (no DB/server imports) — fixture-testable anywhere"
    - "Single-pass Map-building (triage.ts:59-83 analog), no sort"
    - "Read-time containment over existing columns — no stored graph (D-03)"
key-files:
  created:
    - src/lib/overview/ownership.ts
    - src/lib/overview/ownership.test.ts
  modified: []
decisions:
  - "No stored graph (D-03): map rebuilt in memory each read so it cannot drift from source (T-12-OWN-02)"
  - "Channels deliberately NOT attached at the top level — they attach lazily per node only when an incident needs blast-radius (RESEARCH)"
  - "node_pubkeys ?? [] + copy: malformed/missing fleet array degrades, never throws; stored arrays never alias source rows"
metrics:
  duration: ~7m
  completed: 2026-06-30
  tasks: 2
  files: 2
---

# Phase 12 Plan 02: Read-Time Ownership Containment Map Summary

`buildOwnershipMap` derives the full host→service→node containment at read time from existing columns only (`hosts.node_pubkeys` + service-health rows), producing the parent↔child edges the Wave-2 incident roll-up consumes — with unattached nodes and host-level services handled honestly and zero new schema.

## What Was Built

- **`src/lib/overview/ownership.ts`** — pure module exporting `OwnershipMap` and `buildOwnershipMap(inputs)`. Builds four Maps in a single pass each:
  - `nodesByHost` — host_id → declared node pubkeys (a fresh copy, never the source ref)
  - `hostByNode` — the inversion of `node_pubkeys`; every declared node maps to exactly one host; an unattached node returns `undefined`
  - `servicesByHost` — every service on a host (host-level AND node-scoped)
  - `servicesByNode` — node-scoped services only (host-level NULL-pubkey services excluded)
- **`src/lib/overview/ownership.test.ts`** — 7 vitest cases proving inversion, unattached-node honesty (Pitfall 6), host-level vs node-scoped service routing, empty/missing array guards, and input non-mutation.

## TDD Cycle

- **RED** (`23f7e00`): test written against absent module — run failed as expected.
- **GREEN** (`c72d079`): minimal single-pass implementation — 7/7 pass.
- **REFACTOR**: none needed; the implementation was already minimal and clean.

## Verification

- `npx vitest run src/lib/overview/ownership` → 7 passed (1 file).
- Purity guards: `grep -c "\.sort("` → 0; `grep -cE "server-only|@/lib/db"` → 0.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — `buildOwnershipMap` is fully wired to its `ServiceHealthState` input contract; the Wave-2 consumer (`incidents.ts`) is out of scope for this plan.

## Self-Check: PASSED

- FOUND: src/lib/overview/ownership.ts
- FOUND: src/lib/overview/ownership.test.ts
- FOUND commit: 23f7e00 (test/RED)
- FOUND commit: c72d079 (feat/GREEN)
