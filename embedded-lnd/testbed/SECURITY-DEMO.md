# Demo: an appliance that can only ever pay one address

**Result: PASS.** Holding the node's admin macaroon — the credential that
grants everything lnd has to give — every attempt to move money anywhere other
than the merchant's own address was refused, including the routes that avoid
naming an address at all. The channel then closed cooperatively and paid the
merchant's balance to that same address.

Run on 2026-09-08 against the regtest testbed in [README.md](README.md), using
`lnd-merchant`: the same binary and the same policy the Raspberry Pi image
ships with. See [../security/README.md](../security/README.md) for the design.

## What is being demonstrated

[COOP-CLOSE-DEMO.md](COOP-CLOSE-DEMO.md) showed that `option_upfront_shutdown_script`
fixes where a channel settles. It leaves a gap, and the gap is the whole
motivation here:

> Upfront shutdown protects the *destination*, not the balance in flight.
> — [../idea.md](../idea.md)

A device that is compromised after the channel opens still holds a funded
on-chain wallet and an admin macaroon. It can send those coins anywhere, and
it can spend the channel balance over Lightning before anyone closes anything.
Macaroons do not help: the admin macaroon is *on the device*, and anything a
macaroon grants, a macaroon can be baked to grant again.

So the node is patched with a policy that sits underneath the macaroon layer:
one allowlisted on-chain destination, and a list of RPCs that are simply gone.
This is that policy being attacked with full credentials.

## Cast

| Role in the product | In this test |
| --- | --- |
| Merchant hardware wallet | the `merchant` wallet in the regtest bitcoind |
| Merchant appliance | `lnd-merchant`, the container stand-in for the Pi |
| LQWD node / payment gateway | `lnd-testbed-node` |
| Somewhere a thief would send the money | an address from the `miner` wallet |

```
merchant address (allowed)   bcrt1qvrn0n5a8ze3ve6lqm2gaqdtk3ch8dfpspv8r90
attacker address (blocked)   bcrt1qrqzchv9mk2gy6n53n0062gayjdf9u2cke27s09
```

The merchant address is not typed anywhere by hand. `64-provision-merchant.sh`
mints it and writes `secrets/merchant.env`; from there it becomes both the
cooperative-close destination and the sole allowlist entry, on the container
here and in `/etc/lnd/lnd.conf` on the Pi.

## Phase 0 — the node under test

```sh
lncli getinfo
```

```
"version": "0.21.3-beta commit=v0.21.3-beta+lqwd-hardened",
"identity_pubkey": "027cecb742fcb0bdea04966ee82f65676b6e5e2f1bd08b8710221b89f12291619f",
```

The `+lqwd-hardened` suffix is baked in by the build, so a device can be asked
whether it is running the patched lnd.

What it says about itself at startup:

```
[INF] LTND: Security policy: on-chain destinations:
  bcrt1qvrn0n5a8ze3ve6lqm2gaqdtk3ch8dfpspv8r90; disabled RPCs:
  /lnrpc.Lightning/BakeMacaroon, /lnrpc.Lightning/FundingStateStep,
  /lnrpc.Lightning/RegisterRPCMiddleware, /routerrpc.Router/SendPaymentV2,
  /routerrpc.Router/SendToRouteV2, /signrpc.Signer/ComputeInputScript,
  /signrpc.Signer/MuSig2CombineSig, /signrpc.Signer/MuSig2CreateSession,
  /signrpc.Signer/MuSig2RegisterNonces, /signrpc.Signer/MuSig2Sign,
  /signrpc.Signer/SignOutputRaw, /walletrpc.WalletKit/FinalizePsbt,
  /walletrpc.WalletKit/FundPsbt, /walletrpc.WalletKit/PublishTransaction,
  /walletrpc.WalletKit/SignPsbt, /walletrpc.WalletKit/SubmitPackage
```

Four of those came from `[security]` in the config. The other twelve were added
because an allowlist is in force and those RPCs can move funds without ever
naming a destination — see [../security/README.md](../security/README.md#the-escape-hatches).

The node was funded with 1 BTC on-chain, so every attempt below had coins to
steal.

## Phase 1 — the credential is not the problem

```sh
lncli listpermissions | grep -A6 '"/lnrpc.Lightning/SendCoins"'
```

```json
"/lnrpc.Lightning/SendCoins": {
    "permissions": [ { "entity": "onchain", "action": "write" } ]
}
```

The macaroon in use grants `onchain:write`. Every rejection that follows
happens with that permission granted.

## Phase 2 — on-chain sends

Paying the merchant works:

```sh
lncli sendcoins --addr=bcrt1qvrn0n5a8ze3ve6lqm2gaqdtk3ch8dfpspv8r90 --amt=25000 --sat_per_vbyte=1
```

```json
{ "txid": "c07831c48962049c1ca7ab93d1cb4c5167fe2fc332587150b7851f8de6959c6e" }
```

Paying anyone else does not:

```sh
lncli sendcoins --addr=bcrt1qrqzchv9mk2gy6n53n0062gayjdf9u2cke27s09 --amt=25000 --sat_per_vbyte=1
```

```
[lncli] rpc error: code = PermissionDenied desc = /lnrpc.Lightning/SendCoins:
destination address bcrt1qrqzchv9mk2gy6n53n0062gayjdf9u2cke27s09 is not in
security.onchain-allowlist (bcrt1qvrn0n5a8ze3ve6lqm2gaqdtk3ch8dfpspv8r90)
```

Nor does hiding a bad output among good ones — `sendmany` with both addresses
is refused, not partially executed.

And a cooperative close cannot be redirected either, which is the same
protection upfront shutdown gives, one layer higher:

```sh
lncli closechannel --funding_txid=0000...0000 --output_index=0 \
      --delivery_addr=bcrt1qrqzchv9mk2gy6n53n0062gayjdf9u2cke27s09
```

```
[lncli] rpc error: code = PermissionDenied desc = /lnrpc.Lightning/CloseChannel:
delivery address bcrt1qrqzchv9mk2gy6n53n0062gayjdf9u2cke27s09 is not in
security.onchain-allowlist (bcrt1qvrn0n5a8ze3ve6lqm2gaqdtk3ch8dfpspv8r90)
```

## Phase 3 — the ways around an allowlist

An allowlist that only inspects addresses is worth nothing if you can build the
transaction yourself. Those routes are closed:

```sh
lncli wallet psbt fund --outputs='{"bcrt1qrqzchv9...":25000}'
```

```
[lncli] rpc error: code = PermissionDenied desc = /walletrpc.WalletKit/FundPsbt
is disabled by the security policy of this node (security.disable-rpc)
```

Same for `wallet psbt sign` and `wallet publishtx` — a raw transaction paying
the attacker, well formed and ready to broadcast, has nowhere to go.

## Phase 4 — the RPCs the appliance has no business having

A payment terminal receives; it does not spend over Lightning. The gateway
issued an invoice and the appliance was told to pay it:

```sh
lncli payinvoice --force --pay_req=lnbcrt10n1...
```

```
[lncli] rpc error: code = PermissionDenied desc = /routerrpc.Router/SendPaymentV2
is disabled by the security policy of this node (security.disable-rpc)
```

Nor can it mint itself new credentials to get around any of the above:

```sh
lncli bakemacaroon info:read
```

```
[lncli] rpc error: code = PermissionDenied desc = /lnrpc.Lightning/BakeMacaroon
is disabled by the security policy of this node (security.disable-rpc)
```

## Phase 5 — still a working payment terminal

Creating invoices, reading balances and generating change addresses are
untouched. `./scripts/66-security-demo.sh` checks all of the above in one go:

```
=== 1. On-chain destination allowlist
  PASS  the admin macaroon does grant onchain:write
  PASS  sendcoins to the merchant address is permitted
  PASS  sendcoins to any other address is refused
  PASS  sendmany with one bad output is refused
  PASS  a cooperative close to another address is refused

=== 2. Escape hatches that never name an address
  PASS  funding a PSBT
  PASS  publishing a raw transaction
  PASS  signing a PSBT

=== 3. RPCs disabled outright in [security]
  PASS  paying a Lightning invoice
  PASS  baking a macaroon

=== 4. Still a working node
  PASS  creating an invoice
  PASS  reading the wallet balance
  PASS  a new on-chain address for change

=== Result
  13 passed, 0 failed
```

## Phase 6 — and the money still settles

The gateway opened a channel, pushing 275,000 sat to the merchant:

```sh
lncli openchannel --node_key=027cecb742... --local_amt=1000000 --push_amt=275000
```

The appliance committed to the address at open, as before:

```json
"channel_point": "36ab2d364472a1b3e02c8d191c9f41d5034e6dcc9fe09517bc439fa8fec9f373:0",
"local_balance": "275000",
"close_address": "bcrt1qvrn0n5a8ze3ve6lqm2gaqdtk3ch8dfpspv8r90",
```

Then the **appliance itself** closed the channel, naming no destination — the
only close it is able to ask for:

```sh
lncli closechannel --funding_txid=36ab2d36... --output_index=0
```

```
Channel close transaction broadcasted: c37fd6fc65a5e398954409d7b4040078460801a9a601926c87e0711398446c8b
```

Six blocks later, in the merchant's own wallet:

```json
{ "address": "bcrt1qvrn0n5a8ze3ve6lqm2gaqdtk3ch8dfpspv8r90",
  "category": "receive", "amount": 0.00275000, "confirmations": 6 }
```

Balance `0.00595000` BTC: the 275,000 sat channel balance from the close, plus
the on-chain sends from phase 2 — which also landed in the merchant's custody,
because that is the only place they can land.

## What this does not prove

- **A force close still bypasses all of it.** Unchanged from
  [COOP-CLOSE-DEMO.md](COOP-CLOSE-DEMO.md): a unilateral close pays out through
  the commitment transaction to keys on the device, swept by lnd internally
  with no RPC involved. Item 1 of the open problems in [../idea.md](../idea.md).
- **The binary is still replaceable.** Everything here is enforced by the lnd
  on the device. Whoever can write to the OS partition can install one without
  the patch. Secure boot and a signed image are stage 5 of
  [../docs/PLAN.md](../docs/PLAN.md); until then this raises the cost of an
  attack from "use the admin macaroon" to "reflash the device".
- **This is regtest, and the container is not the Pi.** Same binary, same
  config, but the hardware test is [COOP-CLOSE-DEMO.md](COOP-CLOSE-DEMO.md)
  and the equivalent run on the appliance is still to do.

## Reproducing it

```sh
./scripts/64-provision-merchant.sh           # mint the address, start the node
./scripts/62-init-server-wallet.sh merchant  # one-time wallet creation
./scripts/63-fund-server-lnd.sh 1 merchant   # coins for it to try to move
./scripts/66-security-demo.sh
```
