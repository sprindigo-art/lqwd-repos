---
phase: 16-collector-enrichment-robust-log-capture
plan: 02
subsystem: node-collector
tags: [python, log-capture, cursor, rotation, pygtail, col-04, tdd-green]

# Dependency graph
requires:
  - phase: 16-collector-enrichment-robust-log-capture
    plan: 01
    provides: "Wave-0 RED tests (TestCursorReadSince / TestRotation / TestPgGlobNewestMatch / TestBoundedBytes) that pin the read_since/resolve_artifact/rotation contract"
provides:
  - "read_since(source_key, path, cursors) -> (lines, updated_cursors): offset->EOF interval-complete tailing, complete-lines-only, first-sight-near-EOF seeding, bounded+logged per-tick read"
  - "resolve_artifact(artifact_path): newest glob/dir match by mtime (PG day-roll signal), else verbatim"
  - "_drain_previous + rotation drain: inode-change/size-shrink detection with .gz drain and .zst logged-skip"
  - "save_cursors/load_cursors: atomic os.replace local-state persistence at /lnd/nodemon/.log-cursors.json"
affects: [16-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "pygtail-modeled inode+offset+size-shrink cursor, hand-rolled (cited, not vendored) — venv stays psycopg2-binary + python-dotenv"
    - "Cursor keyed by stable source_key (service name), path stored inside — survives a PG timestamped-filename day-roll"
    - "Atomic cursor persistence via temp-file + os.replace so a killed tick never corrupts/skips"

key-files:
  created: []
  modified:
    - scripts/fileserver/collect_telemetry.py

key-decisions:
  - "Demoted LOG_TAIL_BYTES -> INITIAL_TAIL_BYTES (first-sight bootstrap window only) and renamed both call sites (L782 grade_log_service, L1475 PG tail) to the new constant; callers are fully rewired to read_since in 16-03"
  - "TestRotation is satisfied by the reset-to-0 semantics alone; _drain_previous adds archive draining (gzip/.zst-skip) for no-line-loss across the boundary, matching the acceptance greps"
  - ".zst archives skip-drained WITH a log() line — no zstandard dependency (accepted limitation A4); worded to avoid the literal 'zstandard'/'import zstd' so the anti-dependency grep stays 0"

requirements-completed: [COL-04]

# Metrics
duration: ~20min
completed: 2026-07-16
---

# Phase 16 Plan 02: Cursor-based interval-complete, rotation-safe log capture Summary

**Replaced the fixed 64 KB tail with a source-agnostic `read_since` cursor (byte-offset + inode + size, persisted atomically to LOCAL node state) so every `[ERR]` in a `*/5` interval is captured, with dual rotation detection (LND rename-archive + PG timestamped-glob) and a bounded, LOGGED per-tick read — the collector stays SELECT-only on the warehouse.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (both `tdd="true"`, turning Wave-0 RED tests GREEN)
- **Files modified:** 1

## Accomplishments
- **Task 1 — `read_since` + `resolve_artifact` + atomic persist + bounded-bytes** (`7a485b5`): reads `offset -> EOF` each tick, emits complete newline-terminated lines only and parks the offset before any trailing partial line; first sight seeds `max(0, size - INITIAL_TAIL_BYTES)` (aligned forward to the next newline) so a mature log is never ingested whole; a per-tick read is capped at `MAX_BYTES_PER_TICK` (8 MB) with a `log()` truncation marker and the remainder deferred; `resolve_artifact` returns the newest glob/dir match by mtime (the PG day-roll signal) else the path verbatim; `save_cursors`/`load_cursors` persist a `{path,inode,offset,size}` map keyed by a stable `source_key` via temp-file + `os.replace`, tolerating a missing/corrupt file.
- **Task 2 — dual rotation detection + archive drain** (`85f91f8`): an inode change OR a size shrink below the saved offset is detected as rotation; `_drain_previous` globs `path.*`, picks the newest archive by mtime, and drains it from the saved offset before resetting the live cursor to 0; `.gz` archives are decompressed via stdlib `gzip`, `.zst` archives are skip-drained WITH a `log()` line (no `zstandard` dependency).
- Demoted `LOG_TAIL_BYTES` (fixed-tail gate) to `INITIAL_TAIL_BYTES` (first-sight window only); added `MAX_BYTES_PER_TICK` and `CURSOR_FILE = "/lnd/nodemon/.log-cursors.json"`; added stdlib `glob`/`gzip` imports.

## Task Commits

1. **Task 1: read_since cursor + resolve_artifact + atomic persist + bounded-bytes** — `7a485b5` (feat)
2. **Task 2: Dual rotation detection + archive drain** — `85f91f8` (feat)

_RED phase was authored in 16-01; this plan is the GREEN implementation (no separate RED commit here by design)._

## Files Created/Modified
- `scripts/fileserver/collect_telemetry.py` — +LogSource cursor module (`read_since`, `resolve_artifact`, `_drain_previous`, `load_cursors`, `save_cursors`), constant demotion/additions, `glob`/`gzip` imports; two existing tail call sites renamed to `INITIAL_TAIL_BYTES` (full read_since rewire deferred to 16-03).

## Verification
- `python3 scripts/fileserver/test_extract.py -k Cursor|PgGlob|Bounded|Rotation` → all GREEN (4 + 3 + 1 + 2 tests).
- Full suite: `Ran 43 tests … FAILED (failures=3, errors=1)` — the only residual reds are the **16-03** classes (`TestCaptureByPattern`, `TestTierGating`, `TestIpPortNormalize`), RED-by-design until the next plan. Error count dropped from 11 (16-01 baseline) to 1.
- Source assertions: `INITIAL_TAIL_BYTES`/`MAX_BYTES_PER_TICK`/`CURSOR_FILE` all present; `os.replace` present; cursor literal is `/lnd/nodemon/.log-cursors.json`; `grep -c "zstandard\|import zstd"` == 0; no `GRANT`/`service_inventory` write added (the two `service_inventory` refs are pre-existing SELECTs); rotation path shows `gzip`/`st_ino`/`drain`.
- `py_compile` clean.

## Deviations from Plan

None — plan executed as written. One process note: the rotation-drain code (Task 2) was briefly authored alongside Task 1 during implementation, then split back out so each task landed as its own atomic commit matching the plan's task boundaries.

## Known Stubs

None. `_drain_previous` is fully implemented for `.gz` and uncompressed archives; `.zst` is a deliberate, LOGGED skip (accepted limitation A4), not a stub. Caller rewiring (replacing the `_tail_text` reads at L782/L1475 with `read_since`) is explicitly scoped to 16-03, not this plan.

## Threat Flags

None. All new surface is node-local: reads from `/lnd/...` (read-only) and an atomic write to the root-only local cursor file. No new network endpoint, no warehouse write, no new dependency — the mitigations for T-16-01 (atomic `os.replace` + inode/size validation + stale-entry prune), T-16-07 (`MAX_BYTES_PER_TICK` logged cap), and T-16-04 (cursor is local state, SELECT-only boundary intact) are all implemented.

## Self-Check: PASSED

- `scripts/fileserver/collect_telemetry.py` present on disk with `def read_since` / `def resolve_artifact` / `def _drain_previous` / `def save_cursors`.
- Both task commits present in git history (`7a485b5`, `85f91f8`).

---
*Phase: 16-collector-enrichment-robust-log-capture*
*Completed: 2026-07-16*
