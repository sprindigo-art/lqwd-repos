---
phase: 11-full-stack-telemetry-ingestion
plan: 04
subsystem: read-model
tags: [telemetry, afm-001, distinct-on, staleness, blocks-behind, bands, honesty-gate, drizzle, vitest, tdd]

# Dependency graph
requires:
  - phase: 11-01
    provides: nodemon telemetry schema (hosts, host_metrics, host_storage, chain_telemetry)
  - phase: 11-03
    provides: TELEMETRY_BANDS + evaluateBand (D-14), seeded telemetry-fixture, units.ts formatters, parseDbTimestampUtc
provides:
  - "getLatestHostMetrics + buildLatestHostMetricsSql/buildLatestHostStorageSql (AFM-001 latest-per-host vitals + storage)"
  - "computeStorageGrowth (pure %/day + time-to-full with HOST-02 honesty gate)"
  - "getChainTelemetry + deriveBlocksBehind + buildChainEvidence (read-time blocks-behind + D-14 bands)"
  - "deriveStale (read-time D-13 staleness predicate)"
affects: [12, 13, 14, 15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AFM-001 DISTINCT-ON builder/executor split cloned for host_id / (host_id, mount_point) telemetry keys"
    - "Fleet reads LEFT JOIN the hosts dimension so declared-but-silent hosts surface as no-data (SC#4), never absent"
    - "Read-time staleness (D-13) and read-time blocks-behind / bands (D-14) — raw values stored, derivation never persisted"
    - "Pure HOST-02 honesty gate returns an explicit no-projection status, never a fabricated number or Infinity"

key-files:
  created:
    - src/lib/read/host-metrics.ts
    - src/lib/read/host-metrics.test.ts
    - src/lib/read/storage-growth.ts
    - src/lib/read/storage-growth.test.ts
    - src/lib/read/chain-telemetry.ts
    - src/lib/read/chain-telemetry.test.ts
  modified:
    - .planning/phases/11-full-stack-telemetry-ingestion/deferred-items.md

key-decisions:
  - "Fleet executors drive from the hosts dimension via LEFT JOIN to a DISTINCT-ON latest subquery, so a never-reported host returns NULL facts → hasData=false / stale=true (no-data), not a missing row."
  - "blocks-behind = headers - blocks is computed in TS at read time and returns null when either side is missing, so consumers never render a phantom 0 (D-14)."
  - "deriveStale is exported from host-metrics and reused by chain-telemetry — one read-time staleness predicate (~15-min window), no stored flag (D-13)."
  - "storage-growth stays a pure ratio/percentage-point/day module (no byte-unit scaling, no DB) so it unit-tests like units.ts; the honesty gate orders sample-count → stale → window → flat/negative."

patterns-established:
  - "Per-host build*Sql fragments ($1-bound, DISTINCT ON the entity key) exist for the no-DB shape test; private fleet builders add the hosts LEFT JOIN for the executor."
  - "buildChainEvidence is a pure, exported (row)->{blocksBehind, bands} transform — always-run band coverage without a live DB."

requirements-completed: [TEL-01, TEL-03]

# Metrics
duration: ~30min
completed: 2026-06-29
---

# Phase 11 Plan 04: Telemetry Read Helpers Summary

**Three read-time helpers — `host-metrics` (AFM-001 latest-per-host vitals + storage), `storage-growth` (pure %/day + time-to-full behind a HOST-02 honesty gate), and `chain-telemetry` (latest chain stats + read-time blocks-behind + D-14 bands) — all deriving staleness at read time (D-13) and never re-deriving the DISTINCT-ON query downstream (D-15).**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-06-29T11:53:00Z (approx)
- **Completed:** 2026-06-29T12:00:00Z (approx)
- **Tasks:** 3 (all TDD)
- **Files modified:** 7 (6 created, 1 modified)

## Accomplishments
- **host-metrics.ts** — `buildLatestHostMetricsSql` (DISTINCT ON (host_id)) and `buildLatestHostStorageSql` (DISTINCT ON (host_id, mount_point)), both `$1`-bound and never `MAX(`. `getLatestHostMetrics` LEFT JOINs the `hosts` dimension to a DISTINCT-ON latest subquery so silent hosts read as no-data, coerces `collected_at` via `parseDbTimestampUtc`, and derives `stale` at read time. Reads the RW `dbNodemon` client (never `dbRouting`).
- **storage-growth.ts** — pure `computeStorageGrowth`: %/day growth + projected days-to-full from a passed-in `host_storage` series, with the HOST-02 honesty gate returning `insufficient-samples` / `insufficient-window` / `stale` / `flat-or-negative` (and `daysToFull = null`) instead of a fabricated number. No DB import, no inline byte-unit math.
- **chain-telemetry.ts** — `buildLatestChainTelemetrySql` (DISTINCT ON (host_id), `$1`-bound), `getChainTelemetry` (hosts LEFT JOIN), `deriveBlocksBehind` (`headers - blocks` at read time, null-safe), and `buildChainEvidence` attaching `blocksBehind` / `verificationProgress` / `peers` D-14 bands via `evaluateBand`.

## Task Commits

Each task was committed atomically (TDD tasks: test → feat):

1. **Task 1: host-metrics latest-per-host vitals + storage** — `be43e81` (test), `1c9e9dd` (feat)
2. **Task 2: storage-growth pure %/day + honesty gate** — `e1da490` (test), `038a17e` (feat)
3. **Task 3: chain-telemetry latest + blocks-behind + bands** — `78a1b72` (test), `5879c58` (feat)

## Files Created/Modified
- `src/lib/read/host-metrics.ts` — AFM-001 latest-per-host vitals + storage from `dbNodemon`; read-time staleness; exported `deriveStale`.
- `src/lib/read/host-metrics.test.ts` — no-DB shape (distinct-on / never-max / `$1`), `deriveStale` cases, seeded latest-per-host / stale / no-data describe (skipIf-gated).
- `src/lib/read/storage-growth.ts` — pure `computeStorageGrowth` + HOST-02 honesty gate.
- `src/lib/read/storage-growth.test.ts` — healthy projection + insufficient/window/stale/flat/negative + unsorted/bigint cases.
- `src/lib/read/chain-telemetry.ts` — AFM-001 latest chain + `deriveBlocksBehind` + `buildChainEvidence` (D-14 bands).
- `src/lib/read/chain-telemetry.test.ts` — no-DB shape, `deriveBlocksBehind`, `buildChainEvidence` band grading, seeded describe (skipIf-gated).
- `.planning/.../deferred-items.md` — re-confirmed the pre-existing off-DB queue-test failures.

## Decisions Made
- **No-data via dimension LEFT JOIN:** both fleet executors start from `hosts` and LEFT JOIN the DISTINCT-ON latest subquery, so a declared-but-never-reported host returns a row with NULL facts → `hasData=false`, `stale=true`. This satisfies SC#4 (silent host ≠ absent host) without a separate "expected set" query.
- **Read-time blocks-behind, null-safe:** `headers - blocks` is computed in TS and returns `null` when either is missing, so the band evidence and UI never show a phantom `0` for a host with no chain row (D-14: no stored `blocks_behind` column — confirmed absent from `schema/nodemon.ts`).
- **Single staleness predicate:** `deriveStale` lives in `host-metrics.ts` and is imported by `chain-telemetry.ts` — one ~15-min D-13 window, derived from `collected_at`, never a stored flag.
- **storage-growth purity:** the module deals only in ratios (`used/total`), percentage-points, and days — no byte-unit scaling here (that stays in `units.ts`, AFM-002), keeping it a DB-free unit-testable transform.

## Deviations from Plan

**1. [Rule 1 - cosmetic] storage-growth doc-comment reworded to satisfy the acceptance grep gate.**
- **Found during:** Task 2 verification.
- **Issue:** An explanatory comment literally contained `/ 1024 ** 3`, which tripped the `grep -nE '/\s*1024'` "no inline byte math" acceptance gate (a false positive — it was prose, not code).
- **Fix:** Reworded the comment to "no inline binary byte-unit scaling" without the literal pattern. No behavior change.
- **Files modified:** `src/lib/read/storage-growth.ts`
- **Commit:** `038a17e` (folded into the Task 2 feat commit)

Otherwise the plan executed exactly as written.

## Issues Encountered
- **Pre-existing off-DB queue test failures (out of scope).** `npx vitest run` shows 4 failing files in `src/lib/queue/` (enqueue / approve / claim / stub-executor) because they reach `requireEnv("NODEMON_QUEUE_URL")` and are NOT gated behind `describe.skipIf`. Plan 04 touched **zero** queue files (`git diff --name-only 438129d HEAD` confirms); these are pre-existing Phase-6 failures already logged in `deferred-items.md`. Not fixed per the SCOPE BOUNDARY rule. Every `src/lib/read` test passes (105 passed | 14 seeded skipped).

## Verification
- `npx vitest run src/lib/read` → **9 passed | 2 skipped (files); 105 passed | 14 skipped (tests)**. Seeded telemetry describes skip cleanly with no `NODEMON_QUEUE_URL` (expected; the telemetry migration to prod is operator-deferred).
- No-DB shape gates: each helper's emitted SQL contains `distinct on (host_id)` (chain/host) and `distinct on (host_id, mount_point)` (storage), contains no `max(`, and binds the hostId as `$1`.
- Source assertions: `grep '@/lib/db'` in both executors → only `@/lib/db/nodemon` (never `warehouse-routing`); `grep 'evaluateBand'` present in chain-telemetry; `blocks_behind` absent from `schema/nodemon.ts`.
- Purity gates: `storage-growth.ts` has no `server-only` / `@/lib/db` import and no `/1024` byte math.
- `npx tsc --noEmit` → no errors in the three new helpers.
- Full suite: 846 passed | 46 skipped, with the 4 pre-existing queue failures the only reds (unrelated, logged).

## User Setup Required
None for the helpers themselves. To exercise the seeded describes locally, set `NODEMON_QUEUE_URL` to a test nodemon DB that has the Plan-01 telemetry migration applied; otherwise they skip cleanly (the intended off-DB behavior).

## Next Phase Readiness
- Phases 12-15 consume `getLatestHostMetrics` / `getChainTelemetry` / `computeStorageGrowth` directly and must NOT re-derive the latest-per-host query (D-15) — the DISTINCT-ON discipline lives here.
- Host-vitals and chain panels render bigint columns through `units.ts` formatters at the display boundary; the read helpers deliberately surface raw typed values + band evidence, no formatting.

## Self-Check: PASSED

All 6 created files present on disk; the modified deferred-items file present; all 6 task commits (`be43e81`, `1c9e9dd`, `e1da490`, `038a17e`, `78a1b72`, `5879c58`) present in git history.

---
*Phase: 11-full-stack-telemetry-ingestion*
*Completed: 2026-06-29*
