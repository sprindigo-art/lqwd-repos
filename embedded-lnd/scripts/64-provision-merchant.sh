#!/bin/bash
# Provision the merchant's settlement address, and start the appliance
# stand-in node that is bound to it.
#
#   ./64-provision-merchant.sh          # reuse the existing address
#   ./64-provision-merchant.sh --new    # mint a fresh one
#
# In the product this address comes from the merchant's own hardware wallet and
# is captured at order time. On regtest there is no hardware wallet, so we mint
# one from a separate `merchant` wallet in the regtest bitcoind and treat that
# wallet as their custody - the same arrangement testbed/COOP-CLOSE-DEMO.md
# used.
#
# The address is written to secrets/merchant.env, which is the single source
# for both consumers:
#
#   the Pi image     lnd-bin_0.21.3.bb substitutes it into /etc/lnd/lnd.conf as
#                    upfront-shutdown-address AND security.onchain-allowlist
#   lnd-merchant     the entrypoint passes it as both of those flags
#
# One value, two jobs: the address the channel closes to is the only address
# the node is permitted to pay. lnd refuses to start if they disagree.
. "$(dirname "$0")/env.sh"

TESTBED_ROOT="${TESTBED_ROOT:-/vm/testbed}"
COMPOSE_DIR="$TESTBED_ROOT/compose"
MERCHANT_ENV="$TESTBED_ROOT/secrets/merchant.env"
WALLET="${MERCHANT_WALLET:-merchant}"
BC=lnd-testbed-bitcoind
CLI="bitcoin-cli -conf=/data/bitcoind/bitcoin.conf -datadir=/data/bitcoind"

docker inspect -f '{{.State.Running}}' "$BC" 2>/dev/null | grep -q true || {
    echo "$BC is not running - start the testbed first:" >&2
    echo "  ./scripts/61-testbed-up.sh" >&2
    exit 1
}

# --- the merchant's custody: a separate wallet in the regtest node ------
if docker exec "$BC" $CLI listwallets | grep -q "\"$WALLET\""; then
    say "bitcoind wallet '$WALLET' already loaded"
elif docker exec "$BC" $CLI loadwallet "$WALLET" >/dev/null 2>&1; then
    say "Loaded existing bitcoind wallet '$WALLET'"
else
    say "Creating bitcoind wallet '$WALLET' (stands in for the hardware wallet)"
    docker exec "$BC" $CLI createwallet "$WALLET" >/dev/null
fi

# --- the address -------------------------------------------------------
CURRENT=""
[ -f "$MERCHANT_ENV" ] && . "$MERCHANT_ENV" && CURRENT="${MERCHANT_ADDRESS:-}"

if [ "${1:-}" = "--new" ] || [ -z "$CURRENT" ]; then
    ADDR=$(docker exec "$BC" $CLI -rpcwallet="$WALLET" getnewaddress "" bech32)
    say "Minted merchant address $ADDR"
else
    ADDR="$CURRENT"
    say "Reusing merchant address $ADDR"
fi

# A settlement address the merchant cannot actually spend from would be a very
# quiet failure, so confirm the wallet owns it before anything is baked in.
docker exec "$BC" $CLI -rpcwallet="$WALLET" getaddressinfo "$ADDR" \
    | grep -q '"ismine": true' || {
    echo "ERROR: $ADDR is not owned by the '$WALLET' wallet." >&2
    echo "Re-run with --new to mint one that is." >&2
    exit 1
}

# --- the merchant's public payment endpoint ----------------------------
#
# The appliance accepts no inbound connection from the internet, so it cannot
# host a URL. This is the name the GATEWAY serves for this merchant and
# proxies to the device over the tunnel; it is what lnurlpd advertises as its
# callback, both in the image and in the container.
LNURL_BASE_URL="${LNURL_BASE_URL:-https://pay.testbed.local}"
LNURL_NAME="${LNURL_NAME:-merchant}"
say "Lightning address $LNURL_NAME@${LNURL_BASE_URL#https://}"

mkdir -p "$(dirname "$MERCHANT_ENV")"
{
    echo "MERCHANT_ADDRESS=$ADDR"
    echo "LNURL_BASE_URL=$LNURL_BASE_URL"
    echo "LNURL_NAME=$LNURL_NAME"
} > "$MERCHANT_ENV"
chmod 600 "$MERCHANT_ENV"
say "Wrote $MERCHANT_ENV"
cat "$MERCHANT_ENV"

# --- the node that is bound to it --------------------------------------
# The whole appliance stand-in, not just lnd: lndk gives it BOLT 12 offers and
# lnurlpd gives it an LNURL-pay endpoint, with the gateway proxy in front of
# that. They wait for the wallet rather than crash-looping, so starting them
# before 62-init-server-wallet.sh is fine.
say "Starting the appliance stand-in and the gateway services"
cd "$COMPOSE_DIR"
docker compose --profile merchant up -d

say "Security policy as the node sees it"
for i in $(seq 1 30); do
    docker logs lnd-testbed-merchant 2>&1 | grep -m1 "Security policy:" && break
    [ "$i" = 30 ] && echo "(not logged yet - docker logs lnd-testbed-merchant)"
    sleep 2
done

cat <<EOF

Next:
  ./scripts/62-init-server-wallet.sh merchant    # one-time wallet creation
  ./scripts/63-fund-server-lnd.sh 1 merchant     # on-chain coins to spend
  ./scripts/66-security-demo.sh                  # prove the policy holds
  ./scripts/67-open-channel.sh                   # gateway -> merchant channel
  ./scripts/68-lnurl-demo.sh                     # LNURL-pay, end to end
  ./scripts/69-bolt12-demo.sh                    # BOLT 12 offers, end to end

The Pi image picks the same address up at bake time:
  ./scripts/30-sync-layer.sh && ./scripts/50-bake.sh
EOF
