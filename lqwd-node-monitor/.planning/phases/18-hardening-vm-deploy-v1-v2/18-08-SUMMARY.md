---
phase: 18-hardening-vm-deploy-v1-v2
plan: 08
subsystem: fileserver-collectors
tags: [honest-stale, log-capture, rotation, security, host-key-pinning, C-iso, C1, C2, C4, C5]
requires: [18-01]
provides:
  - "per-service OSError isolation in the collector grading loop (grade_inventory)"
  - "correct rotation-boundary drain: day-roll, multi-rotation, .zst gap marker"
  - "host-key-pinned root self-update (no unverified MITM->RCE path)"
affects:
  - scripts/fileserver/collect_telemetry.py
  - scripts/fileserver/run_collect-telemetry.sh
  - scripts/fileserver/test_extract.py
tech-stack:
  added: []
  patterns:
    - "per-row try/except OSError degrade (one service, not the host tick)"
    - "chronological multi-archive drain anchored by cursor inode/path + offset>size reset"
    - "optional zstandard decompression with a persistent rotation-gap marker fallback"
    - "SSH_PIN_OPTS array: StrictHostKeyChecking=yes + UserKnownHostsFile + BatchMode + ConnectTimeout"
key-files:
  created: []
  modified:
    - scripts/fileserver/collect_telemetry.py
    - scripts/fileserver/run_collect-telemetry.sh
    - scripts/fileserver/test_extract.py
decisions:
  - "zst tail: decompress via optional `zstandard` when present, else surface a persistent ROTATION_GAP_MARKER line rather than silent [] — never read a compressed rotation as 'no errors'."
  - "C5 integrity boundary is host-key pinning (fail-closed); detached-signature verification deferred (needs OOB per-node trust roots) and noted inline as the next step."
  - "known_hosts pin path is env-driven (NODEMON_KNOWN_HOSTS) with a per-node default under LOCAL_DIR; missing pin skips self-update entirely (fail-closed)."
metrics:
  duration: ~15m
  completed: 2026-07-27
  tasks: 2
  files: 3
---

# Phase 18 Plan 08: Collector honest-stale + host-key-pinned self-update Summary

Hardened the fileserver collectors so honest-stale holds at the log-capture boundary and the root-executed self-update verifies the host it pulls from: per-service OSError isolation (C-iso), correct day-roll / multi-rotation / `.zst` tail drain (C1/C2/C4), and StrictHostKeyChecking=yes host-key pinning on every self-update scp/ssh (C5).

## What Was Built

### Task 1 — Per-service isolation + correct rotation drain (C-iso, C1, C2, C4) [TDD]
- **C-iso:** new `grade_inventory()` wraps each inventory row's grading (and native tail) in `try/except OSError`. A single OSError (resolve_artifact/getmtime/read racing logrotate, a vanished mount) now degrades exactly ONE service — `functioning=False, detail='collector error'` via `_degraded_row()` — instead of aborting the loop and producing zero rows for the whole host. `main()` delegates the grading loop to `grade_inventory()`.
- **C1 (day-roll):** `_drain_previous()` now drains the explicit `prev["path"]` directly from `prev["offset"]` when it differs from the resolved path. Yesterday's dated Postgres file IS the archive (a sibling, not a `.N` archive of today's name), so a seeded `FATAL`/`too_many_clients` in the previous tail is captured instead of lost.
- **C2 (multi-rotation):** `_drain_previous()` walks ALL archives at/after the cursor's archive mtime in chronological order — the cursor's own archive (matched by inode, or by explicit `prev["path"]`) drains from `prev["offset"]`, never-seen newer full rotations drain from `0`. Added `offset > size` reset (truncated/replaced file re-read from head).
- **C4 (.zst):** extracted `_drain_archive()` + `_read_zst()`. A `.zst` tail is decompressed via the optional `zstandard` module when importable; otherwise a persistent `ROTATION_GAP_MARKER` line is surfaced so the window reads as a rotation gap, never a silent `[]` ("no errors"). `.gz` still handled via stdlib gzip.

### Task 2 — Host-key-pinned self-update (C5)
- Added `SSH_PIN_OPTS` (StrictHostKeyChecking=yes + env-driven `UserKnownHostsFile=${NODEMON_KNOWN_HOSTS}` + BatchMode=yes + `ConnectTimeout`) applied to all three self-update transports: `update_one` (scp), `check_for_updates` (ssh md5), `resolve_channel_version` (ssh cat).
- Removed disabled host-key checking and the `yes |` auto-answer pipes — an unknown/changed key now refuses instead of being auto-trusted.
- **Fail-closed:** a failed scp keeps the current backed-up local copy (never replaces root-executed code from an unverified host); a missing host-key pin skips the self-update entirely and runs the existing local payload.

## Verification

- `python3 -m unittest test_extract` — 62 tests pass (57 pre-existing + 5 new: isolation, day-roll+FATAL, offset-reset, multi-rotation ordering, `.zst` gap marker). (pytest is not installed in this environment; the file's stdlib `unittest` harness is the sanctioned runner.)
- `grep -n "StrictHostKeyChecking=no" run_collect-telemetry.sh | grep -v '^#' | wc -l` → `0`.
- `bash -n run_collect-telemetry.sh` — syntax OK. `python3 -m py_compile collect_telemetry.py` — OK.

## Must-Haves Satisfied

- One bad artifact degrades exactly ONE service honestly (`functioning=False, detail='collector error'`), not the whole host tick.
- A Postgres day-roll drains the previous dated file's unread tail incl. seeded `FATAL`.
- Multi-rotation and `.zst`-compressed rotation capture the previous tail (or a persistent rotation-gap marker) rather than reading "no errors".
- The root self-update pins the fileserver host key (StrictHostKeyChecking=yes + UserKnownHostsFile) + ConnectTimeout; no scp with host-key checking disabled remains.

## Deviations from Plan

None — plan executed as written. TDD RED→GREEN cycle followed for Task 1 (test commit `9a7cf4d`, implementation `e081b16`).

## Threat Flags

None — changes shrink the existing threat surface (T-18-16/17/18 mitigated); no new endpoints, auth paths, or schema surface introduced.

## Self-Check: PASSED

- SUMMARY.md exists on disk.
- All commits present: `9a7cf4d` (test/RED), `e081b16` (feat/Task 1), `3da8c70` (fix/Task 2), `8b60db9` (docs).
- Only the 4 intended files changed across the plan; STATE.md and ROADMAP.md untouched (worktree mode).
