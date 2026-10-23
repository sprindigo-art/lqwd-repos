---
phase: 14-hosts-infra-monitoring
plan: 04
subsystem: overview
tags: [hosts, facets, sort, runbook, pure-module, tdd]
requires:
  - "@/components/df/Severity (Severity 5-state ramp)"
  - "@/components/df/CommandModal (RunbookStep consumer contract, kind:runbook)"
provides:
  - "src/lib/overview/host-filter.ts — parseHostFacets / applyHostFilters / sortHostsWorstFirst"
  - "src/lib/overview/host-runbook.ts — buildHostRunbook (four-class verify-first builder)"
affects:
  - "Wave-3 Hosts list route (filters + worst-first sort composition)"
  - "Wave-3 Host Detail incident banner (Open runbook → CommandModal kind:runbook)"
tech-stack:
  added: []
  patterns:
    - "whitelist-widen-on-invalid facet codec (node-filter.ts clone, V5)"
    - "verify-first runbook copy builder (exhaustive closed union, inert strings)"
key-files:
  created:
    - src/lib/overview/host-filter.ts
    - src/lib/overview/host-filter.test.ts
    - src/lib/overview/host-runbook.ts
    - src/lib/overview/host-runbook.test.ts
  modified: []
decisions:
  - "Sort ties severity-first over staleness: an at-risk host keeps its severity band even when stale — staleness never buries a critical; only otherwise-quiet stale hosts fall into the stale group (after at-risk, before healthy — Open Q3 pin)"
  - "sortGroup table lives locally in host-filter.ts: severity-map's RAMP_RANK is module-private and deliberately excludes stale, which this sort must place"
  - "buildHostRunbook takes serviceLabel as an optional second param (default 'the service') so service-not-functioning copy names the human label, never a machine key"
  - "node-critical command is read-only diagnostics (lncli getinfo) — copy warns against blind restarts (force-close risk)"
metrics:
  duration: "~6 min"
  completed: "2026-07-13"
  tasks: 2
  files: 4
---

# Phase 14 Plan 04: Hosts Facet Codec + Worst-First Sort + Verify-First Runbook Builder Summary

**One-liner:** Hosts ?sev/?stale whitelist codec + pure AND filter + the one sanctioned D-08 worst-first sort (stale grouped after at-risk, Open Q3 pinned), plus the D-11 four-class verify-first runbook builder authored against the CommandModal kind:"runbook" contract.

## What Was Built

### Task 1 — host-filter.ts (TDD)
- `parseHostFacets(URLSearchParams)`: closed `?sev` vocabulary `{all, critical, warning, watch, healthy}` (the df ramp minus stale — stale is NOT a sev chip); `?stale=1|true` toggle. Invalid values silently widen (V5) — `?sev=bogus` → `all`, `?sev=stale` → `all`, `?stale=maybe` → `false`.
- `applyHostFilters<T extends HostFilterRow>`: pure AND `.filter` — sev facet matches rollup severity exactly, stale toggle keeps only stale/no-telemetry hosts. Never sorts, never mutates, honest `[]` on zero matches.
- `sortHostsWorstFirst<T>`: the ONLY Phase-14 sort (D-08). Order: critical > warning > watch > stale group > healthy, hostId ascending tiebreak, returns a new array. The no-telemetry fixture (healthy-after-stale-filter rollup + stale flag) is pinned sorting in the stale group.
- Tests: 13 passing, full order fixture pinned.

### Task 2 — host-runbook.ts (TDD)
- `buildHostRunbook(driver, serviceLabel?)` over the closed union `bitcoind-down | service-not-functioning | disk-filling | node-critical` — exhaustive switch, no default fallthrough.
- Every class leads with a `Verify first` symptom-confirmation step (systemctl status bitcoind + getblockchaininfo / systemctl status / df -h / lncli getinfo) before any remedial command.
- Commands are plain inert operator shell text (`systemctl restart bitcoind`, `journalctl --vacuum-size=500M`, etc.) consumed exclusively by CommandModal `kind:"runbook"` (T-14-11).
- Credential hygiene pinned by test iterating all classes: no `routing_vm`, `password`, `postgres://`, `PGPASSWORD` anywhere (T-14-10).
- Tests: 22 passing.

## Verification

- `npx vitest run src/lib/overview/host-filter.test.ts` — 13 passed
- `npx vitest run src/lib/overview/host-runbook.test.ts` — 22 passed
- `npx vitest run src/lib/overview` — 11 files / 147 tests, no regression
- `npx tsc --noEmit` — clean
- Acceptance greps: `from "(next|@/lib/db)` = 0 in both modules; `.sort` lines in host-filter.ts = 1; `routing_vm` in host-runbook.ts = 0

## Commits

| Task | Gate | Commit | Message |
|------|------|--------|---------|
| 1 | RED | 41bf737 | test(14-04): add failing tests for hosts facet codec, filter, and worst-first sort |
| 1 | GREEN | ee107f6 | feat(14-04): implement hosts facet codec, pure filter, and worst-first sort |
| 2 | RED | 5a759c6 | test(14-04): add failing tests for verify-first host runbook builder |
| 2 | GREEN | 0cbf460 | feat(14-04): implement verify-first host runbook builder (D-11) |

## Deviations from Plan

None - plan executed exactly as written. (One planner-anticipated fork resolved: severity-map's `RAMP_RANK` is not exported, so the sort's grouping table is local per the plan's "reuse ... if one is exported" conditional.)

## Requirements

HOST-01 / HOST-02 are partially advanced (pure-logic layer only); they complete in Wave-3 route composition. REQUIREMENTS.md deliberately not marked — orchestrator/final plan owns completion marking.

## Known Stubs

None — both modules are fully wired pure logic with no placeholder values. `<service-unit>` / `<node-unit>` placeholders in runbook copy are intentional operator-substitution tokens (the module receives no machine unit keys by design), not stubs.

## Threat Flags

None — no new network endpoints, auth paths, file access, or schema surface. All plan threat-register mitigations (T-14-09/10/11) implemented and test-pinned.

## TDD Gate Compliance

RED → GREEN sequence present for both tasks (see commit table). No refactor commits needed.

## Self-Check: PASSED

All 4 created files exist on disk; all 4 task commits (41bf737, ee107f6, 5a759c6, 0cbf460) present in git log.
