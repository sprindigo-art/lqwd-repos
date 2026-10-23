---
phase: 16-collector-enrichment-robust-log-capture
plan: 06
subsystem: fileserver-collector
tags: [collector, deploy, d-08, canary, lncli, observability, rollout-gate]
requires:
  - "16-03 (info-tier suppression / COLLECTOR_VERSION reseed sequencing)"
  - "16-04 (owner-run seed-log-patterns.sql reseed — runbook prerequisite)"
  - "16-05 (owner-run path-reconciler.sql daemon paths — runbook prerequisite)"
provides:
  - "Absolute LNCLI_BIN default + NODEMON_CHANNEL pin in deploy-env.sh"
  - "COLLECTOR_VERSION marker + lncli self-check + esplora NO-DATA cleanup in collect_telemetry.py"
  - "D-08 channel gate in run_collect-telemetry.sh (canary isolation before fleet promotion)"
  - "Phase-16 channel-promotion runbook + OWNER-SIDE PREREQUISITE section"
affects:
  - scripts/fileserver/deploy-env.sh
  - scripts/fileserver/collect_telemetry.py
  - scripts/fileserver/run_collect-telemetry.sh
  - scripts/fileserver/nodemonDownload.sh
  - scripts/fileserver/CANARY-RUNBOOK.md
tech-stack:
  added: []
  patterns:
    - "channel-pointer indirection: per-node NODEMON_CHANNEL pin -> fileserver channels/<channel> -> releases/<version>/"
    - "fail-safe gate: unresolved channel SKIPS self-update rather than falling back to an unscoped fleet pull"
    - "observability marker logged (never written) to keep SELECT-only boundary"
key-files:
  created: []
  modified:
    - scripts/fileserver/deploy-env.sh
    - scripts/fileserver/collect_telemetry.py
    - scripts/fileserver/run_collect-telemetry.sh
    - scripts/fileserver/nodemonDownload.sh
    - scripts/fileserver/CANARY-RUNBOOK.md
decisions:
  - "A2: fleet lncli absolute path = /usr/local/bin/lncli (operator-confirmed 2026-07-16)"
  - "A3: D-08 gate mechanism = channel-pointer indirection (operator-confirmed 2026-07-16)"
  - "A1: MAX_BYTES_PER_TICK = 8 MB per-tick ceiling (operator-confirmed default)"
  - "Unresolved channel pointer = SKIP self-update (fail-safe), never an unscoped fleet-wide pull"
metrics:
  duration: "~1 checkpoint round-trip + 2 implementation tasks"
  completed: 2026-07-16
  tasks: 3
  files: 5
---

# Phase 16 Plan 06: Collector Operational Hardening + D-08 Rollout Gate Summary

Pinned an operator-confirmed absolute `LNCLI_BIN` and per-node `NODEMON_CHANNEL` in `deploy-env.sh`, added a `COLLECTOR_VERSION` marker + lncli-path self-check + esplora NO-DATA cleanup to `collect_telemetry.py`, and introduced the D-08 channel-pointer gate in `run_collect-telemetry.sh` so a build proves on ONE canary before a single-pointer-flip fleet promotion — all with the collector remaining SELECT-only on the warehouse.

## What Was Built

**Task 1 (checkpoint:decision) — operator-confirmed live-node facts.** Two facts the collector must encode were confirmed by the operator (not guessed): the fleet lncli absolute path `/usr/local/bin/lncli` (A2), and the D-08 self-update gate mechanism = channel-pointer indirection (A3). Tasks 2–3 encoded exactly these.

**Task 2 (`a4b0a1f`) — identity fix + observability + cleanup.**
- `deploy-env.sh`: `LNCLI_BIN` default now falls back to the absolute `/usr/local/bin/lncli` when `command -v lncli` is empty (a thin cron/root PATH lacks `/usr/local/bin`, which was producing `pubkey=none` and RLS-skipped node-scoped rows). The L58 guard was tightened to reject any non-absolute value via a `case` statement so heterogeneous outliers fail loudly. A `NODEMON_CHANNEL=stable` line was added to the managed env block.
- `collect_telemetry.py`: `COLLECTOR_VERSION = "16.06"` logged each tick (observability only — no warehouse write); a startup self-check logs the resolved lncli path and WARNs on `pubkey=none`; the `wrote tick` summary now carries the lncli path + version. The esplora branch in `grade_native_service` now reads NO-DATA (`running=None`) when `ESPLORA_TIP_URL` is unset instead of fabricating a stale DOWN row for a central service. `MAX_BYTES_PER_TICK` documented as the operator-confirmed 8 MB ceiling.

**Task 3 (`508753d`) — D-08 channel gate + runbook.**
- `run_collect-telemetry.sh`: `read_channel` reads this node's `NODEMON_CHANNEL` pin directly from the env file (no early secret sourcing); `resolve_channel_version` reads the fileserver `~/nodemon/channels/<channel>` pointer to a version string. BEFORE `check_for_updates`, the gate scopes the md5 self-update to `~/nodemon/releases/<version>/` only. An unresolved channel SKIPS self-update entirely (fail-safe) — it never falls back to the unscoped `${REMOTE_DIR}` pull that caused the 2026-07-15 accidental splice. The flock overlap guard and env sourcing are preserved.
- `nodemonDownload.sh`: header note that the collector's canary/stable isolation is enforced in the wrapper gate; the D-03 no-secrets contract is preserved.
- `CANARY-RUNBOOK.md`: a full Phase-16 section (P16-0..P16-5 + PASS criteria) documenting set-canary → publish-release → prove-on-one → flip-stable-pointer promotion, naming the accidental-splice failure mode it closes, plus an OWNER-SIDE PREREQUISITE (P16-0) that 16-04's `seed-log-patterns.sql` reseed and 16-05's `path-reconciler.sql` MUST be applied owner-side before/at the canary tick (else info-tier flood is unsuppressed and 0 daemon-log lines are captured).

## Deviations from Plan

None — the plan executed as written. The only encoded values that were not in the plan text (the absolute lncli path and gate mechanism) came from the operator's Task-1 checkpoint confirmation, exactly as the plan required.

## Threat Mitigations Applied

- **T-16-08 (accidental splice):** D-08 channel gate scopes the pull to the pinned version; unresolved channel = fail-safe skip.
- **T-16-09 (identity loss):** absolute `LNCLI_BIN` + non-absolute guard + per-tick pubkey self-check/WARN.
- **T-16-10 (path injection):** absolute default is an operator-confirmed constant; wrapper heredoc exec form unchanged; guard rejects empty/relative.
- **T-16-11 (observability gap):** `COLLECTOR_VERSION` logged each tick (no warehouse write).

## Verification

- Task 2 gate: `grep NODEMON_CHANNEL deploy-env.sh` ✓, `grep COLLECTOR_VERSION collect_telemetry.py` ✓, `python3 ast.parse` ✓, `bash -n deploy-env.sh` ✓.
- Task 3 gate: `grep NODEMON_CHANNEL run_collect-telemetry.sh` ✓, `bash -n run_collect-telemetry.sh` ✓, `grep -i channel CANARY-RUNBOOK.md` ✓, no new `INSERT|UPDATE SET|GRANT` in the wrapper ✓, `bash -n nodemonDownload.sh` ✓.
- SELECT-only boundary preserved: no new warehouse writes in either the wrapper or the collector.

## Known Stubs

None.

## Self-Check: PASSED
- scripts/fileserver/deploy-env.sh — FOUND (modified, NODEMON_CHANNEL present)
- scripts/fileserver/collect_telemetry.py — FOUND (COLLECTOR_VERSION present, parses)
- scripts/fileserver/run_collect-telemetry.sh — FOUND (D-08 gate present, bash -n OK)
- scripts/fileserver/nodemonDownload.sh — FOUND (D-08 note present)
- scripts/fileserver/CANARY-RUNBOOK.md — FOUND (Phase-16 section present)
- Commit a4b0a1f — FOUND
- Commit 508753d — FOUND
