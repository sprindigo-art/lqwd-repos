---
phase: 18-hardening-vm-deploy-v1-v2
plan: 07
subsystem: db-read-layer
tags: [hardening, read-model, boot-health, perf-01, honest-stale, timezone]
requires:
  - 18-01 (test harness posture; DB-less shape-test convention)
provides:
  - role-level read-only boot probe (verifies GRANTS, not the session flag)
  - recency-bounded latest-read scans (channels / pg_health fleet / host_metrics_ext)
  - null-preserving channel base fee (unknown ≠ definite 0)
  - UTC-pinned nodemon session + UTC-idiom host-history window
affects:
  - src/lib/db/health.ts
  - src/lib/read/latest.ts
  - src/lib/read/pg-health.ts
  - src/lib/read/host-metrics-ext.ts
  - src/lib/read/host-history.ts
  - src/lib/db/nodemon.ts
tech-stack:
  added: []
  patterns:
    - "pure verdict classifier extracted to a DB-less module (read-only-probe.ts) for testability"
    - "(now() AT TIME ZONE 'UTC') - make_interval recency bound mirrors node-info PERF-01"
    - "single-entity fallback builder preserves >30d-stale detail reads"
key-files:
  created:
    - src/lib/db/read-only-probe.ts
  modified:
    - src/lib/db/health.ts
    - src/lib/read/latest.ts
    - src/lib/read/pg-health.ts
    - src/lib/read/host-metrics-ext.ts
    - src/lib/read/host-history.ts
    - src/lib/db/nodemon.ts
    - src/lib/queue/channel-enqueue-props.ts
    - src/components/node/NodeChannelsTable.tsx
decisions:
  - "Bypass the session read-only flag (SET LOCAL transaction_read_only = off) inside the probe so the write tests the ROLE grant, not the client session; only a genuine 42501 passes, a 25006 is inconclusive and fails loud."
  - "Extract classifyReadOnlyProbe into a pure DB-less module so the verdict logic is testable without env or a live warehouse (health.ts eagerly constructs the postgres singletons at import)."
  - "ChannelBaseline.baseFeeMsat becomes number|null; the honest DISPLAY path renders null as '—', while the fee-enqueue seed keeps ?? 0 as an explicit editable start (not a claimed current value)."
  - "host-metrics-ext single-host reads ARE the single-entity path; the host_id predicate is the entity bound and the 30d window adds the recency bound (no separate fallback needed — a >30d-silent host is eliminated by the freshness cutoff)."
metrics:
  duration: ~35m
  tasks: 2
  files_changed: 9
  tests_added: 15
  completed: 2026-07-27
---

# Phase 18 Plan 07: DB Read-Layer + Boot-Safety Hardening Summary

Role-level read-only boot probe (writes to a real table with the session flag stripped, requires a 42501 role-denial), plus recency-bounded latest-read scans, a null-preserving channel base fee, and a UTC-pinned nodemon session.

## What Was Built

### Task 1 — Role-level read-only boot probe (T-18-13, cross-engine conflict)
The old `assertReadOnly` created a TEMP table through a client that already forces `default_transaction_read_only = on`, so it only ever exercised the client's own SESSION flag — a role holding INSERT would pass, and a 42501 from a missing TEMP privilege passed too. The new probe:
1. strips the session read-only shield (`SET LOCAL transaction_read_only = off`),
2. attempts an `INSERT ... DEFAULT VALUES` on a REAL warehouse table (always rolled back), and
3. requires a genuine `42501` role-denial to PASS.

A `25006` (session flag still rejecting, e.g. a physical standby in recovery) is **inconclusive** and fails loud; an accepted write — or a later constraint error proving the privilege gate was passed — means the role can write and also fails loud. The verdict logic lives in a new pure module `src/lib/db/read-only-probe.ts` (`classifyReadOnlyProbe`) so it is testable without env or a live DB.

### Task 2 — Bounded windows + null-not-zero + UTC pin (T-18-14, T-18-15, DB1)
- **Recency bounds (PERF-01 mirror):** 30-day `(now() AT TIME ZONE 'UTC') - make_interval` predicate added to the channels `DISTINCT ON` (`latest.ts`), the pg_health fleet `ROW_NUMBER` scan (`pg-health.ts`), and every per-host latest+prior scan in `host-metrics-ext.ts`. The `DISTINCT ON`/`ROW_NUMBER` shapes are unchanged — only a recency predicate is added, never the AFM-001 `MAX(timestamp)` form.
- **Single-entity fallbacks:** `buildLatestChannelSql`/`latestChannelForNode` (unbounded, LIMIT 1) preserve a >30-day-stale channel's detail read; the single-host `buildLatestPgHealthSql` stays unbounded as the pg_health fallback.
- **null-is-not-zero:** `projectChannelBaseline` preserves a NULL `outgoing_fee_base_msat` as `null` (unknown), never coerced to a definite 0. `ChannelBaseline.baseFeeMsat` is now `number | null`; the channels table renders unknown as `—`, and the fee-enqueue props seed `?? 0` as an explicit editable start.
- **Timezone (DB1):** `dbNodemon` pins `TimeZone: "UTC"`, and both `host-history.ts` window builders switched from bare `now()` to `(now() AT TIME ZONE 'UTC')` so the 24h/30d windows no longer shift by the session offset.

## Tests
- `classifyReadOnlyProbe`: 42501 ⇒ pass, 25006 ⇒ inconclusive (never a pass), accepted/constraint ⇒ writable.
- Channels `DISTINCT ON` carries the UTC recency window; single-channel fallback carries none; NULL base fee stays null.
- pg_health fleet scan carries the window; single-host reader does not (fallback).
- host-metrics-ext scalar + child scans carry the window.
- host-history 24h window uses the UTC idiom.
- Full suite: **1503 passed / 57 skipped**; typecheck clean; touched files lint clean (0 errors).

## Deviations from Plan

### Auto-fixed / auto-added (Rules 2–3)

**1. [Rule 3 - Blocking] New file `src/lib/db/read-only-probe.ts`**
- **Found during:** Task 1
- **Issue:** `health.ts` eagerly constructs the `postgres()` client singletons at module load (they call `requireEnv`), so importing it in a no-network test throws. The plan's behavior tests need the verdict logic without a live DB.
- **Fix:** Extracted the pure `classifyReadOnlyProbe` + SQLSTATE constants into a DB-less module; `health.ts` imports and re-uses them.
- **Commit:** 85a5e0d

**2. [Rule 3 - Blocking] `ChannelBaseline.baseFeeMsat` type ripple**
- **Found during:** Task 2
- **Issue:** Changing `baseFeeMsat` to `number | null` broke two consumers (`channel-enqueue-props.ts`, `NodeChannelsTable.tsx`) that expected a definite number.
- **Fix:** Display path (`NodeChannelsTable`) renders `null` as `—`; the fee-enqueue seed uses `?? 0` as an explicit editable start (mirrors the existing `currentPpm ?? 0` on the line above) so the queue schema's definite-number contract holds while the display stays honest.
- **Commit:** dee0b7a

No architectural (Rule 4) changes; no auth gates.

## Threat Register Outcomes
- **T-18-13** (tautological read-only probe) — mitigated: role-level write-denial probe requires 42501.
- **T-18-14** (unknown base fee shown as 0) — mitigated: NULL preserved through to an honest `—` display.
- **T-18-15** (unbounded full-partition scan) — mitigated: recency window + single-entity fallback on all three scan sites.

## LOCKED Guardrails Preserved
- No `WHERE timestamp = MAX(...)` introduced; all `MAX(` occurrences are anti-pattern warnings in comments only.
- `DISTINCT ON`/`ROW_NUMBER` latest-per-key shapes unchanged (recency predicate added, ordering intact).
- All identifiers parameter-bound; the probe's hardcoded table names use `sql.raw` on constants only (no user input).

## Self-Check: PASSED
- FOUND: src/lib/db/read-only-probe.ts
- FOUND commits: eee8f0d, 85a5e0d, 70c1c95, dee0b7a
