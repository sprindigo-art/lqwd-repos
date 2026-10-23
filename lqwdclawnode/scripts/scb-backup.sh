#!/usr/bin/env bash
set -euo pipefail

# scb-backup.sh — Monitor LND's channel.backup (SCB) for changes and
# copy encrypted backups to a remote location.
#
# Uses inotifywait to watch for SCB updates (triggered on every channel
# open/close). Encrypts with age and uploads via rsync/scp.
#
# Install: apt install inotify-tools age
# Usage: Run as systemd service (see scb-backup.service) or manually.

SCB_PATH="${SCB_PATH:-/lnd/data/chain/bitcoin/mainnet/channel.backup}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/lnd-gateway/scb-backups}"
AGE_RECIPIENT="${AGE_RECIPIENT:-}"  # age public key, e.g. age1...
REMOTE_DEST="${REMOTE_DEST:-}"      # rsync destination, e.g. user@host:/backups/scb/
MAX_LOCAL_BACKUPS="${MAX_LOCAL_BACKUPS:-50}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] SCB-BACKUP: $*"; }

# Validate
if [ ! -f "$SCB_PATH" ]; then
    log "ERROR: SCB file not found at $SCB_PATH"
    exit 1
fi

if [ -z "$AGE_RECIPIENT" ]; then
    log "WARNING: AGE_RECIPIENT not set — backups will NOT be encrypted"
fi

mkdir -p "$BACKUP_DIR"

backup_scb() {
    local timestamp
    timestamp=$(date '+%Y%m%d-%H%M%S')
    local filename="channel-backup-${timestamp}"

    if [ -n "$AGE_RECIPIENT" ]; then
        # Encrypt with age
        age -r "$AGE_RECIPIENT" -o "$BACKUP_DIR/${filename}.age" "$SCB_PATH"
        log "Encrypted backup: ${filename}.age ($(stat -c%s "$BACKUP_DIR/${filename}.age" 2>/dev/null || stat -f%z "$BACKUP_DIR/${filename}.age") bytes)"
    else
        # Plain copy (not recommended for production)
        cp "$SCB_PATH" "$BACKUP_DIR/${filename}.bak"
        log "Unencrypted backup: ${filename}.bak"
    fi

    # Upload to remote if configured
    if [ -n "$REMOTE_DEST" ]; then
        local latest="$BACKUP_DIR/${filename}.age"
        [ -z "$AGE_RECIPIENT" ] && latest="$BACKUP_DIR/${filename}.bak"

        if rsync -az "$latest" "$REMOTE_DEST" 2>/dev/null; then
            log "Remote upload success: $REMOTE_DEST"
        else
            log "ERROR: Remote upload failed to $REMOTE_DEST"
        fi
    fi

    # Prune old local backups
    local count
    count=$(find "$BACKUP_DIR" -name 'channel-backup-*' | wc -l)
    if [ "$count" -gt "$MAX_LOCAL_BACKUPS" ]; then
        find "$BACKUP_DIR" -name 'channel-backup-*' -printf '%T+ %p\n' \
            | sort | head -n "$((count - MAX_LOCAL_BACKUPS))" \
            | awk '{print $2}' | xargs rm -f
        log "Pruned old backups, keeping latest $MAX_LOCAL_BACKUPS"
    fi
}

# Take an initial backup on startup
log "Initial SCB backup..."
backup_scb

# Watch for changes
log "Watching $SCB_PATH for changes..."
inotifywait -m -e close_write,moved_to "$(dirname "$SCB_PATH")" --include "$(basename "$SCB_PATH")" |
while read -r dir event file; do
    log "SCB changed (event: $event) — backing up..."
    # Small delay to ensure write is complete
    sleep 1
    backup_scb
done
