#!/usr/bin/env bash
#
# install-caddy-origin-certs.sh — install Cloudflare Origin CA cert + key
# for Caddy to serve api.lqwdclaw.bot with.
#
# Prereq: you've issued an Origin Certificate via the Cloudflare dashboard
# (SSL/TLS → Origin Server → Create Certificate, 15-year validity, hostnames
# "api.lqwdclaw.bot" + "*.lqwdclaw.bot") and have the cert + key available
# as local files on this VM (scp from laptop after download).
#
# Usage: sudo /opt/lqwdclawnode/scripts/install-caddy-origin-certs.sh <cert.pem> <key.pem>

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
    echo "must run as root (sudo)" >&2
    exit 1
fi

if [ $# -ne 2 ]; then
    cat <<EOF
usage: $0 <cert.pem> <key.pem>

  cert.pem  path to the Cloudflare Origin CA certificate (PEM)
  key.pem   path to the private key (PEM)

Installs them at /etc/caddy/certs/ with mode 640 root:caddy.
EOF
    exit 1
fi

CERT_SRC="$1"
KEY_SRC="$2"

if [ ! -f "$CERT_SRC" ]; then echo "cert not found: $CERT_SRC" >&2; exit 1; fi
if [ ! -f "$KEY_SRC" ]; then echo "key not found: $KEY_SRC" >&2; exit 1; fi

# Verify Caddy exists + has a caddy user
if ! id caddy >/dev/null 2>&1; then
    echo "user 'caddy' not found — install Caddy first (apt install caddy)" >&2
    exit 1
fi

DEST=/etc/caddy/certs
mkdir -p "$DEST"

install -m 640 -o root -g caddy "$CERT_SRC" "$DEST/origin-cert.pem"
install -m 640 -o root -g caddy "$KEY_SRC"  "$DEST/origin-key.pem"

# Verify cert issuer + validity
echo
echo "installed. cert metadata:"
openssl x509 -in "$DEST/origin-cert.pem" -noout -issuer -subject -dates

ISSUER=$(openssl x509 -in "$DEST/origin-cert.pem" -noout -issuer 2>/dev/null)
if ! echo "$ISSUER" | grep -qi "CloudFlare"; then
    echo
    echo "WARNING: issuer does not appear to be Cloudflare Origin CA:"
    echo "  $ISSUER"
    echo "  Continuing anyway, but double-check — SSL/TLS Full (Strict) mode"
    echo "  will reject mismatched cert chains."
fi

echo
echo "next: reload or restart caddy to pick up the new cert"
echo "  sudo systemctl reload caddy   # if already running"
echo "  sudo systemctl enable --now caddy   # first time"
