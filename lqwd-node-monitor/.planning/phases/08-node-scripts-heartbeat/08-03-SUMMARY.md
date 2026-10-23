---
phase: 08-node-scripts-heartbeat
plan: 03
subsystem: node-distribution-rail
tags: [exec-01, fileserver, bash, crontab, heartbeat, scp, md5-self-update]
requires:
  - "Live fleet bashScripts rail (config.sh, aiLiquidityManagerDownload.sh, run_liquidity_manager.sh, updateCrontab.sh, run_nodeAuditor.sh) as binding analogs"
provides:
  - "scripts/fileserver/nodemonDownload.sh — ~/nodemon -> /lnd/nodemon pull + chmod +x executors"
  - "scripts/fileserver/run_check-queue.sh — */5 md5 self-updating wrapper that invokes check-queue"
  - "scripts/fileserver/updateCrontab.snippet.sh — CRON_JOB_11 constant + idempotent grep -Fxq merge"
  - "scripts/fileserver/README.md — deploy layout, */5 heartbeat, D-04 bootstrap, D-03 secret rule"
  - "tests/node/check-distribution-static.sh — shared static gate (bash -n + grep battery, secret-absence assert)"
affects:
  - "Plan 04 operator bootstrap (copies these to the fileserver)"
tech-stack:
  added: []
  patterns:
    - "Pull-model distribution on the existing fleet rail (scp -r over /lnd/id_rsa), no new channel (D-01)"
    - "md5-compare self-update + timestamped old-scripts/ backup before scp (run_liquidity_manager.sh)"
    - "Idempotent crontab merge via grep -Fxq (updateCrontab.sh)"
    - "Secret kept out of the distribution channel; static gate asserts token absence (D-03)"
key-files:
  created:
    - scripts/fileserver/nodemonDownload.sh
    - scripts/fileserver/run_check-queue.sh
    - scripts/fileserver/updateCrontab.snippet.sh
    - scripts/fileserver/README.md
    - tests/node/check-distribution-static.sh
  modified: []
decisions:
  - "Static-gate forbid-patterns matched documentation prose that named the forbidden tokens; rephrased the two header comments to state the rules without naming literal secret/package tokens, so the scripts contain ZERO forbidden token strings (satisfies the literal D-03 acceptance criterion)"
metrics:
  duration: ~3 min
  completed: 2026-06-17
  tasks: 3
  files: 5
---

# Phase 8 Plan 03: Node Scripts Distribution Rail Summary

EXEC-01 distribution rail authored as version-controlled source-of-truth copies of the fleet pattern: a dedicated `nodemonDownload.sh`, a `*/5` md5-self-updating `run_check-queue.sh` wrapper, the `CRON_JOB_11` crontab snippet, a deploy README, and a shared static gate — no new channel, no daemon, no secret in the script channel.

## What Was Built

- **`nodemonDownload.sh`** — clone of `aiLiquidityManagerDownload.sh` with dirs swapped (`REMOTE_DIR=${REMOTE_HOME}/nodemon`, `LOCAL_DIR=/lnd/nodemon`); keeps the `mkdir -p`, `chmod 600 id_rsa`, and `yes | sudo scp -r ... -P ${REMOTE_PORT} -i id_rsa` shape verbatim. DIVERGENCE: a `find ... -exec sudo chmod +x` line marks `check-queue`, `apply-fee`, and `*.sh` executable (mirrors `bashScriptDownloader.sh` line 20).
- **`run_check-queue.sh`** — ports `run_liquidity_manager.sh` `check_for_updates()`/`update_scripts()`: for EACH of `check-queue` and `apply-fee`, compares local vs remote md5, and on a diff backs the current copy up to `old-scripts/backup_<TS>/` before `scp`'ing + `chmod +x`'ing the fresh file. Then `bash "${LOCAL_DIR}/check-queue"`, capturing/reporting the exit code (`run_nodeAuditor.sh` tail). Pure bash — no package install.
- **`updateCrontab.snippet.sh`** — two splice pieces: (a) the `CRON_JOB_11` constant on the `*/5` cadence invoking `/lnd/bashScripts/run_check-queue.sh` and redirecting to `/lnd/nodemon/check-queue.log 2>&1`; (b) the `grep -Fxq` idempotent merge block. Header documents exactly where each piece goes (after `CRON_JOB_10` / before the `crontab "${TEMP_CRON_FILE}"` load) and that re-running is idempotent.
- **`README.md`** — documents the two-folder deploy layout (wrappers ship via `~/bashScripts`, executors via `~/nodemon`), the `*/5` heartbeat, the D-04 one-time manual bootstrap, and the D-03 out-of-band secret-placement rule.
- **`tests/node/check-distribution-static.sh`** — shared gate: `test -f`-guarded (runnable mid-plan), runs `bash -n` + a per-file grep battery + secret/package-token absence asserts; exits non-zero on any present-file failure. Accepts an optional target arg (`nodemonDownload`/`run_check-queue`/`updateCrontab`) or checks all three.

## Verification

- `bash tests/node/check-distribution-static.sh` (no arg) — full green, all three fileserver scripts pass `bash -n` + the grep battery + the secret/package-absence asserts.
- Per-task targeted runs (`nodemonDownload`, `run_check-queue`, `updateCrontab`) — all green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Static gate tripped on documentation prose naming forbidden tokens**
- **Found during:** Tasks 1 and 2.
- **Issue:** The `forbid_grep` patterns for D-03 (`NODEMON_HMAC_SECRET|.nodemon.env|HMAC_SECRET`) and pure-bash (`psycopg2|pip install|...venv`) matched the *header comments* of `nodemonDownload.sh` and `run_check-queue.sh`, which named those tokens to document the rule. The acceptance criteria state literally "No reference to the HMAC secret or .nodemon.env" and "No psycopg2 / pip install / venv anywhere."
- **Fix:** Rephrased both header comments to state the rules without naming any literal forbidden token, so the scripts contain ZERO forbidden token strings — satisfying both the static gate and the literal D-03 / pure-bash acceptance criteria. No behavioral logic changed.
- **Files modified:** scripts/fileserver/nodemonDownload.sh, scripts/fileserver/run_check-queue.sh
- **Commits:** 7ad71ec (Task 1), 747de4c (Task 2)

## Authentication Gates

None.

## Threat Surface

No new threat surface beyond the plan's `<threat_model>`. T-08-12 (secret-in-channel) is mitigated and statically asserted; T-08-13 (duplicate crontab) is mitigated by the `grep -Fxq` merge; T-08-14 (stale executor) is mitigated by the md5 self-update. No package install step exists (T-08-SC accept disposition holds).

## Known Stubs

None. All five files are complete source-of-truth artifacts. The `check-queue` and `apply-fee` executors they reference are authored by a sibling plan; the `test -f` guards in the static helper intentionally skip not-yet-present files, which is by design, not a stub.

## Commits

- 7ad71ec: feat(08-03): nodemonDownload.sh + shared static-check helper
- 747de4c: feat(08-03): run_check-queue.sh self-updating wrapper
- e6d981c: feat(08-03): updateCrontab CRON_JOB_11 snippet + deploy README

## Self-Check: PASSED

All 5 created files verified present on disk; all 3 task commits + the SUMMARY commit verified in git log.
