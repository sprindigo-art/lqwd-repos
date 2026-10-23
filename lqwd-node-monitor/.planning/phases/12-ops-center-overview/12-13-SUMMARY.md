---
phase: 12-ops-center-overview
plan: 13
subsystem: overview-data-layer
tags: [taxonomy, dedup, tree-filter, incidents, filter, tdd, OVW-01, OVW-05]
requires:
  - "src/lib/overview/severity-map.ts (worstSeverity, severityFromService — reused, not modified)"
  - "src/lib/overview/ownership.ts (buildOwnershipMap.hostByNode — reused, not modified)"
  - "src/lib/overview/service-display.ts (serviceDisplay label — reused)"
provides:
  - "incidents.ts: service dedup by (ownerHostId, serviceName) + single 'Unattributed' bucket replacing bare top-level orphans; children retain their layer"
  - "filter.ts: tree-aware applyFilter (owner-or-descendant match + layer-scoped child narrowing); parseOverviewFacets vocab UNCHANGED"
affects:
  - "12-14 (card & row rebuild) consumes the new deduped/attributed tree shape + tree-filter child narrowing"
tech-stack:
  added: []
  patterns:
    - "Single-element array holder to avoid TS control-flow narrowing a closure-assigned `let = null` to `never`"
    - "Dedup-on-collision keeps the strictly-worse row (worstSeverity) so a WORSE alert never hides under a healthier duplicate"
key-files:
  created: []
  modified:
    - src/lib/overview/incidents.ts
    - src/lib/overview/incidents.test.ts
    - src/lib/overview/filter.ts
    - src/lib/overview/filter.test.ts
decisions:
  - "Unattributed bucket is created lazily on the first orphan but APPENDED to the top level LAST (after every real owner) — guarantees it reads as a labeled tail group regardless of when the first orphan is encountered in the engine walk"
  - "Dedup keeps the strictly-worse colliding row wholesale (its severity + reason + label + asOf); two stale rows reduce to healthy under worstSeverity so neither replaces the other, and the first-seen stale entry is retained honestly"
  - "treeSevs/treeLayers read the descendant-child union (own layer/sev for a childless leaf) — owner rolled-up severity is derived FROM children, so the child union is the complete, correct match surface"
metrics:
  duration: ~6 min
  tasks: 2
  files: 4
  tests_added: 8
  completed: 2026-07-02
---

# Phase 12 Plan 13: Taxonomy & Tree-Aware Filter Summary

Fixed the two live-verify taxonomy/grouping bugs in the pure overview data layer: services now dedup by `(owner-host, serviceName)` into one worst-severity child and every orphan nests under a single labeled "Unattributed" bucket, while `applyFilter` became tree-aware — matching a card by any alert in its tree and narrowing surviving children to the active layer.

## What Was Built

**Task 1 — `incidents.ts` dedup + Unattributed bucket (D-R3):**
- Rewrote the services loop to dedup by `${ownerHostId}:${serviceName}` via a `Map`. On collision it keeps the strictly-worse row (determined by the sanctioned `worstSeverity` reducer) with that row's most-specific reason/label — killing the repeated "Address List Sync" rows caused by `service_inventory` carrying a host-level row plus per-node duplicates of the same service.
- Replaced the bare-orphan branch of `place()`: a child with no owning host (`hostId === undefined`) now nests under a single lazily-created "Unattributed" bucket instead of being pushed as a context-free top-level incident. The insight-card path, fee-summary path, and scorecard-nodes path all route through `place()`, so nothing floats bare.
- The bucket is appended to the top level LAST (after every real owner rolls up), rolls up its own children under the same D-02 severity / D-08 stale rules, and carries an honest `"N unattributed alert(s) — no owning host"` why.
- Children continue to carry their own `layer` field unchanged so `filter.ts` can read the tree.

**Task 2 — `filter.ts` tree-aware `applyFilter` (D-R4):**
- Added `treeLayers(inc)` / `treeSevs(inc)` returning the descendant-child layer/severity union (or the leaf's own value when childless).
- A card is kept when any tree alert intersects the active layer set AND the active severity set (empty facet = all), fixing the old top-level-only match that hid grouped `layer:"hosts"` cards whenever the operator filtered by `nodes`/`services`.
- When a layer facet is active, each surviving card's visible `children` are narrowed to matching layers and a FRESH card object is returned (input `children` never mutated); with no layer facet the card passes through by identical reference.
- `parseOverviewFacets` and the whitelist vocab are untouched.

## How It Was Verified

- `npx vitest run src/lib/overview/incidents src/lib/overview/filter` → 31 passed (14 incidents + 17 filter).
- `CI=true npx tsc --noEmit -p tsconfig.json` → exit 0 (clean).
- `grep -c "\.sort(" src/lib/overview/incidents.ts` → 0; same for `filter.ts` → 0 (engine order preserved).
- `grep -n "Unattributed" src/lib/overview/incidents.ts` → bucket label + `"no owning host"` why present.
- `grep -n "children" src/lib/overview/filter.ts` → tree read + narrowing present.
- RED was demonstrated before GREEN for both tasks: 5 incidents cases and 3 filter cases were confirmed failing against the unchanged source prior to implementation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TypeScript narrowed the closure-assigned `let unattributedBucket: GroupedIncident | null = null` to `never`**
- **Found during:** Task 1 (tsc verification)
- **Issue:** The bucket is only ever assigned inside the nested `ensureUnattributedBucket()` closure; TS control-flow analysis narrowed the outer read to `null`, so the final `!== null` guard typed the roll-up block as `never` (12 TS2339/TS7006 errors).
- **Fix:** Switched from a `let = null` variable to a single-element array holder (`const unattributedHolder: GroupedIncident[] = []`), reading `unattributedHolder[0]` with an `!== undefined` guard. Array element reads are not narrowed by an initializer, so the type resolves cleanly.
- **Files modified:** src/lib/overview/incidents.ts
- **Commit:** 32d6cfc

### Test rewrites required by the behavior change (not defects)

The two prior orphan tests ("unattached node as its own top-level incident", "never re-sorts" over two unattached nodes) and the four fee-grouping tests asserted the OLD floating-orphan / two-top-level-summaries model. Per D-R2/D-R3 (one card per owner, orphans bucketed) these were updated to assert the Unattributed bucket and owner-nested fee summaries. This is the intended contract change, driven RED-first; all other prior cases pass unchanged.

## TDD Gate Compliance

Plan frontmatter is `type: tdd`. RED→GREEN was genuinely followed per task — failing tests were written and confirmed failing before each implementation. Commit granularity is **per-task bundled** (`feat(...)` commits carrying both the RED-first tests and the GREEN implementation) rather than separate `test(...)` then `feat(...)` commits. No behavior was implemented ahead of its test. This is the only gate-shape deviation; the RED evidence is recorded in the execution log (5 incidents + 3 filter cases failing pre-implementation).

## Known Stubs

None — both modules are complete pure-logic implementations wired to the reused engine (severity-map, ownership, service-display). No hardcoded empty values, placeholders, or unwired data sources introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema surface. Pure edits to two existing lib modules and their tests (threat T-12-13-SC: zero installs, honored). The threat register mitigations are covered by tests: T-12-13-01 (orphan surfaced under the bucket, never dropped), T-12-13-03 (dedup keeps worst severity).

## Self-Check: PASSED

- All 4 modified source/test files present on disk.
- SUMMARY.md present.
- Both task commits (32d6cfc, 86f88cd) present in git log.
