---
phase: 16-collector-enrichment-robust-log-capture
plan: 01
subsystem: testing
tags: [python-unittest, vitest, log-capture, cursor, tdd-red, taxonomy, ap12]

# Dependency graph
requires:
  - phase: 15-collector-log-capture
    provides: "extract_events / _normalize / _classify collector helpers and the service-log-events reader + ap12-advisory detector this plan pins"
provides:
  - "Wave-0 RED test scaffolding pinning read_since (cursor/rotation/bounded-bytes), resolve_artifact (PG newest-glob), capture-by-pattern, tier gating, and IP:port normalization before any collector code changes"
  - "TS guardrails locking the D-04 read-layer taxonomy-reconcile surface (config_id=NULL survival, level narrowing, counter-driven AP-12)"
affects: [16-02, 16-03, 16-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy in-method imports for RED tests referencing not-yet-existent symbols (keeps the module importable so pre-existing tests still run)"
    - "return_aggregate=True kwarg as the planned surface for D-06 aggregate survival under tier gating"

key-files:
  created: []
  modified:
    - scripts/fileserver/test_extract.py
    - src/lib/read/service-log-events.test.ts
    - src/lib/insight/detectors/ap12-advisory.test.ts

key-decisions:
  - "Modeled aggregate survival via a return_aggregate=True kwarg on extract_events (16-03 implements the (exemplars, aggregates) return shape)"
  - "Rotation tests pin read_since's documented reset-to-0 semantics; the day-roll drain is expressed as a resolve_artifact path-change signal (orchestration lives in the tick loop)"

patterns-established:
  - "RED tests import target symbols lazily inside each test method so a missing symbol errors ONLY that test, never the harness import"
  - "Capture-by-pattern tests pass an error_pattern ABSENT from the target lines so current substring-gated code returns [] (guaranteed RED, turnable-green by the config-regex gate)"

requirements-completed: [COL-04, COL-05, COL-06]

# Metrics
duration: ~18min
completed: 2026-07-16
---

# Phase 16 Plan 01: Wave-0 Capture Test Scaffolding Summary

**16 offline tests (7 Python collector RED classes + TS D-04 guardrails) that pin every new capture mechanic — cursor/rotation/bounded-bytes, capture-by-regex, tier gating, IP:port normalization — before any collector code ships.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-16T10:46Z
- **Completed:** 2026-07-16T10:54Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added 7 Python `unittest` TestCase classes (16 new test methods) to `test_extract.py` covering the Wave-0 gaps: cursor resume/first-sight/trailing-partial, dual rotation (inode-change + size-shrink), PG newest-glob resolution + day-roll, bounded-bytes-per-tick with logged truncation, capture-by-pattern ([WRN]/[CRT] without the error_pattern substring), tier gating (info→zero exemplars + aggregate survival, warn≤KEEP_N, critical), and IP:port signature collapse.
- All new collector tests are RED for the right reason (missing `read_since`/`resolve_artifact`/`return_aggregate` and missing tier/normalize behavior) — the 27 pre-existing tests stay green via lazy in-method imports.
- Added TS guardrails: `service-log-events.test.ts` pins config_id=NULL survival (LEFT JOIN + COALESCE, never a classification-string join / `config_id IS NOT NULL` filter) and the {info,warn,critical} level narrowing; `ap12-advisory.test.ts` adds the D-04 regression guard proving AP-12 cards fire purely from pg_health counters with the AI path never touched and the two signal ids intact.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend test_extract.py with RED cursor/rotation/capture/tier/normalize tests** - `4068b9c` (test)
2. **Task 2: Extend TS tests — taxonomy narrowing, config_id=NULL survival, AP-12 D-04 guard** - `952ccc1` (test)

_No TDD RED/GREEN split — this plan authors RED scaffolding only; production behavior is turned green by 16-02/16-03/16-04._

## Files Created/Modified
- `scripts/fileserver/test_extract.py` - +7 Wave-0 TestCase classes pinning the D-09 cursor interface and COL-05 capture/tier/normalize behaviors (DB-free, tempfile-only fixtures)
- `src/lib/read/service-log-events.test.ts` - +config_id=NULL survival and taxonomy level-narrowing guardrails
- `src/lib/insight/detectors/ap12-advisory.test.ts` - +D-04 counter-driven independence guard (detector unaffected by dropping the "ap12" log class)

## Decisions Made
- **Aggregate survival API:** the plan's must_have ("info → zero exemplars while the aggregate count survives") is pinned via a `return_aggregate=True` kwarg on `extract_events`, returning `(exemplars, aggregates)`. Current code lacks the kwarg → `TypeError` → unambiguous RED; 16-03 implements the shape. Chosen over inventing a new top-level function name (the plan only names `read_since`/`resolve_artifact`/`save_cursors`).
- **Rotation scope:** single-file `read_since` tests assert the documented reset-to-0 semantics for both inode-change (LND rename-archive) and size-shrink. The PG day-roll "drain previous file" is expressed as a `resolve_artifact` newest-vs-cursor path-change signal, since the actual drain decision is tick-loop orchestration rather than a pure unit.

## Deviations from Plan

None - plan executed exactly as written. Both tasks landed with the specified test classes, RED for the collector scaffolding and green for the TS guardrails.

## Issues Encountered
None. The verify gates behaved as designed: `python3 scripts/fileserver/test_extract.py` reports `FAILED (failures=3, errors=11)` across only the 7 new classes (RED-as-expected), and `npx vitest run` shows 28 passed / 4 DB-gated skipped for the TS guardrails.

## User Setup Required
None - no external service configuration required. All fixtures are tempfile-only; no DB, no network (T-16-01 honored).

## Next Phase Readiness
- 16-02 (cursor) turns TestCursorReadSince/TestRotation/TestPgGlobNewestMatch/TestBoundedBytes green by implementing `read_since`, `resolve_artifact`, `save_cursors`, `INITIAL_TAIL_BYTES`, `MAX_BYTES_PER_TICK`.
- 16-03 (capture/tier/normalize) turns TestCaptureByPattern/TestTierGating/TestIpPortNormalize green via the config-regex capture gate, classification-driven tier gating with `return_aggregate`, and `_RE_IP_PORT` in `_normalize`.
- 16-04 (taxonomy read reconcile) must keep the TS guardrails green while re-deriving classification into {info,warn,critical}.

## Self-Check: PASSED

- All 3 modified files present on disk.
- Both task commits present in git history (`4068b9c`, `952ccc1`).

---
*Phase: 16-collector-enrichment-robust-log-capture*
*Completed: 2026-07-16*
