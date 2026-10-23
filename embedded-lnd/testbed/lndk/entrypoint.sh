#!/bin/bash
# lndk: BOLT 12 offers for an lnd that does not have them.
#
# lnd v0.21 carries onion messages but has no offers RPC, so the offer, the
# invoice_request and the BOLT 12 invoice are all lndk's; lnd is the transport
# underneath and the signer it borrows.
#
# Two instances run in this testbed, one per node:
#
#   lndk-gateway    against lnd-server,   gRPC 127.0.0.1:7001
#   lndk-merchant   against lnd-merchant, gRPC 127.0.0.1:7000
#
# The merchant one creates offers and answers invoice_requests. It cannot pay
# an offer: SendPaymentV2 is disabled by the appliance's security policy, which
# is deliberate and is one of the things scripts/69-bolt12-demo.sh checks.
#
# The macaroon is lnd's admin macaroon. lndk needs signer, peer and invoice
# access across three sub-servers, and the appliance cannot bake a narrower
# one - BakeMacaroon is disabled there. On this node that is not the loss it
# sounds like: the security layer holds for the admin macaroon too.
set -euo pipefail

NETWORK="${LND_NETWORK:-regtest}"
LND_DIR="${LND_DIR:-/data/lnd}"
LND_RPC="${LND_RPC:-127.0.0.1:10009}"
LNDK_DATA="${LNDK_DATA:-/data/lndk}"
GRPC_PORT="${LNDK_GRPC_PORT:-7000}"
MACAROON="$LND_DIR/data/chain/bitcoin/$NETWORK/admin.macaroon"

mkdir -p "$LNDK_DATA"

# The macaroons and the TLS certificate only exist once the wallet has been
# created, which is 62-init-server-wallet.sh and may be much later than the
# first start of this container. Waiting beats crash-looping.
echo ">>> waiting for lnd credentials in $LND_DIR"
for i in $(seq 1 600); do
    [ -f "$MACAROON" ] && [ -f "$LND_DIR/tls.cert" ] && break
    [ "$i" = 600 ] && { echo "ERROR: no macaroon at $MACAROON" >&2; exit 1; }
    sleep 2
done

# lndk subscribes to onion messages and peer events, neither of which lnd
# serves before the wallet is unlocked and the server is up.
echo ">>> waiting for lnd at $LND_RPC to become active"
for i in $(seq 1 600); do
    state=$(lncli --network="$NETWORK" --lnddir="$LND_DIR" \
                  --rpcserver="$LND_RPC" state 2>/dev/null | tr -d ' \n' || true)
    case "$state" in
        *SERVER_ACTIVE*) echo ">>> lnd is active"; break ;;
    esac
    [ "$i" = 600 ] && { echo "ERROR: lnd never became active" >&2; exit 1; }
    sleep 2
done

# lndk takes no --network: it reads the chain from the lnd it connects to.
echo ">>> starting lndk against $LND_RPC, gRPC on 127.0.0.1:$GRPC_PORT"
exec lndk \
    --address="https://$LND_RPC" \
    --cert-path="$LND_DIR/tls.cert" \
    --macaroon-path="$MACAROON" \
    --data-dir="$LNDK_DATA" \
    --grpc-host=127.0.0.1 \
    --grpc-port="$GRPC_PORT" \
    --log-level="${LNDK_LOG_LEVEL:-info}"
