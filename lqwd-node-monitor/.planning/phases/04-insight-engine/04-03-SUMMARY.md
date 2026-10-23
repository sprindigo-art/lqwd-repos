---
phase: 04-insight-engine
plan: 03
subsystem: insight-detectors
tags: [ap-11, close-storm, close-cluster, d-10, insight-cards, tdd]
requires:
  - "04-01: InsightCardSchema / types.ts frozen contract, deeplink.ts (buildDeepLink, FLEET_PENDING_LINK)"
  - "04-02: INSIGHT_CONFIG cluster knobs (clusterScanWindowHours/PerNodeMinCloses/MinNodesWarn/MinNodesCritical)"
  - "Phase 2: FleetView/ScorecardView shape, forceClose dimension extras.maxHourlySelfCloses, SCORECARD_CONFIG tier1"
provides:
  - "detectCloseStorm(view, config?) — AP-11 critical card per storm-flagged node, zero new SQL"
  - "closeStormFlaggedPubkeys(view) — typed tier1Breach suppression flag set for 04-07 guardrails"
  - "buildClusterSql(scanWindowHours) — INITIATOR_LOCAL hour-bucket fleet aggregate"
  - "detectCloseCluster(rows, config) — D-10 fleet cards (warn ≥2 nodes / critical ≥3 nodes, ≥5 same-hour self-closes each)"
  - "closeClusterCards(config?) — lazy-import executor for the engine (04-08)"
affects:
  - "04-07 guardrails (imports closeStormFlaggedPubkeys)"
  - "04-08 engine (calls detectCloseStorm + closeClusterCards)"
tech-stack:
  added: []
  patterns:
    - "Dimension-module anatomy (banner → SQL builder → raw-row interface → lazy-import executor) + pure detect* split"
    - "Op-aware tier1 evaluation mirroring grade.ts evaluateTier1 — detector and chip fire on identical conditions"
key-files:
  created:
    - src/lib/insight/detectors/close-storm.ts
    - src/lib/insight/detectors/close-storm.test.ts
    - src/lib/insight/detectors/close-cluster.ts
    - src/lib/insight/detectors/close-cluster.test.ts
  modified: []
decisions:
  - "detectCloseStorm takes an optional config param defaulting to SCORECARD_CONFIG — proves the firing line is a config read (test injects a mock) without vi.mock machinery"
  - "Close-storm evidence.metric reads tier1.metric (the config's extras key string) rather than restating 'maxHourlySelfCloses' — single-sources the T-02-07 key contract"
  - "Cluster evidence.threshold reports the line actually crossed (critical → clusterMinNodesCritical, warn → clusterMinNodesWarn)"
  - "Cluster cards emit in bucket-hour ascending order for deterministic output"
metrics:
  duration: "~5 min"
  completed: "2026-06-12T06:53:00Z"
  tasks: 2
  files: 4
  tests: "20 passing (10 close-storm, 10 close-cluster)"
---

# Phase 4 Plan 03: Close-Side Detectors (AP-11 Close-Storm + D-10 Fleet Close-Cluster) Summary

AP-11 close-storm cards fire from the already-computed FleetView extras against the SCORECARD_CONFIG tier-1 line (no threshold fork, zero new SQL), and the D-10 fleet close-cluster detector catches the 2024-09-09/2025-07-16 cascade signatures via a new bound-param INITIATOR_LOCAL hour-bucket aggregate — both investigate-only, never write params.

## What Was Built

### Task 1 — `close-storm.ts` (AP-11, INSIGHT-02 headline detector)
- `detectCloseStorm(view: FleetView, config = SCORECARD_CONFIG): InsightCard[]` — pure, no SQL, no server-only. Finds the forceClose dimension by typed key (`dimensions.find(d => d.key === "forceClose")`, never label matching — Pitfall 5), reads `extras[tier1.metric]` (= `maxHourlySelfCloses`), and evaluates the configured op against `SCORECARD_CONFIG[node.backend].forceClose.tier1.value`. The module contains no threshold literal (`grep -c "50"` = 0); a mock config moves the firing line in tests.
- Card contract: severity `critical`, signal `ap11_close_storm`, id `ap11_close_storm:{pubkey}:node` (D-08 dedupe rule), evidence `{metric, observed, threshold, unit: "closes/hr", window: "24h", asOf, deepLink → closes tab}`, `suggestedAction: {type: "investigate", params: {}}` — AP-11 playbook in the banner (do NOT auto-restart; freeze channel.db, preserve logs).
- `closeStormFlaggedPubkeys(view): Set<string>` — the typed suppression flag set 04-07 imports: pubkeys where the forceClose dimension's `tier1Breach !== null`, with an explicit missing-dimension guard (`undefined !== null` would false-positive).

### Task 2 — `close-cluster.ts` (D-10, INSIGHT-05 cascade early-warning)
- `buildClusterSql(scanWindowHours): SQL` — `lnd_node_closed_channels`, `close_initiator = 'INITIATOR_LOCAL'` fixed literal, `GROUP BY date_trunc('hour', timestamp), local_pubkey`, window via `make_interval(hours => $1)` bound param (T-04-06). Banner documents table, `local_pubkey` identity (Pitfall 6), one-row-per-close/no DISTINCT ON, and the Pitfall 8 hour-bucket aliasing limitation (sliding window = v2 knob).
- `ClusterRow` raw-row interface with `string | number | bigint` count union; coercion via `Number()` + `parseDbTimestampUtc` (WR-01) once at the boundary.
- `detectCloseCluster(rows, config): InsightCard[]` — per bucket, nodes at ≥ `clusterPerNodeMinCloses` (5) qualify; ONE fleet card per qualifying bucket: critical at ≥ `clusterMinNodesCritical` (3) nodes, warn at ≥ `clusterMinNodesWarn` (2). Card: `target {kind: "fleet", pubkeys: sorted}`, `node: null`, signal `fleet_close_cluster`, id includes the bucket-hour ISO (the hour IS the event identity), evidence detail carries per-node counts + bucket hour, deepLink `FLEET_PENDING_LINK`.
- `closeClusterCards(config = INSIGHT_CONFIG.lnd)` — lazy-imports `@/lib/db/warehouse-routing` inside the function (no-DB test import graph stays clean).

### Golden fixtures encoded (incident-validated)
- 2024-09-09 cascade (France 93/hr + India + Sweden same bucket) → exactly 1 critical fleet card, 3 pubkeys.
- 2025-07-16 reciprocation (Canada 101 + Australia 20; Brazil 4 below per-node line) → warn card with exactly the 2 qualifying nodes.
- Single node at 60 closes/hr, no second node ≥5 → 0 cluster cards (AP-11's job).
- Boundary-straddle (:58–:02 split, each side <5) → no card, asserted as accepted v1 behavior per Pitfall 8.

## Verification

- `npx vitest run src/lib/insight/detectors` — 2 files, 20/20 passing.
- `grep -c "50" close-storm.ts` = 0; `grep -q "tier1Breach" close-storm.ts` succeeds.
- Shape tests assert rendered SQL contains `INITIATOR_LOCAL`, `date_trunc('hour'`, `make_interval`, bound `$1` (params `[36]`, no interpolated `36` in SQL text).
- No top-level `server-only`/db import in either module (lazy-import only).
- `npx tsc --noEmit` clean; `npx eslint src/lib/insight/detectors/` clean.
- All emitted cards parse via `InsightCardSchema` (asserted in both test files).

## TDD Gate Compliance

| Task | RED commit | GREEN commit |
|------|-----------|--------------|
| 1 — close-storm | `4600607` test(04-03) | `d2467d3` feat(04-03) |
| 2 — close-cluster | `c163e60` test(04-03) | `3f6d03b` feat(04-03) |

Both RED commits confirmed failing before implementation; no refactor commits needed.

## Deviations from Plan

None - plan executed exactly as written.

## Requirements Note

Plan frontmatter lists INSIGHT-02 and INSIGHT-05. INSIGHT-05 (fleet temporal close-cluster) is fully delivered by this plan; INSIGHT-02 spans additional detectors built in parallel wave plans (04-04..04-06). REQUIREMENTS.md marking is left to the orchestrator's post-wave shared-file pass to avoid parallel-worktree merge conflicts.

## Known Stubs

None — both detectors are fully wired pure functions plus a live lazy-import executor; no placeholder data paths.

## Self-Check: PASSED

All 4 source/test files exist on disk; SUMMARY.md exists; commits 4600607, d2467d3, c163e60, 3f6d03b all present in git log.
