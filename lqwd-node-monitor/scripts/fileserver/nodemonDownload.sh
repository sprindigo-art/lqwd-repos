#!/bin/bash

# nodemonDownload.sh — NodeMonitor (EXEC-01) dedicated-folder downloader.
#
# Clone of aiLiquidityManagerDownload.sh: pulls the entire ~/nodemon payload
# from the fileserver to /lnd/nodemon over /lnd/id_rsa, then chmod +x's the
# executor scripts (check-queue, apply-fee, *.sh) like bashScriptDownloader.sh
# line 20.
#
# D-01: this is the PULL model on the EXISTING fleet rail, NOT a new channel.
# D-03: this distribution channel carries ONLY executor scripts. Per-node
#       secrets and DB creds are placed once, out-of-band, by provisioning in a
#       root-only env file that the executors source at runtime — that file is
#       NEVER shipped or referenced here. (No secret token appears in this file
#       by design; the static gate asserts that absence.)
#
# Deploy: this script ships in ~/bashScripts so it lands at /lnd/bashScripts
# via the existing all-folder bashScriptDownloader.sh. The crontab/30-min
# downloader self-update keeps it current (D-04). See README.md.
#
# D-08 (channel isolation): this downloader pulls ONLY the executor scripts
# (check-queue, apply-fee, *.sh) EXPLICITLY — it must NEVER pull the collector
# payload (collect_telemetry.py / requirements.txt) or the releases/ / channels/
# tree.
#
# CR-02 (16-REVIEW): the old blanket `scp -r ${REMOTE_DIR}/*` copied the top-level
# ~/nodemon/collect_telemetry.py straight to /lnd/nodemon/collect_telemetry.py —
# which is exactly MAIN_SCRIPT in run_collect-telemetry.sh. That re-opened the
# 2026-07-15 accidental-splice path: a new build published to top-level ~/nodemon/
# was spliced to EVERY node within one cron cycle, bypassing the wrapper's D-08
# channel pin entirely. By pulling the executor scripts by name/glob instead of the
# whole folder, the collector version is decided SOLELY by run_collect-telemetry.sh's
# gated md5 self-update (scoped to this node's pinned channel ->
# ~/nodemon/releases/<version>/). Canary vs stable isolation therefore holds.

# Source the config file which contains environment variables like REMOTE_SERVER, REMOTE_USER, etc.
source /lnd/bashScripts/config.sh

# Define the remote and local directories
REMOTE_DIR="${REMOTE_HOME}/nodemon"
LOCAL_DIR="/lnd/nodemon"

# Create the local directory if it doesn't exist
if [ ! -d "${LOCAL_DIR}" ]; then
    mkdir -p "${LOCAL_DIR}"
fi

# Set the appropriate permissions on the SSH private key
chmod 600 ${LND_DIR}/id_rsa

# CR-02: pull ONLY the executor scripts by name/glob — NOT `${REMOTE_DIR}/*`. The
# collector payload (collect_telemetry.py, requirements.txt) and the releases/ /
# channels/ tree are deliberately excluded: they are NOT matched by these patterns,
# so the top-level collector build can never land at /lnd/nodemon/collect_telemetry.py
# via this pull. The remote shell expands the space-separated paths (all relative to
# the same host). Missing files are tolerated (script has no `set -e`); the wrapper's
# D-08 gate remains the ONLY path that lands a collector version.
yes | sudo scp -o StrictHostKeyChecking=no -P ${REMOTE_PORT} -i ${LND_DIR}/id_rsa \
  "${REMOTE_USER}@${REMOTE_SERVER}:${REMOTE_DIR}/check-queue ${REMOTE_DIR}/apply-fee ${REMOTE_DIR}/*.sh" \
  ${LOCAL_DIR}/

# DIVERGENCE from aiLiquidityManagerDownload.sh: this folder also holds the
# EXECUTOR scripts, so mark them executable (mirror bashScriptDownloader.sh line 20).
#
# TELEMETRY (TEL-01/02/03): collect_telemetry.py + requirements.txt are NO LONGER
# pulled here (CR-02) — the wrapper run_collect-telemetry.sh (shipped via
# ~/bashScripts) is the sole, channel-gated distributor of the collector payload.
# The find below marks the executor scripts pulled above executable.
find "${LOCAL_DIR}" -type f \( -name "check-queue" -o -name "apply-fee" -o -name "*.sh" \) -exec sudo chmod +x {} \;
