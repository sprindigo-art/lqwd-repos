#!/bin/bash
# Wait for the VPN address and the regtest bitcoind, then run lnd.
#
# lnd binds listen= to 10.99.0.1, which only exists once the openvpn container
# has brought tun0 up. Binding 0.0.0.0 instead would expose the Lightning p2p
# port on this server's public interface, so we wait rather than widen the bind.
#
# Two nodes share this image and this script:
#
#   lnd-server     the gateway.          LND_ROLE=gateway
#   lnd-merchant   appliance stand-in.   LND_ROLE=merchant, LND_CONF and
#                  MERCHANT_ADDRESS set, which turns on the hardening.
set -euo pipefail

CONF="${LND_CONF:-/etc/lnd/lnd.conf}"
ROLE="${LND_ROLE:-gateway}"
BIND_IP="${LND_BIND_IP:-10.99.0.1}"
RPCUSER="${BITCOIND_RPCUSER:?set BITCOIND_RPCUSER}"
RPCPASS="${BITCOIND_RPCPASS:?set BITCOIND_RPCPASS}"
RPCHOST="${BITCOIND_RPCHOST:-127.0.0.1:18443}"
ZMQBLOCK="${BITCOIND_ZMQBLOCK:-tcp://127.0.0.1:28332}"
ZMQTX="${BITCOIND_ZMQTX:-tcp://127.0.0.1:28333}"

echo ">>> waiting for $BIND_IP (openvpn tun0)"
for i in $(seq 1 120); do
    ip -4 addr show | grep -qw "$BIND_IP" && { echo ">>> $BIND_IP is up"; break; }
    [ "$i" = 120 ] && { echo "ERROR: $BIND_IP never appeared - is the openvpn container running?" >&2; exit 1; }
    sleep 1
done

echo ">>> waiting for bitcoind at $RPCHOST"
for i in $(seq 1 180); do
    if curl -s -m 3 --user "$RPCUSER:$RPCPASS" \
         --data-binary '{"jsonrpc":"1.0","method":"getblockchaininfo","params":[]}' \
         -H 'content-type: text/plain;' "http://$RPCHOST/" | grep -q '"result"'; then
        echo ">>> bitcoind is up"; break
    fi
    [ "$i" = 180 ] && { echo "ERROR: bitcoind never answered at $RPCHOST" >&2; exit 1; }
    sleep 2
done

mkdir -p /data/lnd

# The merchant address is one value with two jobs: it is the script the channel
# must cooperatively close to, and it is the only on-chain destination this node
# is permitted to pay. Passing both from the same variable is what keeps them
# identical - lnd refuses to start if they ever disagree.
hardening=()
if [ "$ROLE" = "merchant" ]; then
    if [ -z "${MERCHANT_ADDRESS:-}" ]; then
        echo "ERROR: MERCHANT_ADDRESS is empty." >&2
        echo "Starting the merchant node unhardened would quietly test" >&2
        echo "the wrong thing. Run scripts/64-provision-merchant.sh." >&2
        exit 1
    fi

    echo ">>> merchant address: $MERCHANT_ADDRESS"
    hardening=(
        --enable-upfront-shutdown
        "--upfront-shutdown-address=$MERCHANT_ADDRESS"
        "--security.onchain-allowlist=$MERCHANT_ADDRESS"
    )
fi

# Credentials come in as flags, not in lnd.conf, so they never enter git.
exec lnd --configfile="$CONF" \
    --bitcoind.rpcuser="$RPCUSER" \
    --bitcoind.rpcpass="$RPCPASS" \
    --bitcoind.rpchost="$RPCHOST" \
    --bitcoind.zmqpubrawblock="$ZMQBLOCK" \
    --bitcoind.zmqpubrawtx="$ZMQTX" \
    ${hardening[@]+"${hardening[@]}"}
