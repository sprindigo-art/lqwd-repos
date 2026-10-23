#!/bin/bash
# LNURL-pay, end to end, the way a customer's wallet does it.
#
# The point of the exercise is not that LNURL works - it is where the pieces
# sit. The appliance accepts no inbound connection from the internet, so it
# cannot host the URL a wallet fetches. The gateway owns the public name and
# certificate and proxies to the device over the tunnel the DEVICE dialled
# out. Everything below goes through that public endpoint; nothing in this
# script talks to the appliance directly except to check that it is not
# listening anywhere it should not be.
#
# One honest simplification: the gateway node is also the payer here, because
# on a private regtest there is nobody else. In the product the payer is a
# stranger's phone and the gateway is only the last hop.
#
# Run after:
#   ./scripts/64-provision-merchant.sh
#   ./scripts/62-init-server-wallet.sh merchant
#   ./scripts/67-open-channel.sh
. "$(dirname "$0")/env.sh"

GW=lnd-testbed-node
MERCH=lnd-testbed-merchant
LNURLPD=lnd-testbed-lnurlpd

HOST="${LNURL_HOST:-pay.testbed.local}"
NAME="${LNURL_NAME:-merchant}"
AMOUNT_MSAT="${AMOUNT_MSAT:-21000}"
COMMENT="table 4"

# The customer's wallet: curl from the gateway node's container, resolving the
# public name to the gateway's listener and verifying its certificate.
C() {
    docker exec "$GW" curl -sS -m 20 \
        --resolve "$HOST:443:127.0.0.1" --cacert /gw/gateway.crt "$@" || true
}
# A refused or failed call is a result to inspect, not a reason to abort, so
# these keep env.sh's set -e out of the capture.
G() { docker exec "$GW" lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:10009 "$@" || true; }
M() { docker exec "$MERCH" lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:10010 "$@"; }
JQ() { docker exec -i "$GW" jq "$@"; }

pass=0
fail=0

check() {
    if [ "$2" = "$3" ]; then
        printf '  PASS  %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s\n' "$1"
        printf '        expected: %s\n' "$3"
        printf '        got:      %s\n' "$2"
        fail=$((fail + 1))
    fi
}

contains() {
    if printf '%s' "$2" | grep -qF "$3"; then
        printf '  PASS  %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s\n' "$1"
        printf '        expected to find: %s\n' "$3"
        printf '        got:              %s\n' "$(printf '%s' "$2" | head -c 200)"
        fail=$((fail + 1))
    fi
}

merchant_balance() {
    M listchannels 2>/dev/null | JQ -r '[.channels[].local_balance | tonumber] | add // 0'
}

M listchannels 2>/dev/null | JQ -e '.channels | length > 0' >/dev/null || {
    echo "The merchant has no channel - run ./scripts/67-open-channel.sh" >&2
    exit 1
}

say "0. What the merchant hands out"
docker exec "$LNURLPD" lnurlpd -print-lnurl \
    -base-url="https://$HOST" -name="$NAME"

say "1. The appliance is listening on the VPN only"
# Everything in this testbed shares one network namespace, so this is the same
# loopback lnurlpd would be on if it were bound to 0.0.0.0 or 127.0.0.1.
LOOPBACK=$(docker exec "$GW" curl -sS -m 3 -o /dev/null -w '%{http_code}' \
    http://127.0.0.1:8090/healthz 2>&1 || echo refused)
contains "nothing answers on loopback" "$LOOPBACK" "refused"
TUNNEL=$(docker exec "$GW" curl -sS -m 3 -o /dev/null -w '%{http_code}' \
    http://10.99.0.1:8090/healthz 2>&1 || echo refused)
check "the VPN address does answer" "$TUNNEL" "200"

say "2. A wallet resolves $NAME@$HOST"
PAYREQ=$(C "https://$HOST/.well-known/lnurlp/$NAME")
echo "$PAYREQ" | JQ .

check "tag is payRequest" "$(printf '%s' "$PAYREQ" | JQ -r .tag)" "payRequest"
check "the callback is the gateway's public URL, not the device's" \
    "$(printf '%s' "$PAYREQ" | JQ -r .callback)" \
    "https://$HOST/lnurlp/$NAME/callback"
contains "the metadata carries the lightning address" \
    "$(printf '%s' "$PAYREQ" | JQ -r .metadata)" "$NAME@$HOST"

say "3. The wallet asks for an invoice"
CALLBACK=$(printf '%s' "$PAYREQ" | JQ -r .callback)
RESPONSE=$(C "$CALLBACK?amount=$AMOUNT_MSAT&comment=$(printf '%s' "$COMMENT" | tr ' ' '+')")
PR=$(printf '%s' "$RESPONSE" | JQ -r .pr)
VERIFY=$(printf '%s' "$RESPONSE" | JQ -r .verify)
echo "  invoice: ${PR:0:60}..."
echo "  verify:  $VERIFY"

DECODED=$(G decodepayreq --pay_req="$PR")
check "the invoice is for the amount asked for" \
    "$(printf '%s' "$DECODED" | JQ -r .num_msat)" "$AMOUNT_MSAT"

# LUD-06's actual requirement, and the one thing a wallet checks that a
# hand-rolled implementation usually gets wrong: the invoice's description
# hash must be the sha256 of the metadata string, byte for byte.
META_HASH=$(printf '%s' "$PAYREQ" | \
    docker exec -i "$GW" sh -c 'jq -r .metadata | tr -d "\n" | sha256sum | cut -d" " -f1')
check "its description hash is sha256 of the metadata" \
    "$(printf '%s' "$DECODED" | JQ -r .description_hash)" "$META_HASH"

say "4. Before payment"
BEFORE=$(C "$VERIFY")
check "verify says it has not settled" \
    "$(printf '%s' "$BEFORE" | JQ -r .settled)" "false"
# lnd knows the preimage from the moment it makes the invoice. Handing it out
# now would publish the proof of a payment nobody has made.
check "and gives out no preimage" \
    "$(printf '%s' "$BEFORE" | JQ -r '.preimage // ""')" ""

say "5. The customer pays it"
BALANCE_BEFORE=$(merchant_balance)
# --json prints one object per state update, so the last one is the outcome.
PAYMENT=$(G payinvoice --force --json --pay_req="$PR" 2>/dev/null)
check "the payment succeeded" \
    "$(printf '%s' "$PAYMENT" | JQ -s -r '.[-1].status // "no status"')" "SUCCEEDED"
PREIMAGE=$(printf '%s' "$PAYMENT" | JQ -s -r '.[-1].payment_preimage // ""')

say "6. After payment"
AFTER=$(C "$VERIFY")
check "verify says it settled" \
    "$(printf '%s' "$AFTER" | JQ -r .settled)" "true"
check "and now returns the preimage the payer got" \
    "$(printf '%s' "$AFTER" | JQ -r '.preimage // ""')" "$PREIMAGE"

BALANCE_AFTER=$(merchant_balance)
check "the merchant's channel balance grew by the payment" \
    "$((BALANCE_AFTER - BALANCE_BEFORE))" "$((AMOUNT_MSAT / 1000))"

say "7. What the endpoint refuses"
LOW=$(C "$CALLBACK?amount=1")
check "an amount below the minimum" \
    "$(printf '%s' "$LOW" | JQ -r .status)" "ERROR"
HIGH=$(C "$CALLBACK?amount=99999999999")
check "an amount above the maximum" \
    "$(printf '%s' "$HIGH" | JQ -r .status)" "ERROR"
UNKNOWN=$(C "https://$HOST/.well-known/lnurlp/someone-else")
check "a recipient this device does not serve" \
    "$(printf '%s' "$UNKNOWN" | JQ -r .status)" "ERROR"
# The proxy publishes the LNURL surface and nothing else, so a future endpoint
# on the daemon does not become public by accident.
STATUS=$(docker exec "$GW" curl -sS -m 5 -o /dev/null -w '%{http_code}' \
    --resolve "$HOST:443:127.0.0.1" --cacert /gw/gateway.crt \
    "https://$HOST/healthz")
check "any path outside the LNURL surface" "$STATUS" "404"

say "Result"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
