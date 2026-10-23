#!/usr/bin/env bash
#
# ufw-cloudflare-ips.sh — refresh UFW 443/tcp allow rules to Cloudflare's
# current published IP ranges. Truly idempotent: removes prior Cloudflare
# rules before re-adding, so rules don't accumulate across runs.
#
# Safe to run weekly via cron. Baseline rules (OpenSSH, 9735 LND p2p) are
# set if absent; existing rules are left untouched.
#
# Usage: sudo /usr/local/sbin/ufw-cloudflare-ips.sh [--dry-run]

set -euo pipefail

DRY_RUN=false
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=true
    echo "[dry-run] showing planned operations; no rules will change"
fi

run() {
    if $DRY_RUN; then
        echo "  would run: $*"
    else
        "$@"
    fi
}

if [ "$EUID" -ne 0 ]; then
    echo "must run as root (sudo)" >&2
    exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
    echo "ufw not installed — apt install -y ufw first" >&2
    exit 1
fi

# --- Baseline rules (idempotent — ufw dedupes identical rules) ---
echo "ensuring baseline rules (OpenSSH, 9735/tcp)..."
run ufw allow OpenSSH
run ufw allow 9735/tcp comment "LND p2p"

# --- Remove any existing Cloudflare-tagged rules ---
# `ufw status numbered` emits each active rule; `--force delete` by number
# must happen highest-first because deletes renumber remaining rules.
echo "removing existing Cloudflare rules..."
TO_DELETE=$(ufw status numbered 2>/dev/null \
    | awk '/Cloudflare (v4|v6)/ {gsub(/[\[\]]/,"",$1); print $1}' \
    | sort -rn)
if [ -n "$TO_DELETE" ]; then
    for n in $TO_DELETE; do
        run bash -c "yes | ufw delete $n >/dev/null"
    done
    echo "  removed $(echo "$TO_DELETE" | wc -l | tr -d ' ') Cloudflare rule(s)"
else
    echo "  (none found)"
fi

# --- Fetch + apply current CF ranges ---
echo "fetching Cloudflare IPv4 ranges..."
V4=$(curl -fsS https://www.cloudflare.com/ips-v4)
if [ -z "$V4" ]; then
    echo "failed to fetch ips-v4 — aborting before partial apply" >&2
    exit 1
fi

V6=""
# IPv6 pre-check: only fetch + apply if the VM actually has a routable IPv6
if ip -6 addr show scope global 2>/dev/null | grep -q "inet6"; then
    echo "fetching Cloudflare IPv6 ranges (VM has global IPv6)..."
    V6=$(curl -fsS https://www.cloudflare.com/ips-v6 || true)
else
    echo "skipping IPv6 (no global IPv6 address on VM)"
fi

echo "adding Cloudflare IPv4 allow rules..."
for ip in $V4; do
    run ufw allow from "$ip" to any port 443 proto tcp comment "Cloudflare v4"
done

if [ -n "$V6" ]; then
    echo "adding Cloudflare IPv6 allow rules..."
    for ip in $V6; do
        run ufw allow from "$ip" to any port 443 proto tcp comment "Cloudflare v6"
    done
fi

# --- Ensure default policies ---
run ufw default deny incoming
run ufw default allow outgoing

echo
echo "done. Current status:"
ufw status numbered | head -30
