#!/bin/bash
#
# updateCrontab.snippet.sh — splice pieces for NodeMonitor's */5 heartbeat
# (EXEC-01, D-02 self-installing crontab entry on the D-09 */5 cadence).
#
# This file is NOT run on its own. It documents the exact two pieces the
# operator splices into the LIVE fleet updateCrontab.sh on the fileserver:
#
#   PIECE (a) — the CRON_JOB_11 constant:
#       Paste it into the constant block, AFTER the CRON_JOB_10 line
#       (updateCrontab.sh line 14).
#
#   PIECE (b) — the idempotent merge block:
#       Paste it AFTER the CRON_JOB_10 merge block and BEFORE the final
#       `crontab "${TEMP_CRON_FILE}"` load (updateCrontab.sh line ~62).
#
# The merge uses grep -Fxq exactly like every other CRON_JOB_N block, so
# re-running updateCrontab.sh on each downloader tick is IDEMPOTENT — the line
# is added once and never duplicated. (Carrying this file through `bash -n`
# requires the surrounding TEMP_CRON_FILE var; the live file already defines it.)

# ── PIECE (a): constant — add after CRON_JOB_10 in updateCrontab.sh ──────────
CRON_JOB_11="*/5 * * * * /lnd/bashScripts/run_check-queue.sh >> /lnd/nodemon/check-queue.log 2>&1"

# ── PIECE (b): idempotent merge — insert BEFORE the crontab load line ────────
# (In the live file, ${TEMP_CRON_FILE} is the mktemp holding the working crontab.)
if ! grep -Fxq "${CRON_JOB_11}" "${TEMP_CRON_FILE}"; then
    echo "${CRON_JOB_11}" >> "${TEMP_CRON_FILE}"
fi

# ── PIECE (c): TELEMETRY constant (TEL-01/02/03) — add after CRON_JOB_11 ──────
# 12 is the next free slot after the Phase-8 check-queue line. Same */5 cadence
# (D-10); the telemetry collector runs on its own wrapper, walled off from the
# HMAC/apply path (D-09). Logs to its own file so the two rails never interleave.
CRON_JOB_12="*/5 * * * * /lnd/bashScripts/run_collect-telemetry.sh >> /lnd/nodemon/collect-telemetry.log 2>&1"

# ── PIECE (d): idempotent merge for CRON_JOB_12 — insert BEFORE the load line ─
# Same grep -Fxq guard as every other CRON_JOB_N block, so re-running
# updateCrontab.sh on each downloader tick adds the line once and never duplicates.
if ! grep -Fxq "${CRON_JOB_12}" "${TEMP_CRON_FILE}"; then
    echo "${CRON_JOB_12}" >> "${TEMP_CRON_FILE}"
fi
