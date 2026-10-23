#!/bin/bash
# lnurlpd: LNURL-pay for the appliance stand-in.
#
# It binds the VPN address, never 0.0.0.0, and the public endpoint is the
# gateway's - lnurl-gateway proxies to this over the tunnel. That is the whole
# point of the arrangement: the device serves a public payment URL without
# accepting a single inbound connection from the internet.
#
# The credential is lnd's INVOICE macaroon. Not admin: this is the one process
# in the appliance that anything outside ever reaches.
set -euo pipefail

NETWORK="${LND_NETWORK:-regtest}"
LND_DIR="${LND_DIR:-/data/lnd}"
LND_REST="${LND_REST:-https://127.0.0.1:8081}"
BIND_IP="${LND_BIND_IP:-10.99.0.1}"
LISTEN="${LNURLPD_LISTEN:-$BIND_IP:8090}"
MACAROON="$LND_DIR/data/chain/bitcoin/$NETWORK/invoice.macaroon"

# The public endpoint comes from the same provisioned merchant.env that the Pi
# image bakes in, under its own names there.
BASE_URL="${LNURLPD_BASE_URL:-${LNURL_BASE_URL:-}}"
NAME="${LNURLPD_NAME:-${LNURL_NAME:-merchant}}"
[ -n "$BASE_URL" ] || {
    echo "ERROR: no LNURL_BASE_URL - run scripts/64-provision-merchant.sh" >&2
    exit 1
}

echo ">>> waiting for $BIND_IP (openvpn tun0)"
for i in $(seq 1 120); do
    ip -4 addr show | grep -qw "$BIND_IP" && break
    [ "$i" = 120 ] && { echo "ERROR: $BIND_IP never appeared" >&2; exit 1; }
    sleep 1
done

echo ">>> waiting for the invoice macaroon at $MACAROON"
for i in $(seq 1 600); do
    [ -f "$MACAROON" ] && [ -f "$LND_DIR/tls.cert" ] && break
    [ "$i" = 600 ] && { echo "ERROR: no invoice macaroon - has the wallet been created?" >&2; exit 1; }
    sleep 2
done

echo ">>> lightning address and QR payload"
lnurlpd -print-lnurl -base-url="$BASE_URL" -name="$NAME"

exec lnurlpd \
    -listen="$LISTEN" \
    -base-url="$BASE_URL" \
    -name="$NAME" \
    -lnd-rest="$LND_REST" \
    -lnd-tls-cert="$LND_DIR/tls.cert" \
    -lnd-macaroon="$MACAROON"
