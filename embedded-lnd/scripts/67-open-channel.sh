#!/bin/bash
# Open a channel from the gateway to the appliance stand-in, the way the real
# one is opened: the GATEWAY dials and funds it.
#
#   ./67-open-channel.sh                  # 1,000,000 sat, 100,000 pushed
#   ./67-open-channel.sh 2000000 200000
#
# The direction matters. The appliance accepts no inbound connections, so it
# can never be the one dialled from the internet - but it does not need to be.
# The gateway dials it over the tunnel the device brought up, and the channel
# rides that connection. Inbound liquidity for the merchant is the gateway's
# side of the channel, which is why local_amt is the gateway's money.
#
# push_amt gives the merchant a small local balance. It is not needed to
# receive; it is there so that "the appliance cannot pay" is demonstrably
# about the policy and not about an empty channel.
#
# Idempotent: if the channel is already there it says so and stops.
. "$(dirname "$0")/env.sh"

LOCAL_AMT="${1:-1000000}"
PUSH_AMT="${2:-100000}"

GW=lnd-testbed-node
MERCH=lnd-testbed-merchant
MERCHANT_P2P="${MERCHANT_P2P:-10.99.0.1:9736}"

G() { docker exec "$GW" lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:10009 "$@"; }
M() { docker exec "$MERCH" lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:10010 "$@"; }
JQ() { docker exec -i "$GW" jq "$@"; }

MERCHANT_PUB=$(M getinfo 2>/dev/null | JQ -r .identity_pubkey)
[ -n "$MERCHANT_PUB" ] || {
    echo "Could not read the merchant's pubkey - is its wallet created?" >&2
    echo "  ./scripts/62-init-server-wallet.sh merchant" >&2
    exit 1
}

say "Merchant node $MERCHANT_PUB"

if G listchannels 2>/dev/null | JQ -e --arg p "$MERCHANT_PUB" \
       '.channels[] | select(.remote_pubkey == $p)' >/dev/null; then
    say "A channel to the merchant already exists"
    G listchannels | JQ --arg p "$MERCHANT_PUB" \
        '.channels[] | select(.remote_pubkey == $p) |
         {active, local_balance, remote_balance, private, close_address}'
    exit 0
fi

say "Connecting"
G connect "$MERCHANT_PUB@$MERCHANT_P2P" 2>&1 | grep -v "already connected" || true

say "Opening a channel: $LOCAL_AMT sat, $PUSH_AMT pushed to the merchant"
# --private: the appliance is not an announced routing node. It is the last
# hop, reached through the gateway, and invoices carry route hints instead.
G openchannel --node_key="$MERCHANT_PUB" \
    --local_amt="$LOCAL_AMT" --push_amt="$PUSH_AMT" --private

say "Mining 6 blocks to confirm it"
"$(dirname "$0")/65-mine.sh" 6 >/dev/null

say "Waiting for the channel to go active"
for i in $(seq 1 60); do
    if G listchannels 2>/dev/null | JQ -e --arg p "$MERCHANT_PUB" \
           '.channels[] | select(.remote_pubkey == $p and .active)' >/dev/null; then
        say "Channel is active"
        break
    fi
    [ "$i" = 60 ] && { echo "Channel never became active" >&2; G pendingchannels; exit 1; }
    sleep 2
done

say "Gateway's view"
G listchannels | JQ --arg p "$MERCHANT_PUB" \
    '.channels[] | select(.remote_pubkey == $p) |
     {active, private, local_balance, remote_balance}'

say "Merchant's view"
# remote_balance here is the merchant's INBOUND liquidity: what it can receive.
M listchannels | JQ '.channels[] |
    {active, local_balance, remote_balance, close_address}'
