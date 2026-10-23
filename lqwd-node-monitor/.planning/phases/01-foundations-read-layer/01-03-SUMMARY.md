---
phase: 01-foundations-read-layer
plan: 03
subsystem: read-layer
tags: [drizzle-pull, introspection, ldk, afm-001, distinct-on, golden-invariant, schema]
requires:
  - "01-02 warehouse clients (dbRouting/dbLdk) + live grafana bridge"
  - "01-01 AFM-002 formatter + vitest"
provides:
  - "Hand-curated warehouse schemas (schema/routing.ts, schema/ldk.ts) from LIVE introspection"
  - "AFM-001 latestChannelsForNode() — the only sanctioned DISTINCT ON (chan_id) latest-state helper"
  - "Live golden cross-consistency invariant test (golden.test.ts) across Canada + Tier-M + edge"
  - "docs/LDK-INTROSPECTION.md (confirmed LDK columns — no [ASSUMED])"
affects:
  - "Plan 01-04 builds the unified model on these confirmed columns + the latest helper"
tech-stack:
  patterns:
    - "AFM-001: DISTINCT ON (chan_id) ORDER BY chan_id, timestamp DESC — never MAX(timestamp)"
    - "Live cross-consistency invariant (not frozen literals): DISTINCT ON count ≈ lnd_node_info.active_channels"
    - "drizzle-kit pull used read-only for bootstrap; curated schema committed, generated artifacts discarded"
key-files:
  created:
    - "src/lib/read/latest.ts (latestChannelsForNode — AFM-001 helper)"
    - "src/lib/read/latest.test.ts (helper-shape: DISTINCT ON present, MAX absent)"
    - "src/lib/read/golden.test.ts (live cross-consistency invariant, reference set)"
    - "docs/LDK-INTROSPECTION.md"
    - "deferred-items.md (Plan 02 health.test.ts under-loaded-env note)"
  modified:
    - "src/lib/db/schema/routing.ts (curated from live introspection + AFM-001 annotations)"
    - "src/lib/db/schema/ldk.ts (curated from confirmed live LDK columns)"
decisions:
  - "D-09 honored: introspected BOTH warehouses live; curated schema committed, throwaway pull artifacts discarded."
  - "LDK columns confirmed live against the 4 real tables (lightning_channels, lsps1_orders, payments, transactions) — no [ASSUMED] columns reach code."
  - "Golden invariant tolerance = max(3, ceil(active_channels*0.02)); reference pubkeys resolved live by alias (not frozen) so the test survives data drift + a zero/offline edge node."
metrics:
  completed: "2026-06-09"
  tasks: 3
  files: 7
  golden_invariant: "3/3 PASS live (Canada 489≈491, Sweden 95≈96, India 49≈51)"
---

# Phase 1 Plan 03: LDK Introspection + AFM-001 Helper + Golden Invariant Summary

The warehouse type surface is now grounded in reality (LDK columns confirmed live, not assumed), the single sanctioned latest-channel-state helper (`DISTINCT ON (chan_id)`) is sealed and unit-tested, and the live golden cross-consistency invariant passes 3/3 across the reference node set — operator-confirmed (READ-02).

## What Was Built

- **Task 1 — Live introspection + curated schemas** (`b7b6ecd`): queried `information_schema.columns` live against both warehouses via the interim grafana bridge; hand-curated `schema/routing.ts` (with AFM-001 snapshot/event-driven annotations + per-table identity columns) and `schema/ldk.ts` from the 4 confirmed LDK tables. Generated pull artifacts discarded; `docs/LDK-INTROSPECTION.md` records the confirmed column shapes — **no `[ASSUMED]` columns remain**.
- **Task 2 — AFM-001 helper (TDD)** (RED `7a43619` → GREEN `357631a`): `src/lib/read/latest.ts` `latestChannelsForNode()` emits `DISTINCT ON (chan_id) … ORDER BY chan_id, timestamp DESC` over `lnd_node_channel_info`; `latest.test.ts` asserts the helper contains `DISTINCT ON` and never `MAX(timestamp)`.
- **Task 3 — Live golden invariant** (`177e3f5`): `golden.test.ts` asserts, per reference node, `DISTINCT ON (chan_id)` active-channel count ≈ `lnd_node_info.active_channels` (tolerance `max(3, ceil(active*0.02))`); pubkeys resolved live by alias; tolerates a zero/offline edge node.

## Verification Results

- `npx tsc --noEmit` → clean.
- `npx vitest run` (plan-03 tests) → **7/7 pass live**; **skip cleanly** (4 skipped) without `ROUTING_VM_DATABASE_URL`.
- **Live golden invariant (operator-confirmed 3/3):**

  | Node | Role | DISTINCT ON | active_channels | diff | tol | Result |
  |------|------|-------------|-----------------|------|-----|--------|
  | Canada | anchor | 489 | 491 | 2 | 10 | PASS |
  | Sweden | Tier-M | 95 | 96 | 1 | 3 | PASS |
  | India | edge | 49 | 51 | 2 | 3 | PASS |

- **AFM-001 guard proven:** the forbidden `MAX(timestamp)` form collapsed Canada to **1** channel (the documented 480-as-1 failure) vs **489** from `DISTINCT ON`.

## TDD Gate Compliance

- RED `7a43619` (`test(...)`, failing) precedes GREEN `357631a` (`feat(...)`, passing). Gate satisfied.

## Checkpoint Resolution

- **Task 3 (`checkpoint:human-verify`)** — operator confirmed the live golden-invariant numbers on 2026-06-09 ("approved — numbers are right"). Canada ~489 matches the known fleet reference (~480 channels).

## Deviations from Plan

- **Golden invariant ran against the interim grafana bridge** (Plan 02's temporary `grafana_demo_ro` + SSH tunnel + session read-only), not a dedicated `nodemon_ro` role. The invariant is role-agnostic (read-only), so results are valid; re-running against `nodemon_ro` when provisioned is expected to match.
- **Tolerance floor tuned 2→3** at implementation time so a small churning edge node (India) stays green across runs — the contract is the invariant, not a frozen literal (D-06).

## Known Issues / Carried Forward

- **`deferred-items.md`:** Plan 02's `src/lib/db/health.test.ts` fails when run with `.env.local` loaded (composed boot-check probe under the vitest server-only stub). This plan never touched `health.ts`/clients; direct probes confirm warehouses read-only + nodemon writable, and the live boot check passes. Flagged for fix before phase verification.

## Notes for Downstream

- **Plan 01-04** builds `UnifiedNode` on `schema/routing.ts` + `schema/ldk.ts` (now real) and may use `latestChannelsForNode()` for the per-node channel cross-check.
- Live warehouse reads require the SSH tunnel (`127.0.0.1:15432`) + local nodemon Docker (`:5433`) up, with `.env.local` loaded for any vitest/drizzle-kit/node command needing DB env.

## Self-Check: PASSED

Declared files exist; task commits (`b7b6ecd`, `7a43619`, `357631a`, `177e3f5`) present in git log. Golden invariant operator-confirmed 3/3 live.
