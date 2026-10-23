#!/bin/bash
# Mines one regtest block every MINE_INTERVAL seconds (default 600 = 10 min),
# so the chain advances on its own the way a real network would.
#
# Confirmations therefore take ~10 minutes each. During an interactive test
# that is slow - use scripts/65-mine.sh to mine on demand instead of waiting.
set -euo pipefail

DATADIR=/data/bitcoind
INTERVAL="${MINE_INTERVAL:-600}"
WALLET="${MINER_WALLET:-miner}"
CLI="bitcoin-cli -conf=$DATADIR/bitcoin.conf -datadir=$DATADIR -rpcwallet=$WALLET"
CLI_NOW="bitcoin-cli -conf=$DATADIR/bitcoin.conf -datadir=$DATADIR"

echo ">>> miner: waiting for bitcoind"
for i in $(seq 1 120); do
    $CLI_NOW getblockchaininfo >/dev/null 2>&1 && break
    [ "$i" = 120 ] && { echo "bitcoind never became ready" >&2; exit 1; }
    sleep 2
done

# createwallet fails if it already exists, loadwallet fails if already loaded;
# either way we just need a usable wallet, so try both and carry on.
$CLI_NOW createwallet "$WALLET" >/dev/null 2>&1 || \
    $CLI_NOW loadwallet "$WALLET" >/dev/null 2>&1 || true

ADDR=$($CLI getnewaddress)
echo ">>> miner: mining to $ADDR every ${INTERVAL}s"

# A fresh regtest chain needs 101 blocks before any coinbase is spendable.
HEIGHT=$($CLI_NOW getblockcount)
if [ "$HEIGHT" -lt 101 ]; then
    echo ">>> miner: priming chain to 101 blocks (coinbase maturity)"
    $CLI generatetoaddress $((101 - HEIGHT)) "$ADDR" >/dev/null
    echo ">>> miner: height now $($CLI_NOW getblockcount)"
fi

while true; do
    sleep "$INTERVAL"
    if $CLI generatetoaddress 1 "$ADDR" >/dev/null 2>&1; then
        echo ">>> miner: block $($CLI_NOW getblockcount) at $(date -u +%H:%M:%SZ)"
    else
        echo ">>> miner: generate failed, retrying next interval" >&2
    fi
done
