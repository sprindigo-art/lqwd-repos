#!/bin/bash
# BOLT 12 offers, end to end, through lndk.
#
# lnd v0.21 carries onion messages but has no offers RPC: it will relay an
# invoice_request and deliver one addressed to it, and that is all. Everything
# above that - the offer, the invoice_request, the BOLT 12 invoice - is lndk's,
# running beside each node.
#
# What this demonstrates, in order:
#
#   1. the two lndks are on lnd's NATIVE onion message transport, not the
#      custom-message tunnel released lndk uses, which lnd 0.21 no longer
#      feeds (see docs/BOLT12.md);
#   2. the appliance can publish an offer and answer an invoice_request for
#      it, over onion messages, and be paid;
#   3. it still cannot pay one. It is a receive-only terminal, and BOLT 12
#      does not quietly reopen the spending path the security layer closed.
#
# Run after:
#   ./scripts/64-provision-merchant.sh
#   ./scripts/62-init-server-wallet.sh merchant
#   ./scripts/67-open-channel.sh
. "$(dirname "$0")/env.sh"

MERCH=lnd-testbed-merchant
LNDK_M=lnd-testbed-lndk-merchant
LNDK_G=lnd-testbed-lndk-gateway

AMOUNT_MSAT="${AMOUNT_MSAT:-50000}"
MACAROON=/data/lnd/data/chain/bitcoin/regtest/admin.macaroon
CERT=/data/lndk/tls-cert.pem

# lndk-cli against each node's lndk. The macaroon is lnd's; lndk uses it to
# authenticate the caller as well as to reach lnd.
# The exit code is not the signal here - a refusal is the expected result
# of some of these calls - so the output is captured and env.sh's set -e is
# kept out of it.
KM() { docker exec "$LNDK_M" lndk-cli --macaroon-path="$MACAROON" --cert-path="$CERT" --grpc-port=7000 "$@" 2>&1 || true; }
KG() { docker exec "$LNDK_G" lndk-cli --macaroon-path="$MACAROON" --cert-path="$CERT" --grpc-port=7001 "$@" 2>&1 || true; }
M() { docker exec "$MERCH" lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:10010 "$@"; }
JQ() { docker exec -i "$MERCH" jq "$@"; }

pass=0
fail=0

report() {
    if printf '%s' "$3" | grep -qF "$2"; then
        printf '  PASS  %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s\n' "$1"
        printf '        expected to find: %s\n' "$2"
        printf '        got: %s\n' "$(printf '%s' "$3" | head -3 | tr '\n' ' ' | head -c 300)"
        fail=$((fail + 1))
    fi
}

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

merchant_balance() {
    M listchannels 2>/dev/null | JQ -r '[.channels[].local_balance | tonumber] | add // 0'
}

M listchannels 2>/dev/null | JQ -e '.channels | length > 0' >/dev/null || {
    echo "The merchant has no channel - run ./scripts/67-open-channel.sh" >&2
    exit 1
}

say "1. The transport underneath"
# The whole reason lndk is pinned to a branch rather than a release: released
# lndk listens for onion messages on the custom-message stream, and lnd 0.21
# handles message 513 natively and no longer puts it there.
report "the merchant's lndk uses lnd's native onion messages" \
    "Using Native onion message transport" \
    "$(docker logs "$LNDK_M" 2>&1 | tail -50)"
report "the gateway's lndk does too" \
    "Using Native onion message transport" \
    "$(docker logs "$LNDK_G" 2>&1 | tail -50)"

say "2. The appliance publishes an offer"
OFFER_OUT=$(KM create-offer --amount "$AMOUNT_MSAT" --description "espresso")
OFFER=$(printf '%s' "$OFFER_OUT" | grep -o 'lno1[a-z0-9]*' | head -1)
[ -n "$OFFER" ] || { echo "no offer in: $OFFER_OUT" >&2; exit 1; }
echo "  ${OFFER:0:80}..."
report "it is a BOLT 12 offer" "lno1" "$OFFER"

DECODED=$(KG decode-offer "$OFFER")
report "the gateway can decode it, and it is for $AMOUNT_MSAT msat" \
    "$AMOUNT_MSAT" "$DECODED"
report "carrying the description" "espresso" "$DECODED"

say "3. An invoice_request over onion messages, answered"
# An offer is static; the invoice comes from asking. This is the round trip -
# invoice_request out over an onion message, BOLT 12 invoice back over the
# blinded reply path - with no payment involved.
INVOICE=$(KG get-invoice "$OFFER")
report "the appliance answered with an invoice" "Invoice" "$INVOICE"

say "4. The gateway pays the offer"
BEFORE=$(merchant_balance)
PAID=$(KG pay-offer "$OFFER")
report "the payment succeeded" "Successfully paid" "$PAID"

AFTER=$(merchant_balance)
GROWTH=$(( AFTER - BEFORE ))
echo "  merchant channel balance: $BEFORE -> $AFTER sat"
# Not an equality: the payer also pays the blinded path's dummy hop, and that
# fee lands with the recipient - so the merchant receives slightly more than
# the offer amount.
if [ "$GROWTH" -ge "$(( AMOUNT_MSAT / 1000 ))" ]; then
    printf '  PASS  %s\n' "the merchant received at least the offer amount"
    pass=$((pass + 1))
else
    printf '  FAIL  %s\n' "the merchant received at least the offer amount"
    printf '        grew by %s sat, expected at least %s\n' \
        "$GROWTH" "$(( AMOUNT_MSAT / 1000 ))"
    fail=$((fail + 1))
fi

SETTLED=$(M listinvoices | JQ -r '[.invoices[] | select(.state == "SETTLED")] | last | .amt_paid_msat')
check "and settled an invoice for it" \
    "$([ "$SETTLED" -ge "$AMOUNT_MSAT" ] && echo yes || echo no)" "yes"

say "5. It still cannot pay one"
# The mirror image: an offer from the gateway, which the appliance can fetch
# an invoice for and then must refuse to pay. The refusal has to come from the
# security policy - a failure for any other reason would prove nothing.
GW_OFFER_OUT=$(KG create-offer --amount 10000 --description "gateway offer")
GW_OFFER=$(printf '%s' "$GW_OFFER_OUT" | grep -o 'lno1[a-z0-9]*' | head -1)
[ -n "$GW_OFFER" ] || { echo "no gateway offer in: $GW_OFFER_OUT" >&2; exit 1; }

REFUSED=$(KM pay-offer "$GW_OFFER")
report "paying an offer is refused by the security policy" \
    "disabled by the security policy" "$REFUSED"

say "Result"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
