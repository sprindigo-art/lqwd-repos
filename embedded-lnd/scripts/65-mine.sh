#!/bin/bash
# Mine N regtest blocks immediately (default 6).
#
# The miner service produces a block every MINE_INTERVAL seconds (10 minutes by
# default), which is realistic but slow when you are waiting on a channel to
# confirm. Use this to move the chain along during a test.
#
#   ./65-mine.sh        # 6 blocks
#   ./65-mine.sh 101    # prime a fresh chain
. "$(dirname "$0")/env.sh"

N="${1:-6}"
WALLET="${MINER_WALLET:-miner}"
C=lnd-testbed-bitcoind
CLI="bitcoin-cli -conf=/data/bitcoind/bitcoin.conf -datadir=/data/bitcoind"

ADDR=$(docker exec "$C" $CLI -rpcwallet="$WALLET" getnewaddress 2>/dev/null) || {
    echo "Could not get an address from the '$WALLET' wallet." >&2
    echo "Is the miner container running?  docker logs lnd-testbed-miner" >&2
    exit 1; }

say "Mining $N block(s) to $ADDR"
docker exec "$C" $CLI -rpcwallet="$WALLET" generatetoaddress "$N" "$ADDR" >/dev/null
say "Height is now $(docker exec "$C" $CLI getblockcount)"
