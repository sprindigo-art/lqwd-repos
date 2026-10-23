#!/bin/bash
# Rebake the channeladmin.macaroon with the full set of URIs + entity perms
# the gateway actually invokes. Heredoc-style so it survives terminal paste
# (a multi-line lncli command with backslash continuations got split by
# terminal wrap during the 2026-04-20 incident and produced a 108-byte
# macaroon with only 2 URIs — missing NewAddress, SendCoins, etc.).
#
# Usage:
#   sudo ./rebake-channeladmin.sh                  # defaults to mainnet
#   sudo NETWORK=signet ./rebake-channeladmin.sh   # signet
#
# After running, restart the gateway:
#   sudo systemctl restart lnd-gateway         # mainnet
#   sudo systemctl restart lnd-gateway-signet  # signet

set -euo pipefail

NETWORK="${NETWORK:-mainnet}"
case "${NETWORK}" in
    mainnet)
        MAC_DIR="/lnd/data/chain/bitcoin/mainnet"
        LNDDIR="/lnd"
        RPCSERVER="127.0.0.1:10009"
        ;;
    signet)
        MAC_DIR="/lnd-signet/data/chain/bitcoin/signet"
        LNDDIR="/lnd-signet"
        RPCSERVER="127.0.0.1:10010"
        ;;
    *)
        echo "Unknown network: ${NETWORK} (expected mainnet or signet)" >&2
        exit 1
        ;;
esac

MAC_FILE="${MAC_DIR}/channeladmin.macaroon"
BACKUP="${MAC_FILE}.pre-rebake.$(date +%s).bak"

echo "Network: ${NETWORK}"
echo "Target macaroon: ${MAC_FILE}"
echo

echo "Backing up current macaroon to ${BACKUP}..."
cp "${MAC_FILE}" "${BACKUP}"
ls -la "${MAC_FILE}" "${BACKUP}"
echo

echo "Baking new channeladmin.macaroon..."
sudo -u lnd lncli --lnddir="${LNDDIR}" --network="${NETWORK}" --rpcserver="${RPCSERVER}" bakemacaroon \
    uri:/lnrpc.Lightning/OpenChannelSync \
    uri:/lnrpc.Lightning/CloseChannel \
    uri:/lnrpc.Lightning/ConnectPeer \
    uri:/lnrpc.Lightning/DisconnectPeer \
    uri:/lnrpc.Lightning/NewAddress \
    uri:/lnrpc.Lightning/SendCoins \
    uri:/lnrpc.Lightning/UpdateChannelPolicy \
    uri:/lnrpc.Lightning/ListChannels \
    uri:/lnrpc.Lightning/ListPeers \
    address:write \
    onchain:write \
    peers:write \
    offchain:read \
    offchain:write \
    --save_to="${MAC_FILE}"

chmod 640 "${MAC_FILE}"
chown lnd:lndgateway "${MAC_FILE}"

echo
echo "New macaroon:"
ls -la "${MAC_FILE}"
size=$(stat -c%s "${MAC_FILE}")
if [ "${size}" -lt 400 ]; then
    echo "WARNING: macaroon is only ${size} bytes — expected >= 400. Rebake may have been truncated." >&2
    exit 2
fi
echo "Looks good (${size} bytes). Restart the gateway to pick it up."
