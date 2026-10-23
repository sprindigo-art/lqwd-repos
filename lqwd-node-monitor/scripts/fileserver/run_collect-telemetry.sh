#!/bin/bash
#
# run_collect-telemetry.sh — NodeMonitor (TEL-01/02/03) telemetry collector runner.
#
# Cron entry (registered by updateCrontab.sh CRON_JOB_12, */5 cadence — D-10):
#   */5 * * * * /lnd/bashScripts/run_collect-telemetry.sh >> /lnd/nodemon/collect-telemetry.log 2>&1
#
# Third clone of the Phase-8 rail. Per tick this wrapper:
#   1. Guards overlap with flock (a slow host/RPC probe must not pile up at */5).
#   2. Self-updates the Python payload (collect_telemetry.py + requirements.txt)
#      from the fileserver via md5 compare (mirror run_check-queue.sh) — back up the
#      current copy to old-scripts/ before scp'ing the fresh one.
#   3. Bootstraps a per-node venv + psycopg2/dotenv (mirror run_nodeAuditor.sh),
#      then runs collect_telemetry.py via the venv python.
#
# NO persistent daemon. The root-only env file (/lnd/nodemon/.nodemon.env), holding
# the nodemon_telemetry DSN + bitcoind/pg credentials, is sourced at runtime — it is
# NEVER shipped through the scp distribution channel (D-03). collect_telemetry.py reads
# those values from the environment; this wrapper exports them by sourcing the file.
#
# Deploy: this wrapper ships in ~/bashScripts -> /lnd/bashScripts via the existing
# all-folder bashScriptDownloader.sh. The Python payload lives in ~/nodemon ->
# /lnd/nodemon pulled by nodemonDownload.sh (and kept current by the md5 loop below).

source /lnd/bashScripts/config.sh

REMOTE_DIR="${REMOTE_HOME}/nodemon"
LOCAL_DIR="${LND_DIR}/nodemon"
LOG_FILE="${LOCAL_DIR}/collect-telemetry.log"
VENV_DIR="${LOCAL_DIR}/.venv-telemetry"
MAIN_SCRIPT="${LOCAL_DIR}/collect_telemetry.py"
REQUIREMENTS="${LOCAL_DIR}/requirements.txt"
LOCK_FILE="${LOCAL_DIR}/.collect-telemetry.lock"
ENV_FILE="${LOCAL_DIR}/.nodemon.env"

# Python payload kept current by the md5 self-update below.
PAYLOAD="collect_telemetry.py requirements.txt"

# D-08 channel gate (resolved in Main before check_for_updates): the fileserver dir
# this node is allowed to pull from. It is SCOPED to ${REMOTE_DIR}/releases/<version>
# where <version> is what this node's NODEMON_CHANNEL pin points at — NOT the blanket
# ${REMOTE_DIR}. A build published to the canary channel therefore reaches ONLY
# canary-pinned nodes; stable nodes are untouched until the operator flips the stable
# pointer. Empty means "gate could not resolve" -> self-update is skipped (fail-safe:
# an unresolved channel must NEVER fall back to an unscoped fleet-wide pull, which is
# exactly the 2026-07-15 accidental-splice failure mode this gate closes).
REMOTE_PAYLOAD_DIR=""

log() { echo "$(date '+%Y-%m-%d %H:%M:%S'): $*" | tee -a "${LOG_FILE}"; }

# ── C5 (CODE-REVIEW-2026-07-22): host-key-pinned self-update ──────────────────
# collect_telemetry.py is pulled from the fileserver and executed as ROOT. The
# old pull disabled host-key checking, so a MITM / compromised-DNS / spoofed
# fileserver could substitute a malicious payload -> fleet-wide root RCE within
# one tick (OWASP A08). We now PIN the fileserver host key:
#   * StrictHostKeyChecking=yes  -> fails CLOSED when the presented key is
#     absent from or differs from the pinned known_hosts (no silent trust).
#   * UserKnownHostsFile         -> the operator-provisioned pin, env-driven
#     (NODEMON_KNOWN_HOSTS, HARDEN-02) with a sane per-node default.
#   * BatchMode=yes              -> never drop to an interactive prompt (a tick
#     is non-interactive; an unknown key must refuse, not hang/ask).
#   * ConnectTimeout             -> bound a black-hole peer so a tick cannot stall.
# The md5 compare remains CHANGE detection only; host-key pinning is the
# integrity boundary. A detached-signature verification of the pulled payload is
# the next hardening step (would need per-node trust roots distributed OOB); for
# now the pull fails CLOSED (local copy untouched) on any host-key mismatch.
NODEMON_KNOWN_HOSTS="${NODEMON_KNOWN_HOSTS:-${LOCAL_DIR}/.nodemon_known_hosts}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-10}"
SSH_PIN_OPTS=(
    -o StrictHostKeyChecking=yes
    -o "UserKnownHostsFile=${NODEMON_KNOWN_HOSTS}"
    -o BatchMode=yes
    -o "ConnectTimeout=${SSH_CONNECT_TIMEOUT}"
)

# Ensure the working dir + backup dir exist.
mkdir -p "${LOCAL_DIR}/old-scripts"

# update_one <name> — back up the current copy, then scp the fresh one
# (mirror run_check-queue.sh update_one L41-62).
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

    if ! sudo scp "${SSH_PIN_OPTS[@]}" -P "${REMOTE_PORT}" -i "${LND_DIR}/id_rsa" \
        "${REMOTE_USER}@${REMOTE_SERVER}:${REMOTE_PAYLOAD_DIR}/${name}" "${LOCAL_DIR}/" >> "${LOG_FILE}" 2>&1; then
        # Fail CLOSED: host-key mismatch / unreachable peer -> keep the current
        # (backed-up) local copy; never replace root-executed code from an
        # unverified host.
        log "WARNING: scp of ${name} failed (host-key mismatch or peer unreachable); keeping current copy"
        return
    fi

    if [ -f "${LOCAL_DIR}/${name}" ]; then
        log "Updated ${name}"
    else
        log "WARNING: ${name} not present after scp"
    fi
}

# check_for_updates — for EACH payload file compare md5 local vs remote; update on diff
# (mirror run_check-queue.sh check_for_updates L66-85).
check_for_updates() {
    local name local_hash remote_hash
    for name in ${PAYLOAD}; do
        local_hash=$(md5sum "${LOCAL_DIR}/${name}" 2>/dev/null | awk '{print $1}')
        remote_hash=$(ssh "${SSH_PIN_OPTS[@]}" -p "${REMOTE_PORT}" -i "${LND_DIR}/id_rsa" \
            "${REMOTE_USER}@${REMOTE_SERVER}" "md5sum ${REMOTE_PAYLOAD_DIR}/${name}" 2>/dev/null | awk '{print $1}')

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

# ── D-08 channel gate helpers ────────────────────────────────────────────────
# read_channel — this node's NODEMON_CHANNEL pin (default stable), read directly
# from the root-only env file WITHOUT sourcing the full secret block yet (the DSN +
# creds are sourced later, after the self-update). No warehouse touch.
read_channel() {
    local ch=""
    if [ -f "${ENV_FILE}" ]; then
        ch=$(grep -E '^NODEMON_CHANNEL=' "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"' []" | tr -d '[:space:]')
    fi
    echo "${ch:-stable}"
}

# resolve_channel_version <channel> — ask the fileserver which published version this
# channel points at: ~/nodemon/channels/<channel> holds a bare version string that
# names ~/nodemon/releases/<version>/. Echoes the version, or empty on any failure.
# Pure fileserver-layout indirection — reads one pointer file, writes nothing.
resolve_channel_version() {
    local channel="$1" version
    version=$(ssh "${SSH_PIN_OPTS[@]}" -p "${REMOTE_PORT}" -i "${LND_DIR}/id_rsa" \
        "${REMOTE_USER}@${REMOTE_SERVER}" "cat ${REMOTE_DIR}/channels/${channel}" 2>/dev/null \
        | tr -d '[:space:]')
    echo "${version}"
}

# Main
log "=== run_collect-telemetry tick start ==="

# Overlap guard: a second invocation exits immediately rather than pile up a
# concurrent collector against the same node/DB (mirror run_nodeAuditor.sh L28-32).
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
    log "Previous run still in progress; skipping this invocation."
    exit 0
fi

# D-08 channel gate — resolve THIS node's pinned channel -> version BEFORE any pull,
# and scope the md5-compare self-update to only that version's release dir. If the
# channel pointer cannot be resolved, SKIP the self-update entirely (fail-safe) — an
# unresolved gate must never fall back to an unscoped fleet-wide pull. This is the
# control that structurally ends the 2026-07-15 accidental-splice class.
# C5 fail-closed pre-check: without the pinned known_hosts the pull cannot verify
# the fileserver, so SKIP the self-update entirely (run the existing local payload)
# rather than pulling root-executed code from an unverified host.
if [ ! -f "${NODEMON_KNOWN_HOSTS}" ]; then
    log "C5: host-key pin ${NODEMON_KNOWN_HOSTS} missing; SKIPPING self-update this tick (fail-closed — no unverified pull). Provision the fileserver host key to re-enable updates."
    NODEMON_CHANNEL=""
    CHANNEL_VERSION=""
else
    NODEMON_CHANNEL="$(read_channel)"
    CHANNEL_VERSION="$(resolve_channel_version "${NODEMON_CHANNEL}")"
fi
if [ -z "${CHANNEL_VERSION}" ]; then
    log "D-08 gate: could not resolve channel '${NODEMON_CHANNEL}' pointer (${REMOTE_DIR}/channels/${NODEMON_CHANNEL}); SKIPPING self-update this tick — running the existing local payload (fail-safe: no unscoped fleet pull)."
else
    REMOTE_PAYLOAD_DIR="${REMOTE_DIR}/releases/${CHANNEL_VERSION}"
    log "D-08 gate: channel=${NODEMON_CHANNEL} -> version=${CHANNEL_VERSION}; self-update scoped to ${REMOTE_PAYLOAD_DIR}"
    check_for_updates
fi

# Run from the project dir (collect_telemetry.py resolves the env file relative paths).
cd "${LOCAL_DIR}" || { log "ERROR: cannot cd to ${LOCAL_DIR}"; exit 1; }

# Source the root-only env file (DSN + bitcoind/pg credentials, D-03). Never shipped.
if [ -f "${ENV_FILE}" ]; then
    set -a
    source "${ENV_FILE}"
    set +a
else
    log "WARNING: ${ENV_FILE} not found; collector will abort without a DSN"
fi

# Build the venv on first run (each node creates its own; excluded from the scp pull).
if [ ! -x "${VENV_DIR}/bin/python3" ]; then
    log "Creating virtualenv at ${VENV_DIR}"
    if ! python3 -m venv "${VENV_DIR}" >> "${LOG_FILE}" 2>&1; then
        log "ERROR: failed to create virtualenv"
        exit 1
    fi
fi

PYTHON_BIN="${VENV_DIR}/bin/python3"

# Ensure dependencies are present (cheap import check; install only if missing).
if ! "${PYTHON_BIN}" -c "import psycopg2, dotenv" 2>/dev/null; then
    log "Installing Python dependencies from requirements.txt"
    "${PYTHON_BIN}" -m pip install --upgrade pip >> "${LOG_FILE}" 2>&1
    if ! "${PYTHON_BIN}" -m pip install -r "${REQUIREMENTS}" >> "${LOG_FILE}" 2>&1; then
        log "ERROR: failed to install dependencies"
        exit 1
    fi
fi

if [ ! -f "${MAIN_SCRIPT}" ]; then
    log "ERROR: ${MAIN_SCRIPT} missing; cannot run"
    exit 1
fi

log "Starting telemetry collection"
"${PYTHON_BIN}" "${MAIN_SCRIPT}"
EXIT_CODE=$?

if [ "${EXIT_CODE}" -eq 0 ]; then
    log "telemetry collection completed successfully"
else
    log "telemetry collection failed with exit code ${EXIT_CODE}"
fi

log "=== run_collect-telemetry tick end (exit ${EXIT_CODE}) ==="
exit ${EXIT_CODE}
