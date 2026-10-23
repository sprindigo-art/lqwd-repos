---
phase: quick-260721-fou
plan: 01
subsystem: fileserver-telemetry-collector
tags: [telemetry, service-health, lnd, functioning-probe, fleet-safety]
requires:
  - grade_log_service / extract_events / read_since (COL-01/04/05)
provides:
  - persistent-proc functioning semantics (running AND fresh, down only on critical)
  - _count_persistent_critical code-side FATAL/[CRT] detector
  - honest service_health.detail reason on functioning=false pgrep rows
affects:
  - scripts/fileserver/collect_telemetry.py
  - scripts/fileserver/test_extract.py
tech-stack:
  added: []
  patterns:
    - code-side signature detector mirroring _count_pg_log_signatures (no live-DB config dependency)
    - detection_method-branched grading (pgrep vs batch)
key-files:
  created: []
  modified:
    - scripts/fileserver/collect_telemetry.py
    - scripts/fileserver/test_extract.py
decisions:
  - "Persistent (pgrep) functioning = running AND fresh, downed ONLY by a FATAL/[CRT]-class signature; benign [ERR] count no longer gates it."
  - "Critical detection is code-side (_count_persistent_critical) so no service_inventory / log_patterns_config row edit is needed to fix the fleet."
  - "Batch/non-pgrep services keep the prior fresh AND error_count==0 + success_pattern rule, byte-for-byte (Test 5 regression guard)."
  - "Fresh pgrep procs set last_success_at = artifact mtime (log-liveness success proxy)."
metrics:
  duration: ~15m
  completed: 2026-07-21
  tasks: 3
  files_changed: 2
  tests_total: 57
  tests_new: 14
---

# Phase quick-260721-fou Plan 01: Gap A — Fix LND Functioning Probe Summary

Redefined the LND "functioning" probe in `collect_telemetry.py` so persistent (pgrep) procs grade `functioning = running AND fresh` — downed only by a code-side FATAL/[CRT]-class signature — ending the fleet-wide false `functioning=false` that benign LND `[ERR]` lines caused, while preserving `[ERR]` capture and adding honest `detail` reasons. Batch/non-pgrep services are provably unchanged.

## What Was Built

**A2c (capture-first, Task 1):** Locked the existing `error_pattern`-substring capture path with `TestPersistentErrCapture` — benign `[ERR]` lines in a fresh pgrep tail produce capped `service_log_events` exemplars (`<= KEEP_N`) while the aggregate `sig_tick_count` reflects the true count. No production change was needed; the test guards Task 2 from silently taking capture down when the `error_count` gate is dropped.

**A2a (redefine functioning, Task 2):**
- Added module constant `PERSISTENT_CRITICAL_SIGNATURES = (r"\[CRT\]", r"\bFATAL\b", r"\bFTL\b")` and pure detector `_count_persistent_critical(text) -> int` (mirrors `_count_pg_log_signatures`; one count per line even on multi-match).
- Branched `grade_log_service` on `detection_method`:
  - **pgrep:** `functioning = bool(running and fresh and critical_hits == 0)`, where `critical_hits = _count_persistent_critical(text)` PLUS any `log_aggregates` entry with `classification == "critical"`. `error_count` is still computed/returned but no longer gates functioning. When fresh and no success marker, `last_success_at = artifact mtime`.
  - **batch/other:** unchanged `bool(fresh and error_count == 0)`; `last_success_at` only via `success_pattern`.
- Bumped `COLLECTOR_VERSION` 16.06 → 16.07.

**A2b (honest detail, Task 3):** On every `functioning=false` pgrep row, `detail` is set in priority order: `artifact missing` → `artifact stale (Nm old)` → `N critical signature(s) in tail` → `process not running (pgrep)` → concise summary. `functioning=true` rows keep `detail=None`. Batch rows keep their prior detail behavior. (The detail code lives in the same `grade_log_service` branch and shipped in the Task 2 commit; Task 3 added `TestFunctioningDetail` to pin the contract.)

## Tasks & Commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (A2c) | Lock [ERR] capture before dropping the count gate | 5dfc7f4 |
| 2 (A2a) | Redefine functioning for persistent (pgrep) procs | e1ccdb4 |
| 3 (A2b) | Pin honest detail reasons for functioning=false pgrep rows | f5b6a1f |

## Verification

- `python3 scripts/fileserver/test_extract.py` → **57 tests OK** (43 pre-existing + 14 new). The 5 mandated cases all pass:
  1. benign-[ERR] pgrep fresh → `functioning=True` (`test_1_benign_err_fresh_pgrep_is_functioning_true`)
  2. [CRT]/FATAL pgrep → `functioning=False` + detail (`test_2_crt...`, `test_2_fatal_word...`, `test_2_crt_detail_names_critical_signature`)
  3. stale-artifact pgrep → `False` + `"artifact stale (60m old)"` (`test_3_stale_pgrep_reports_artifact_stale_with_age`)
  4. [ERR] lines produce captured events (`TestPersistentErrCapture`)
  5. non-pgrep batch service unchanged regression guard (`test_5_batch_service_keeps_error_count_rule`)
- `python3 -c "import ast; ast.parse(...)"` → `collect_telemetry.py: syntax OK`.
- **Note on harness:** the plan's verify commands use `python3 -m pytest`, but pytest is not installed in this environment (`No module named pytest`). The test file is stdlib `unittest` and runs identically under `python3 test_extract.py`; all 57 tests pass. On a pytest-equipped host the same file runs under `python3 -m pytest scripts/fileserver/test_extract.py -q` unchanged.

## Deviations from Plan

None affecting behavior. Two notes:
- The A2b `detail` production code and the A2a functioning code both live in the single `grade_log_service` function, so the detail logic landed in the Task 2 commit (e1ccdb4); Task 3's commit (f5b6a1f) adds the `TestFunctioningDetail` tests that pin it. Documented in the commit messages.
- Added two extra guard tests beyond the 5 mandated: `test_5b_batch_service_functioning_true_when_clean` (batch stays GREEN when clean) and `test_functioning_true_carries_no_false_reason` (no false detail on healthy rows).

## Operator Ops Steps (NOT done here — out of scope)

- **Redeploy the collector** to the fileserver/nodes: the fleet-wide empty `service_log_events` / false `functioning=false` is in part a deployed-build lag. This change was implemented and tested in-repo only; it was NOT deployed or run against live nodes.
- `COLLECTOR_VERSION` was bumped to `16.07` in-repo so the rollout is auditable in `collect-telemetry.log`; the actual promotion is a separate operator action.
- **No live-DB config changes required** — critical-signature detection is code-side, so no `service_inventory` / `log_patterns_config` row edits are needed to fix the fleet.

## Known Stubs

None.

## Self-Check: PASSED

- scripts/fileserver/collect_telemetry.py — FOUND (modified)
- scripts/fileserver/test_extract.py — FOUND (modified)
- Commit 5dfc7f4 — FOUND
- Commit e1ccdb4 — FOUND
- Commit f5b6a1f — FOUND
