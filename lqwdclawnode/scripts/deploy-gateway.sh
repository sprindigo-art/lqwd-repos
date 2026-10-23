#!/usr/bin/env bash
set -euo pipefail

# deploy-gateway.sh — Build, install, and restart the lnd-gateway binary.
# Run on the VM as root or with sudo.
# Usage: ./deploy-gateway.sh [--first-run]
#
# Rollback (binary only):
#   systemctl stop lnd-gateway
#   cp /usr/local/bin/lnd-gateway.bak /usr/local/bin/lnd-gateway
#   systemctl start lnd-gateway
#
# Rollback (full source):
#   PREV=$(cat /var/lib/lnd-gateway/rollback-commit)
#   cd /path/to/lqwdclawnode && git checkout $PREV
#   ./scripts/deploy-gateway.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
BINARY_NAME="lnd-gateway"
INSTALL_PATH="/usr/local/bin/$BINARY_NAME"
DATA_DIR="/var/lib/lnd-gateway"
CONFIG_DIR="/etc/lnd-gateway"
SERVICE_USER="lndgateway"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

first_run_setup() {
    log "First-run setup..."

    # Create service user (no login, no home)
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
        log "Created user $SERVICE_USER"
    fi

    # Create directories
    mkdir -p "$DATA_DIR" "$DATA_DIR/scb-backups" "$CONFIG_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" "$DATA_DIR/scb-backups"
    chmod 700 "$DATA_DIR"

    # Copy env template if not present
    if [ ! -f "$CONFIG_DIR/env" ]; then
        cp "$SCRIPT_DIR/env.example" "$CONFIG_DIR/env"
        chmod 600 "$CONFIG_DIR/env"
        chown root:$SERVICE_USER "$CONFIG_DIR/env"
        log "Copied env.example to $CONFIG_DIR/env — EDIT THIS FILE with real tokens"
    fi

    # Install systemd service
    cp "$SCRIPT_DIR/lnd-gateway.service" /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable lnd-gateway
    log "Systemd service installed and enabled"
}

backup_current() {
    if [ -f "$INSTALL_PATH" ]; then
        log "Backing up current binary to ${INSTALL_PATH}.bak..."
        cp "$INSTALL_PATH" "${INSTALL_PATH}.bak"
        log "Backup complete"
    else
        log "No existing binary to back up (first install)"
    fi

    # Record current git commit for full source rollback
    CURRENT_COMMIT=$(cd "$REPO_DIR" && git rev-parse HEAD 2>/dev/null || echo "unknown")
    echo "$CURRENT_COMMIT" > "$DATA_DIR/rollback-commit"
    log "Recorded rollback commit: $CURRENT_COMMIT"
}

build_binary() {
    log "Building $BINARY_NAME..."
    cd "$REPO_DIR/lnd-gateway"

    # Phase 22 SKL-03: inject X-Gateway-Version via ldflags so operators
    # (and skills checking EXPECTED_GATEWAY_VERSION) can detect a stale
    # binary on a running VM. -X rewrites main.Version at link time.
    local version
    version="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"

    # Cross-compile for linux/amd64 if running on macOS
    if [[ "$(uname)" == "Darwin" ]]; then
        GOOS=linux GOARCH=amd64 go build \
            -ldflags="-X main.Version=${version}" \
            -o "$BINARY_NAME" ./cmd/lnd-gateway/
    else
        go build \
            -ldflags="-X main.Version=${version}" \
            -o "$BINARY_NAME" ./cmd/lnd-gateway/
    fi

    log "Build complete (version=${version})"
}

deploy_well_known() {
    # Phase 22 TRM-01 / TRM-03: deploy .well-known static surfaces to
    # Caddy landing directory so Caddy's handle /.well-known/* blocks can
    # file_server them. Idempotent — safe to run on every deploy.
    if [ -d "$SCRIPT_DIR/well-known" ]; then
        install -d -m 0755 /etc/caddy/landing/.well-known
        install -m 0644 "$SCRIPT_DIR/well-known/ai-agent-trust.json" /etc/caddy/landing/.well-known/
        install -m 0644 "$SCRIPT_DIR/well-known/security.txt"        /etc/caddy/landing/.well-known/
        log "Deployed .well-known static files"
    fi

    # Reload Caddy to pick up any Caddyfile changes (config is deployed
    # out-of-band; this just makes sure the running process sees it).
    systemctl reload caddy || log "WARN: caddy reload failed — check config"
}

install_binary() {
    log "Installing binary to $INSTALL_PATH..."

    # If service is running, stop it
    if systemctl is-active --quiet lnd-gateway 2>/dev/null; then
        log "Stopping lnd-gateway..."
        systemctl stop lnd-gateway
    fi

    cp "$REPO_DIR/lnd-gateway/$BINARY_NAME" "$INSTALL_PATH"
    chmod 755 "$INSTALL_PATH"
    log "Binary installed"
}

start_service() {
    log "Starting lnd-gateway..."
    systemctl start lnd-gateway

    # Wait for startup
    sleep 2

    if systemctl is-active --quiet lnd-gateway; then
        log "lnd-gateway is running"
        systemctl status lnd-gateway --no-pager -l
    else
        log "ERROR: lnd-gateway failed to start"
        journalctl -u lnd-gateway --no-pager -n 20
        exit 1
    fi
}

# Main
if [[ "${1:-}" == "--first-run" ]]; then
    first_run_setup
fi

backup_current
build_binary
install_binary
deploy_well_known
start_service

log "Deploy complete"
