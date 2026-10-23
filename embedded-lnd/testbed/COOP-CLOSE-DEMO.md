# Demo: settling a merchant's Lightning balance straight to their own Bitcoin wallet

**Result: PASS.** A cooperative channel close paid the merchant's entire channel
balance directly to an address they control, in the closing transaction itself.
No withdrawal transaction, no second on-chain fee, and the device never had the
opportunity to send it anywhere else.

Run on 2026-09-07 against the regtest testbed described in
[README.md](README.md), with the Raspberry Pi 4 running the image from this
repository.

## What is being demonstrated

The idea in [../idea.md](../idea.md) depends on one specific Lightning feature:
**`option_upfront_shutdown_script`**. When a channel is opened, each side may
commit to the exact on-chain script its balance must be paid to on cooperative
close. That commitment is part of the channel and is enforced by the protocol.

For the merchant appliance this means:

- The merchant gives us a receive address from their own hardware wallet at
  setup time.
- The device commits to it when the channel opens.
- When the channel is eventually closed, the merchant's balance lands in their
  own custody in the closing transaction.
- Even if the device were fully compromised afterwards, it cannot redirect that
  balance. The address is fixed in the channel, not chosen at close time.

lnd exposes this as two settings in `[Application Options]`:

```
enable-upfront-shutdown=true
upfront-shutdown-address=<merchant address>
```

They apply to **channels opened after the option is set**, including channels
the device merely *accepts* — which is the case here, since the gateway is
always the channel opener.

## Cast

| Role in the product | In this test |
| --- | --- |
| Merchant hardware wallet | a separate `merchant` wallet in the regtest bitcoind |
| Merchant appliance | Raspberry Pi 4, `10.99.0.10`, image from this repo |
| LQWD node / payment gateway | `lnd-testbed-node` container, `10.99.0.1` |
| Customers paying invoices | the gateway paying the merchant's invoices |

Merchant address used throughout:

```
bcrt1q69xmkz08062v59psqj4m2tqg30cyn2yycnt40g
```

## Phase 0 — starting state

```
merchant hardware wallet   0.00000000 BTC
Pi on-chain wallet         0 sat
existing channel           local 871530 / remote 125000, close_address ""
```

The pre-existing channel was opened **before** the option was set, so it
carries no close address. That is deliberate — it gives the contrast in phase 1.

## Phase 1 — closing a channel WITHOUT upfront shutdown (the problem)

```sh
lncli closechannel --funding_txid=076f82de... --output_index=0
```

```
Channel close transaction broadcasted: 94f59f55652978b83406285327bccda62b3d0e97e1669756b962b43208db1d4a
```

After 6 blocks:

```
Pi on-chain wallet         125000 sat      <-- funds landed ON THE DEVICE
merchant hardware wallet   0.00000000 BTC  <-- still empty
```

This is the behaviour we are replacing. The merchant's money is now sitting in
a hot wallet on an appliance in their shop, and getting it into their custody
needs a **second on-chain transaction** that someone has to authorise.

## Phase 2 — configure the merchant's close address

Added to `/etc/lnd/lnd.conf` on the Pi, in `[Application Options]`:

```
enable-upfront-shutdown=true
upfront-shutdown-address=bcrt1q69xmkz08062v59psqj4m2tqg30cyn2yycnt40g
```

```sh
/etc/init.d/lnd restart
lncli unlock --stdin < /data/lnd/wallet-password
```

```
Stopping lnd: done.
Starting lnd: done.
lnd successfully unlocked!
```

## Phase 3 — gateway opens a channel; the device commits the address

```sh
lncli connect 03a4d940...@10.99.0.10:9735
lncli openchannel --node_key=03a4d940... --local_amt=1000000 --push_amt=200000
```

```
{ "funding_txid": "c8b331a4112f4cf3f9c386585bcd4132316ca55efee99e082dc0784378fc61ec" }
```

Once confirmed, the **merchant side** shows the commitment:

```json
{
  "channel_point":  "c8b331a4112f4cf3f9c386585bcd4132316ca55efee99e082dc0784378fc61ec:0",
  "active":         true,
  "local_balance":  "200000",
  "remote_balance": "796530",
  "close_address":  "bcrt1q69xmkz08062v59psqj4m2tqg30cyn2yycnt40g"
}
```

The gateway side shows `close_address: ""` — it made no such commitment, which
is correct. The commitment is the merchant's, about the merchant's own funds.

The `push_amt` stands in for pre-purchased inbound liquidity.

## Phase 4 — the merchant takes payments

Two invoices raised on the Pi and paid by the gateway:

| Sale | Result |
| --- | --- |
| 30,000 sat | `SUCCEEDED, preimage: 60485247d2720671080869a0a7fcd05f853499bcf12685687b4cb9610ad7aefb` |
| 45,000 sat | `SUCCEEDED, preimage: c390956203859aacf12ba9d42082aa2f263deb9a2aed4a223063cfd5a6494f14` |

```
merchant channel balance   275000 sat   (200000 pushed + 75000 in sales)
gateway channel balance    721530 sat
```

## Phase 5 — cooperative close

Initiated by the **gateway**, not the device — matching the product flow where
the merchant asks us to settle:

```sh
lncli closechannel --funding_txid=c8b331a4... --output_index=0
```

```
Channel close transaction broadcasted: 0a6c645dd8f1042daa7880580fe1a6ec06a9afe22f702d91a5ca6de164af919f
```

## Phase 6 — settlement verified

The closing transaction's outputs:

```json
{"value": 0.00275000, "addr": "bcrt1q69xmkz08062v59psqj4m2tqg30cyn2yycnt40g"}
{"value": 0.00720475, "addr": "bcrt1p7kg7rdkevasxrjrmffm9gvfe8ypna5g9sxnuf2gd0d404tuy5lpqct594m"}
```

The first output is the merchant's balance, paid to their own address **in the
close itself**. The second is the gateway's balance, less the closing fee.

Merchant wallet:

```json
{
  "txid":          "0a6c645dd8f1042daa7880580fe1a6ec06a9afe22f702d91a5ca6de164af919f",
  "amount":        0.00275,
  "address":       "bcrt1q69xmkz08062v59psqj4m2tqg30cyn2yycnt40g",
  "confirmations": 6
}

balance: 0.00275000 BTC
```

The device's own wallet did **not** receive it:

```
Pi on-chain wallet    125000 sat    <-- unchanged; this is phase 1's money
Pi channels           []
```

Both closes recorded on the device:

```
channel_point 076f82de...:0   settled_balance 125000   COOPERATIVE_CLOSE   -> device wallet
channel_point c8b331a4...:0   settled_balance 275000   COOPERATIVE_CLOSE   -> merchant wallet
```

## Verdict

| Check | Expected | Actual | |
| --- | --- | --- | --- |
| Merchant address committed at channel open | `close_address` set on the merchant side | `bcrt1q69xmk...` | PASS |
| Gateway makes no competing commitment | `close_address` empty | empty | PASS |
| Lightning payments settle to the merchant | 2 invoices paid | both `SUCCEEDED` | PASS |
| Balance settles on close | 275,000 sat to merchant address | 0.00275 BTC, 1 output | PASS |
| No separate withdrawal transaction | 1 on-chain tx total | the close tx only | PASS |
| Device cannot keep the funds | device wallet unchanged | still 125,000 from phase 1 | PASS |

## Caveats and what this does not yet prove

Being honest about the gap between this and a shippable product:

1. **Regtest, and the "hardware wallet" is a bitcoind wallet.** The mechanism is
   protocol-level and identical on mainnet, but this has not been run against a
   real signing device.
2. **The address was set by hand on a running device.** In the product it has to
   be provisioned at manufacture or first boot, and the config baked in. The
   repo's `lnd.conf` currently carries it commented out.
3. **One address, forever.** `upfront-shutdown-address` is a single static
   address, so every channel closes to the same output. That is a privacy
   weakness — an observer can link all of a merchant's closes. Per-channel
   addresses need `openchannel --close_address` (gateway side) or a channel
   acceptor on the device.
4. **A stated caveat from lnd:** if the option is set and a peer does not
   advertise `option_upfront_shutdown_script`, the channel open **fails**. Our
   gateway is lnd and does advertise it, so this is fine here, but it means the
   device cannot open channels to arbitrary peers once configured.
5. **Force close is not covered.** Upfront shutdown governs the *cooperative*
   close. A force close pays out through the commitment transaction to a
   key the device holds, not to the merchant address. Anything unilateral still
   lands on the device and needs a sweep.
6. **Losing the address is unrecoverable by the merchant alone.** If they lose
   their hardware wallet, the committed script cannot be changed for existing
   channels; those channels must be force-closed.

Point 5 is the one worth designing around: it means "the merchant never needs a
withdrawal" holds for the happy path, but not if a channel has to be forced.

## Reproducing

```sh
# on the build server
docker exec lnd-testbed-bitcoind bitcoin-cli -conf=/data/bitcoind/bitcoin.conf \
    -datadir=/data/bitcoind createwallet merchant
docker exec lnd-testbed-bitcoind bitcoin-cli -conf=/data/bitcoind/bitcoin.conf \
    -datadir=/data/bitcoind -rpcwallet=merchant getnewaddress "hardware-wallet" bech32

# on the Pi: add to [Application Options] in /etc/lnd/lnd.conf
#   enable-upfront-shutdown=true
#   upfront-shutdown-address=<that address>
/etc/init.d/lnd restart
lncli --lnddir=/data/lnd --network=regtest unlock --stdin < /data/lnd/wallet-password

# gateway opens, pays, and closes; mine with ./scripts/65-mine.sh 6 between steps
```
