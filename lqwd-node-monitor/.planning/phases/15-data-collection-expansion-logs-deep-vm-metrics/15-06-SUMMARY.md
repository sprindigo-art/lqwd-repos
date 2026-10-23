---
phase: 15-data-collection-expansion-logs-deep-vm-metrics
plan: 06
subsystem: collector
tags: [python, psycopg2, logs, signature-dedup, redaction, rls, retention]
requires: [15-01]
provides:
  - extract_events/_normalize/_redact/_classify log-capture helpers (stdlib-only)
  - fetch_log_patterns_config per-tick config read (selects row id for config_id)
  - _insert_log_events (service_log_events exemplars incl. config_id)
  - _upsert_log_patterns (D-03 ON CONFLICT (host_id, signature) aggregate)
  - _prune_tiered (keep-N exemplars + classification-tiered windows, D-08)
  - scripts/fileserver/test_extract.py (17 offline unit tests)
affects: [15-03, 15-07, 15-09]
tech-stack:
  added: []
  patterns:
    - signature = sha256(_normalize(line)) dedup; normalization strips ts/pids/long-hex/=digits
    - redact-before-store (password/secret/macaroon kv + long hex/base64 blobs -> <redacted>)
    - per-tick KEEP_N exemplar cap with sig_tick_count carrying the true occurrence count
    - classification-tiered retention via absent-from-map = never-pruned (ap12/critical)
key-files:
  created:
    - scripts/fileserver/test_extract.py
  modified:
    - scripts/fileserver/collect_telemetry.py
    - .gitignore
decisions:
  - "KEEP_N = 2 exemplars per signature per tick (first-seen + newest); sig_tick_count carries the TRUE per-tick count so log_patterns.count_window is accurate even when exemplars are capped (D-07)"
  - "Retention windows: benign 21d, warn/ap11 90d, ap12/critical NEVER time-pruned; unmatched 'other' given 90d (plan left it unspecified — unknown importance warrants more than the benign window)"
  - "Middle-exemplar eviction (keep first-seen + newest per signature) applies only to high-frequency classes benign/other; log_patterns aggregate never deleted"
  - "psycopg2 import guarded (try/except) with a main() fail-fast so test_extract.py imports offline — migration 0003 is not yet applied to the live DB, so all verification is offline by design"
  - "Tests authored as stdlib unittest TestCases (plan allowed pytest/unittest; pytest not installed locally) — pytest-compatible def test_ methods, runnable via python3 -m unittest test_extract"
metrics:
  duration: ~10m
  completed: 2026-07-14
---

# Phase 15 Plan 06: Collector Log Persist Path Summary

grade_log_service's line-289 discard is fixed: matched log lines now become redacted, signature-deduped service_log_events exemplars (carrying config_id, the Plan-03 suppress join key) plus a forever log_patterns aggregate, all inside the write_tick RLS transaction with keep-N + classification-tiered retention.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | extract_events + _normalize + _redact + config read (with tests) | 461dd54 | scripts/fileserver/collect_telemetry.py, scripts/fileserver/test_extract.py |
| 2 | Wire persist path into grade_log_service + write_tick + tiered prune | 1a06aa6 | scripts/fileserver/collect_telemetry.py |
| — | Ignore Python bytecode from test runs | e9060cc | .gitignore |

## What Was Built

- **Capture helpers (Task 1):** `_normalize` strips ISO + syslog timestamps, `[pid]` brackets, ≥16-char hex, and `=<digits>` so recurring lines collapse to one `hashlib.sha256` signature (D-02). `_redact` scrubs `password=`/`secret=`/`macaroon=`/`token=`/key-like values plus ≥32-char hex and ≥48-char base64 blobs to `<redacted>` from BOTH message and context_lines before storage (T-15-05 / CLAUDE.md logging rule). `extract_events(text, error_pattern, service, level, config, context=5, source_path=None)` captures ±5 context lines (D-01), classifies via the `log_patterns_config` rows recording BOTH classification AND the matched row's `id` as `config_id` (unmatched → `"other"`/None), truncates message ≤8000 chars, and caps exemplars at `KEEP_N=2` per signature per tick (first-seen + newest) while `sig_tick_count` keeps the true occurrence count. `fetch_log_patterns_config` mirrors the `fetch_inventory` parameter-bound SELECT + `conn.rollback()` idiom and selects the row `id`.
- **Persist wiring (Task 2):** `grade_log_service` calls `extract_events` at the old discard point (error_count retained for service_health), stamps each event with the inventory row's `node_pubkey`, and threads events up through `grade_service` → `main()` → `write_tick(..., log_events)`. `_insert_log_events` (a `%s`-placeholder loop mirroring `_insert_host_storage`) writes all 11 columns including `config_id`; `_upsert_log_patterns` does the D-03 `ON CONFLICT (host_id, signature) DO UPDATE` bumping `count_window` additively by `sig_tick_count`. Both run INSIDE the existing `with conn:` transaction AFTER the two `SET LOCAL` lines (T-15-02 / Pitfall 2).
- **Tiered prune (Task 2):** `_prune` → `_prune_tiered`: plain 21d loop over the fixed `PRUNE_TABLES` allow-list unchanged; `service_log_events` gets classification-tiered time windows (benign 21d, other/warn/ap11 90d, ap12/critical absent from the map = never time-pruned) via `%s::interval` binding, plus a window-function DELETE that evicts redundant MIDDLE exemplars per `(host_id, signature)` for benign/other only, always keeping first-seen + newest. No DELETE ever touches `log_patterns`; no hard per-tick ceiling drops distinct signatures (D-07).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] pytest not installed on the local machine**
- **Found during:** Task 1 (plan verify command uses `python3 -m pytest`)
- **Issue:** No pytest module locally; the plan's action line explicitly allows "(pytest/unittest, stdlib)"
- **Fix:** Tests written as stdlib `unittest.TestCase` classes with `def test_` methods — natively pytest-collectable; verified via `python3 -m unittest test_extract` (17 tests, all pass). No package install attempted.
- **Files modified:** scripts/fileserver/test_extract.py
- **Commit:** 461dd54

**2. [Rule 3 - Blocking] psycopg2 not installed locally (offline-testability requirement)**
- **Found during:** Task 1 (test_extract.py must import collect_telemetry without a DB driver)
- **Issue:** Top-level `import psycopg2` made the module un-importable offline
- **Fix:** Guarded the import (`try/except ImportError`, mirroring the existing dotenv guard) with a `main()` fail-fast (`FATAL: psycopg2 not installed`). Node-side behavior unchanged (psycopg2 is already deployed there).
- **Files modified:** scripts/fileserver/collect_telemetry.py
- **Commit:** 461dd54

**3. [Untracked-files rule] `scripts/fileserver/__pycache__/` left untracked by test runs**
- **Fix:** Added `__pycache__/` + `*.pyc` to `.gitignore`
- **Commit:** e9060cc

## Verification

- `python3 -m py_compile collect_telemetry.py` — clean.
- `python3 -m unittest test_extract` — 17/17 green: signature stability (ts/pid/hex/=n variants), distinct lines don't collapse, macaroon-hex + `password=` + base64 redaction in message AND context, ±5 context window (incl. file-start clamp), ≤KEEP_N exemplar cap with true `sig_tick_count`, distinct signatures never dropped, matched-row classification + `config_id` capture, unmatched → `other`/None, `source_path` threading, ≤8000-char truncation.
- Grep gates: `ON CONFLICT (host_id, signature)` present; `DELETE FROM log_patterns ` absent; `shell=True` absent (EXEC-02); `\.format\(|f"INSERT|f"DELETE|% \(` absent (T-15-01).
- Source assertions: `_insert_log_events`/`_upsert_log_patterns` called inside `write_tick` after both `SET LOCAL` lines; `config_id` in the insert column list; ap12/critical absent from `LOG_RETENTION_WINDOWS` (time-prune exempt).
- Live insert with config_id is proven on the canary in Plan 09 (migration 0003 apply is operator-gated per 15-01).

## Threat Flags

None — all new surface is inside the plan's threat model (T-15-01 parameter binding, T-15-02 RLS txn placement, T-15-04 KEEP_N + truncation + tiered retention, T-15-05 redaction).

## Known Stubs

None introduced by this plan.

## Self-Check: PASSED

- FOUND: scripts/fileserver/collect_telemetry.py (contains "log_patterns")
- FOUND: scripts/fileserver/test_extract.py (contains "def test_")
- FOUND commits: 461dd54, 1a06aa6, e9060cc
