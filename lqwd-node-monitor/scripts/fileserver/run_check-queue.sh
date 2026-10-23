#!/bin/bash
#
# run_check-queue.sh — NodeMonitor (EXEC-01) heartbeat runner/wrapper.
#
# Cron entry (registered by updateCrontab.sh CRON_JOB_11, */5 cadence — D-09):
#   */5 * * * * /lnd/bashScripts/run_check-queue.sh >> /lnd/nodemon/check-queue.log 2>&1
#
# Per tick this wrapper:
#   1. Self-updates BOTH executor scripts (check-queue, apply-fee) from the
#      fileserver via md5 compare — back up the current copy to old-scripts/
#      before scp'ing the fresh one (mirror run_liquidity_manager.sh L56-101).
#      md5-compare (not --version): these are scripts, not versioned binaries.
#   2. Invokes `check-queue` and reports its exit code (mirror
#      run_nodeAuditor.sh L62-68 tail).
#
# NO persistent daemon/agent/AI. PURE BASH — this wrapper installs NO language
# runtime or package of any kind (the static gate asserts that absence). The
# secret env file is sourced by check-queue itself at runtime from a root-only
# path placed out-of-band by provisioning (D-03); this wrapper never touches it.
#
# Deploy: ships in ~/bashScripts -> /lnd/bashScripts via the existing all-folder
# bashScriptDownloader.sh. The check-queue + apply-fee executors live in
# ~/nodemon -> /lnd/nodemon pulled by nodemonDownload.sh.

source /lnd/bashScripts/config.sh

REMOTE_DIR="${REMOTE_HOME}/nodemon"
LOCAL_DIR="${LND_DIR}/nodemon"
LOG_FILE="${LOCAL_DIR}/check-queue.log"

# Executor scripts kept current by the md5 self-update below.
EXECUTORS="check-queue apply-fee"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" | tee -a "${LOG_FILE}"; }

# Ensure the working dir + backup dir exist.
mkdir -p "${LOCAL_DIR}/old-scripts"

# update_one <script-name> — back up the current copy, then scp the fresh one
# and mark it executable (mirror run_liquidity_manager.sh update_scripts L56-82).
update_one() {
    local name="$1"
    local timestamp backup_dir
    timestamp=$(date +%Y%m%d_%H%M%S)
    backup_dir="${LOCAL_DIR}/old-scripts/backup_${timestamp}"

    if [ -f "${LOCAL_DIR}/${name}" ]; then
        mkdir -p "${backup_dir}"
        cp "${LOCAL_DIR}/${name}" "${backup_dir}/" 2>/dev/null || true
        log "Backed up ${name} to ${backup_dir}"
    fi

    yes | sudo scp -o StrictHostKeyChecking=no -P "${REMOTE_PORT}" -i "${LND_DIR}/id_rsa" \
        "${REMOTE_USER}@${REMOTE_SERVER}:${REMOTE_DIR}/${name}" "${LOCAL_DIR}/" >> "${LOG_FILE}" 2>&1

    if [ -f "${LOCAL_DIR}/${name}" ]; then
        sudo chmod +x "${LOCAL_DIR}/${name}"
        log "Updated ${name}"
    else
        log "WARNING: ${name} not present after scp"
    fi
}

# check_for_updates — for EACH executor compare md5 local vs remote; update on diff
# (mirror run_liquidity_manager.sh check_for_updates L84-101).
check_for_updates() {
    local name local_hash remote_hash
    for name in ${EXECUTORS}; do
        local_hash=$(md5sum "${LOCAL_DIR}/${name}" 2>/dev/null | awk '{print $1}')
        remote_hash=$(yes | ssh -o StrictHostKeyChecking=no -p "${REMOTE_PORT}" -i "${LND_DIR}/id_rsa" \
            "${REMOTE_USER}@${REMOTE_SERVER}" "md5sum ${REMOTE_DIR}/${name}" 2>/dev/null | awk '{print $1}')

        if [ -z "${remote_hash}" ]; then
            log "Could not read remote md5 for ${name}; skipping self-update for it"
            continue
        fi

        if [ "${local_hash}" != "${remote_hash}" ]; then
            log "${name} differs (local=${local_hash:-none} remote=${remote_hash}) — updating"
            update_one "${name}"
        else
            log "${name} is up to date"
        fi
    done
}

# Main
log "=== run_check-queue tick start ==="
check_for_updates

if [ ! -x "${LOCAL_DIR}/check-queue" ]; then
    log "ERROR: ${LOCAL_DIR}/check-queue missing or not executable; cannot run"
    exit 1
fi

bash "${LOCAL_DIR}/check-queue"
EXIT_CODE=$?

if [ "${EXIT_CODE}" -eq 0 ]; then
    log "check-queue completed successfully"
else
    log "check-queue failed with exit code ${EXIT_CODE}"
fi

log "=== run_check-queue tick end (exit ${EXIT_CODE}) ==="
exit ${EXIT_CODE}
