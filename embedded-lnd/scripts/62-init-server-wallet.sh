#!/bin/bash
# One-time wallet creation for a test node, plus a funding address.
#
#   ./62-init-server-wallet.sh             # the gateway, lnd-server
#   ./62-init-server-wallet.sh merchant    # the appliance stand-in
#
# wallet-unlock-password-file does NOT create a wallet - it only unlocks one
# that already exists (see lnd config_builder.go: the password file is read
# only when walletExists). wallet-unlock-allow-create merely stops lnd exiting
# while it waits. So the wallet has to be initialised exactly once; after that
# every restart unlocks itself from the password file.
#
# `lncli create` is interactive, so this drives lnd's REST API instead. All the
# JSON work happens inside the container, which already has curl and jq, so the
# host needs neither.
#
# Idempotent: if a wallet already exists it just prints a fresh address.
. "$(dirname "$0")/env.sh"

TESTBED_ROOT="${TESTBED_ROOT:-/vm/testbed}"

NODE="${1:-server}"
case "$NODE" in
    server)
        C=lnd-testbed-node
        DATADIR="$TESTBED_ROOT/lnd"
        RPC=10009
        REST=8080
        ;;
    merchant)
        C=lnd-testbed-merchant
        DATADIR="$TESTBED_ROOT/lnd-merchant"
        RPC=10010
        REST=8081
        ;;
    *)
        echo "usage: $0 [server|merchant]" >&2
        exit 1
        ;;
esac

SEEDFILE="$DATADIR/seed.txt"
LNCLI="lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:$RPC"

say "Node: $NODE ($C)"

state=$(docker exec "$C" $LNCLI state 2>/dev/null | tr -d ' \n')

if echo "$state" | grep -q NON_EXISTING; then
    say "No wallet yet - creating one"

    # -i is required: without it docker exec attaches no stdin and the
    # heredoc is silently discarded. $REST is passed as a positional
    # parameter because the heredoc is quoted and expands nothing.
    docker exec -i "$C" sh -s "$REST" <<'INNER'
set -eu
REST=$1
PW_B64=$(tr -d '\n' < /data/lnd/wallet-password | base64 -w0)

echo ">>> generating cipher seed"
SEED_JSON=$(curl -s -k "https://127.0.0.1:$REST/v1/genseed")
echo "$SEED_JSON" | grep -q cipher_seed_mnemonic || {
    echo "genseed failed: $SEED_JSON" >&2; exit 1; }

MNEMONIC=$(echo "$SEED_JSON" | jq -c .cipher_seed_mnemonic)
echo "$MNEMONIC" | jq -r '.[]' | tr '\n' ' ' > /data/lnd/seed.txt
chmod 600 /data/lnd/seed.txt

echo ">>> initialising wallet"
jq -n --arg pw "$PW_B64" --argjson seed "$MNEMONIC" \
    '{wallet_password:$pw, cipher_seed_mnemonic:$seed}' \
  | curl -s -k -X POST --data-binary @- "https://127.0.0.1:$REST/v1/initwallet"
echo
INNER

    say "Waiting for the wallet to become active"
    for i in $(seq 1 90); do
        s=$(docker exec "$C" $LNCLI state 2>/dev/null | tr -d ' \n')
        case "$s" in
            *SERVER_ACTIVE*|*RPC_ACTIVE*) say "Wallet active"; break ;;
        esac
        [ "$i" = 90 ] && { echo "wallet did not become active; docker logs $C" >&2; exit 1; }
        sleep 2
    done
    say "Seed written to $SEEDFILE (throwaway regtest wallet, but keep it)"
else
    say "Wallet already initialised (state: $state)"
fi

say "Node identity"
docker exec "$C" $LNCLI getinfo 2>/dev/null | \
    docker exec -i "$C" jq '{version, identity_pubkey, synced_to_chain, synced_to_graph, block_height}'

say "On-chain funding address (regtest)"
ADDR=$(docker exec "$C" $LNCLI newaddress p2wkh 2>/dev/null | \
       docker exec -i "$C" jq -r .address)
echo
echo "    $ADDR"
echo
echo "  Fund it with: ./scripts/63-fund-server-lnd.sh 1 $NODE"
echo
say "Balance"
docker exec "$C" $LNCLI walletbalance 2>/dev/null || true
