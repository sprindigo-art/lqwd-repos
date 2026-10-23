#!/bin/bash
# Prove the security layer holds on a running node.
#
# Every call below is made over the ADMIN macaroon - the credential that grants
# everything lnd has to give. If these calls are refused, they are refused by
# something that is not the macaroon system.
#
# Run against the appliance stand-in after:
#   ./scripts/64-provision-merchant.sh
#   ./scripts/62-init-server-wallet.sh merchant
#   ./scripts/63-fund-server-lnd.sh 1 merchant
. "$(dirname "$0")/env.sh"

TESTBED_ROOT="${TESTBED_ROOT:-/vm/testbed}"
MERCHANT_ENV="$TESTBED_ROOT/secrets/merchant.env"
MERCH=lnd-testbed-merchant
GW=lnd-testbed-node
BC=lnd-testbed-bitcoind

[ -f "$MERCHANT_ENV" ] || { echo "no $MERCHANT_ENV - run 64-provision-merchant.sh" >&2; exit 1; }
. "$MERCHANT_ENV"
[ -n "${MERCHANT_ADDRESS:-}" ] || { echo "MERCHANT_ADDRESS is empty" >&2; exit 1; }

M() { docker exec "$MERCH" lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:10010 "$@" 2>&1; }
G() { docker exec "$GW" lncli --network=regtest --lnddir=/data/lnd --rpcserver=127.0.0.1:10009 "$@" 2>&1; }
BTC() { docker exec "$BC" bitcoin-cli -conf=/data/bitcoind/bitcoin.conf -datadir=/data/bitcoind "$@" 2>&1; }

# An address the merchant does not control: where a compromised device would
# send the money.
ATTACKER=$(BTC -rpcwallet=miner getnewaddress "" bech32)

# A well formed transaction paying it, so that the publish attempt below is
# stopped by the policy rather than by lncli failing to parse the hex. It needs
# a real input: a transaction with none deserialises as a segwit marker and
# lncli gives up before it ever reaches the node.
ZEROS=0000000000000000000000000000000000000000000000000000000000000000
RAWTX=$(BTC createrawtransaction "[{\"txid\":\"$ZEROS\",\"vout\":0}]" "{\"$ATTACKER\":0.0001}")

pass=0
fail=0

# report NAME EXPECTED_SUBSTRING OUTPUT
report() {
    if printf '%s' "$3" | grep -qF "$2"; then
        printf '  PASS  %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s\n' "$1"
        printf '        expected to find: %s\n' "$2"
        printf '        got: %s\n' "$(printf '%s' "$3" | head -3 | tr '\n' ' ')"
        fail=$((fail + 1))
    fi
}

# refused NAME OUTPUT - the call must have been stopped by the security layer.
refused() {
    if printf '%s' "$2" | grep -qE 'security\.onchain-allowlist|disabled by the security policy'; then
        printf '  PASS  %s\n' "$1"
        pass=$((pass + 1))
    else
        printf '  FAIL  %s\n' "$1"
        printf '        got: %s\n' "$(printf '%s' "$2" | head -3 | tr '\n' ' ')"
        fail=$((fail + 1))
    fi
}

# allowed NAME OUTPUT - the call must NOT have been stopped by it. Anything
# else that goes wrong (no funds, no channel) is a different question.
allowed() {
    if printf '%s' "$2" | grep -qE 'security\.onchain-allowlist|disabled by the security policy'; then
        printf '  FAIL  %s\n' "$1"
        printf '        blocked: %s\n' "$(printf '%s' "$2" | head -3 | tr '\n' ' ')"
        fail=$((fail + 1))
    else
        printf '  PASS  %s\n' "$1"
        pass=$((pass + 1))
    fi
}

say "Node under test"
M getinfo | grep -E '"version"|"identity_pubkey"'
echo
echo "  merchant address (allowed):  $MERCHANT_ADDRESS"
echo "  attacker address (blocked):  $ATTACKER"

say "1. On-chain destination allowlist"
report "the admin macaroon does grant onchain:write" "onchain" "$(M listpermissions | grep -A6 '"/lnrpc.Lightning/SendCoins"')"
allowed "sendcoins to the merchant address is permitted" "$(M sendcoins --addr="$MERCHANT_ADDRESS" --amt=20000 --sat_per_vbyte=1)"
refused "sendcoins to any other address is refused" "$(M sendcoins --addr="$ATTACKER" --amt=20000 --sat_per_vbyte=1)"
refused "sendmany with one bad output is refused" "$(M sendmany "{\"$MERCHANT_ADDRESS\":20000,\"$ATTACKER\":20000}")"
refused "a cooperative close to another address is refused" "$(M closechannel --funding_txid=0000000000000000000000000000000000000000000000000000000000000000 --output_index=0 --delivery_addr="$ATTACKER")"

say "2. Escape hatches that never name an address"
refused "funding a PSBT" "$(M wallet psbt fund --outputs="{\"$ATTACKER\":20000}")"
refused "publishing a raw transaction" "$(M wallet publishtx "$RAWTX")"
refused "signing a PSBT" "$(M wallet psbt sign cHNidP8BAAA=)"

say "3. RPCs disabled outright in [security]"
INVOICE=$(G addinvoice --amt=1000 | grep -o 'lnbcrt[a-z0-9]*' | head -1)
refused "paying a Lightning invoice" "$(M payinvoice --force --pay_req="$INVOICE")"
refused "baking a macaroon" "$(M bakemacaroon info:read)"

say "4. Still a working node"
allowed "creating an invoice" "$(M addinvoice --amt=1000)"
allowed "reading the wallet balance" "$(M walletbalance)"
allowed "a new on-chain address for change" "$(M newaddress p2wkh)"

say "Result"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
