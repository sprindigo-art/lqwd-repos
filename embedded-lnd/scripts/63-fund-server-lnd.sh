#!/bin/bash
# Send regtest coins from the miner wallet to one of the test lnd nodes.
#
# On regtest there is no faucet: coins come from mining. The miner container
# primes the chain to 101 blocks (coinbase maturity) on first start, so there
# is a spendable balance to send from.
#
#   ./63-fund-server-lnd.sh              # 1 BTC to the gateway
#   ./63-fund-server-lnd.sh 5            # 5 BTC to the gateway
#   ./63-fund-server-lnd.sh 1 merchant   # 1 BTC to the appliance stand-in
. "$(dirname "$0")/env.sh"

AMOUNT="${1:-1}"
NODE="${2:-server}"
WALLET="${MINER_WALLET:-miner}"
BC=lnd-testbed-bitcoind

case "$NODE" in
    server)   LC=lnd-testbed-node;     RPC=10009 ;;
    merchant) LC=lnd-testbed-merchant; RPC=10010 ;;
    *) echo "usage: $0 [amount] [server|merchant]" >&2; exit 1 ;;
esac

CLI="bitcoin-cli -conf=/data/bitcoind/bitcoin.conf -datadir=/data/bitcoind -rpcwallet=$WALLET"
LNCLI="lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:$RPC"

ADDR=$(docker exec "$LC" $LNCLI newaddress p2wkh 2>/dev/null | \
       docker exec -i "$LC" jq -r .address)
[ -n "$ADDR" ] || { echo "Could not get an address from lnd - is the wallet unlocked?" >&2; exit 1; }

say "Sending $AMOUNT BTC to $NODE at $ADDR"
TXID=$(docker exec "$BC" $CLI sendtoaddress "$ADDR" "$AMOUNT")
say "txid $TXID"

say "Mining 6 blocks to confirm"
"$(dirname "$0")/65-mine.sh" 6 >/dev/null

say "lnd wallet balance"
docker exec "$LC" $LNCLI walletbalance
