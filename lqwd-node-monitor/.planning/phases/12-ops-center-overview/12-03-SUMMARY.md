---
phase: 12-ops-center-overview
plan: 03
subsystem: overview
tags: [incidents, root-cause-grouping, cross-layer, worst-child, stale-orthogonal, pure-module, tdd]

# Dependency graph
requires:
  - plan: 12-01
    provides: "severity-map.ts — severityFromInsight/Band/Service + worstSeverity (the only severity boundary)"
  - plan: 12-02
    provides: "ownership.ts — buildOwnershipMap / OwnershipMap (host↔node↔service containment)"
  - phase: 04
    provides: "InsightCard frozen schema + rankCards engine order (consumed, never re-sorted)"
  - phase: 11
    provides: "HostMetricsView / ChainTelemetryView / ServiceHealthState / ScorecardView read shapes"
provides:
  - "incidents.ts — assembleIncidents: cross-layer, host-keyed, root-cause-grouped incident tree (D-01)"
  - "GroupedIncident interface — the queue's data spine for the page (OVW-01) + Wave-3 ai-band/filter"
affects: [ai-band, filter, overview-page, 12-04, 12-05, 12-06, 12-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Group/partition over a pre-ranked array — engine order is LAW, zero .sort (triage.ts analog)"
    - "Severity crosses the boundary ONLY via Plan-01 mappers; stale tracked on a separate flag (D-08)"
    - "Read-time host→node ownership derived from service (hostId,nodePubkey) pairs, fed to buildOwnershipMap"

key-files:
  created:
    - src/lib/overview/incidents.ts
    - src/lib/overview/incidents.test.ts
  modified: []

key-decisions:
  - "Containment is by HOST: every host-attached failing entity nests under its host's ONE incident; only truly unattached (no-host) nodes/fleet cards float top-level (Pitfall 6)"
  - "host→node ownership derived from the services' (hostId,nodePubkey) pairs — HostMetricsView carries no node_pubkeys, services are the available edge"
  - "HostMetricsView grades to stale-or-healthy only (no band ships in the view yet); host-incident criticality comes from its worst child (D-02)"
  - "Incident asOf = worst-case (earliest) child stamp; insight-card children are fresh (stale:false)"

patterns-established:
  - "assembleIncidents walks rankedCards FIRST (engine order), then telemetry layers — insight-sourced incidents precede purely-telemetry ones, no second sort"
  - "Leaf children carry their own layer; the host-group wrapper reports layer hosts"

requirements-completed: [OVW-01, OVW-04]

# Metrics
duration: ~14min
completed: 2026-06-30
---

# Phase 12 Plan 03: Cross-Layer Incident Assembler Summary

**Pure `incidents.ts` that folds the engine-ranked insight cards plus the four per-layer telemetry views into a host-keyed, root-cause-grouped `GroupedIncident[]` — a parent host's failing children collapse into ONE incident (D-01) whose severity is the worst non-stale child (D-02), with `stale` kept orthogonal so a no-data child never fakes an outage (D-08), and an empty queue when all-clear (OVW-04).**

## Performance

- **Duration:** ~14 min
- **Completed:** 2026-06-30
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 created

## Accomplishments
- `assembleIncidents({ rankedCards, hosts, chain, services, nodes })` produces the cross-layer incident tree the page renders as the attention queue (OVW-01) and Wave-3 (`ai-band.ts` / `filter.ts`) consumes.
- D-01 host roll-up: a host's down services + on-host node alerts collapse into ONE incident keyed by the host; those children nest and DROP from the top level.
- D-02 worst-child severity via `worstSeverity` only — `[warning, critical, watch] → critical`; no inline ramp chains.
- D-08 stale orthogonality: a stale/no-data child carries `stale:true` on a separate flag and never promotes the parent; the parent's severity is the worst NON-stale rung.
- Pitfall 6 honesty: an unattached node alert (pubkey in no host) becomes its own top-level node incident — degrades, never throws.
- OVW-04 all-clear: zero alerting input returns an empty top-level array so the page renders the all-clear hero.
- Pitfall 3 / engine-order-is-LAW: ranked input is walked in order and only partitioned/grouped — `grep -c "\.sort("` → 0; insight-sourced incidents preserve `rankCards` order even when severities would reorder under a sort.

## Task Commits

1. **Task 1: Write the failing incidents vitest (RED)** - `cc766fc` (test)
2. **Task 2: Implement cross-layer incident assembly (GREEN)** - `37e5110` (feat)

_No REFACTOR commit — the GREEN implementation was already clean and minimal._

## Files Created/Modified
- `src/lib/overview/incidents.ts` — pure assembler: derives host→node ownership from service pairs, walks ranked cards then telemetry layers, nests host-attached failures under one host incident, rolls up worst-child severity + orthogonal stale.
- `src/lib/overview/incidents.test.ts` — 6 vitest cases proving D-01 grouping, D-02 worst-child, D-08 stale orthogonality, unattached-node fallback, all-clear empty queue, and no-re-sort engine-order preservation.

## Decisions Made
- **Containment by host:** every host-attached failing entity (service, on-host node, node alert, bitcoind, host metric) nests under its host's single incident. Only no-host nodes/fleet cards float top-level. This is the cleanest reading of D-01 and matches Pitfall 6.
- **Ownership source:** `HostMetricsView` carries no `node_pubkeys`, so host→node edges are derived from the services' `(hostId, nodePubkey)` pairs and fed to `buildOwnershipMap` — the only host→node edge available from the fixed input signature.
- **Host grading:** `HostMetricsView` has no severity band yet, so a host grades to `stale` (no-data/old) or `healthy`; an incident's criticality always flows up from its worst child (D-02), not the host's own metric.

## Deviations from Plan

None — plan executed exactly as written. RED failed for the expected reason (unresolved import); GREEN passed all 6 assertions on the first implementation; the full `src/lib/overview` suite is 36/36 green. The `=== "critical"` grep hit is a doc comment quoting the forbidden anti-pattern, not code; scorecard `dot` mapping uses a `switch` on the scorecard's own field (sanctioned by the plan), and all df-severity values are produced via the Plan-01 mappers.

## Known Stubs

None — `assembleIncidents` is fully wired to its view-array inputs. Channel blast-radius children are deliberately deferred (attach lazily per node only when an incident detail needs them — RESEARCH / 12-02 decision); not a stub of this plan's goal.

## Issues Encountered
None.

## TDD Gate Compliance
- RED gate present: `cc766fc` (test) — failed with unresolved import before implementation.
- GREEN gate present: `37e5110` (feat) after RED — 6/6 assertions pass.
- REFACTOR: not required.

## Next Phase Readiness
- Wave 3 (`ai-band.ts`, `filter.ts`) and the overview page can now import `assembleIncidents` + `GroupedIncident` from `@/lib/overview/incidents` to render the attention queue and derive the AI band over the SAME grouped set (no re-query, no re-sort).
- No blockers.

## Self-Check: PASSED

- FOUND: src/lib/overview/incidents.ts
- FOUND: src/lib/overview/incidents.test.ts
- FOUND: .planning/phases/12-ops-center-overview/12-03-SUMMARY.md
- FOUND commit: cc766fc (RED test)
- FOUND commit: 37e5110 (GREEN impl)

---
*Phase: 12-ops-center-overview*
*Completed: 2026-06-30*
