# BOLT 12 on the appliance

The appliance publishes a BOLT 12 **offer** — a reusable payment code, `lno1…`
— answers invoice requests for it over onion messages, and is paid. It cannot
pay one, which is the same rule the rest of the device follows.

Demonstrated end to end: [../testbed/BOLT12-DEMO.md](../testbed/BOLT12-DEMO.md).

## Why there is a second daemon

lnd v0.21 speaks onion messages. It relays them for other nodes, and delivers
the ones addressed to it over two new RPCs, `SendOnionMessage` and
`SubscribeOnionMessages`. That is the transport BOLT 12 rides on, and it is
all lnd has: there is no offers RPC, no `lncli` command that makes an offer,
nothing that builds an `invoice_request` or answers one.

So the protocol itself lives in [lndk](https://github.com/lndk-org/lndk),
running beside lnd:

```
   lndk-cli  ──gRPC──>  lndk            the offer, the invoice_request,
                          │             the BOLT 12 invoice
                          │ gRPC
                          v
                        lnd             onion messages on the wire,
                                        the signing key, the channels,
                                        the HTLC
```

lndk borrows lnd's node key through `signrpc` for the ECDH that onion messages
need, asks lnd to send them, and subscribes to the ones that arrive. It is not
a second node and holds no funds.

## The transport, and why lndk is pinned to a branch

Released lndk (v0.3.0) reads incoming onion messages off lnd's **custom
message** stream, which requires `--protocol.custom-message=513` — message
type 513 tunnelled through an API meant for messages lnd does not know.

lnd v0.21 knows message 513. Its decoder has a case for it, and the comment
above the fallback says so plainly: custom message overrides may not replace
message types lnd already handles. Incoming onion messages therefore go to
lnd's own onion message handling and are never seen on the custom message
stream, so a released lndk against lnd 0.21 connects, starts, logs nothing
unusual, and never receives a single invoice request.

`scripts/env.sh` therefore pins lndk to the upstream branch that adds the
native transport ([lndk#266](https://github.com/lndk-org/lndk/pull/266)),
which picks its transport from lnd's version. Move it to a release tag once
that merges. The demo checks the log line rather than trusting the pin:

```
INFO lndk - Using Native onion message transport for LND 0.21.3-beta.
```

The old flags must **not** be set on lnd v0.21: it advertises the onion
message feature bit (39) itself and refuses to start if you also ask for it
with `--protocol.custom-init=39`.

## What lnd needs in its configuration

Both in the image's [lnd.conf](../meta-embedded-lnd/recipes-lnd/lnd/files/lnd.conf)
and in the testbed's:

```ini
[protocol]
protocol.onion-msg-relay-all=true

[routing]
routing.blinding.min-num-real-hops=0
routing.blinding.num-hops=1
```

**`onion-msg-relay-all`.** By default lnd admits onion messages only from
peers it holds an open channel with. The introduction node of a blinded reply
path need not be one of those, so BOLT 12 needs the wider ingress. On this
device that widening is bounded by the firewall: the only peer that can reach
it at all is the gateway, over the tunnel.

**The blinding options are not optional, and the reason is worth
understanding.** A BOLT 12 invoice says where to pay with a *blinded path*,
and lnd builds those out of the **public channel graph**. The appliance's
channel is unannounced, so there is no route to itself to build one from, and
invoice creation fails outright:

```
Error creating invoice: Failed to add invoice to lnd node:
could not find any routes to self to use for blinded route construction
```

`min-num-real-hops=0` makes the device its own introduction node, which is the
only thing an unannounced node can be. `num-hops=1` pads the path with one
dummy hop so its length alone does not announce that the introduction node is
also the destination.

### The privacy cost, stated plainly

An offer built this way **names the device's node id**. BOLT 12's blinded
paths normally hide the recipient behind an introduction node; here the
recipient *is* the introduction node.

Hiding it needs a real hop in front — the gateway — and lnd will only build
one from an announced channel. That is a genuine trade-off between the
appliance being unannounced and its offers being private, and it is not
resolved in this POC.

### Why the merchant receives slightly more than the offer

The payer also pays the blinded path's dummy hop, and a dummy hop is not a
real node, so that fee arrives with the recipient. A 50,000 msat offer settles
an invoice for about 51,100 msat. The demo checks for "at least the offer
amount" rather than equality for this reason.

## Receiving, but not paying

lndk runs as the `lnd` user and uses lnd's **admin** macaroon. It needs
signer, peer and invoice access across three sub-servers, and this device
cannot bake a narrower credential — `BakeMacaroon` is one of the RPCs the
security layer disables. Isolating lndk from lnd's data directory while
handing it the admin macaroon would be theatre.

What bounds it is what bounds every other caller on this device: the
[security layer](../security/README.md) sits under the macaroon layer, so the
admin macaroon does not lift it. Paying an offer ends in `SendToRouteV2`, and
that is on the deny list:

```
$ lndk-cli pay-offer lno1...
ERROR (ROUTE_FAILURE): Failed to route payment:
/routerrpc.Router/SendToRouteV2 is disabled by the security policy of this
node (security.disable-rpc)
```

So BOLT 12 does not quietly reopen the spending path the security layer
closed. A receive-only terminal gains a way to be paid and no way to pay.

## Using it on the device

lndk's gRPC server is on `127.0.0.1:7000` and is deliberately not in the
firewall — reach it over SSH, the same way `lncli` is used. It authenticates
callers with lnd's macaroon and its own TLS certificate, both of which are
already on the device:

```sh
M=/data/lnd/data/chain/bitcoin/regtest/admin.macaroon

# A reusable payment code for 50,000 msat.
lndk-cli --macaroon-path=$M --cert-path=/data/lndk/tls-cert.pem \
    create-offer --amount 50000 --description "espresso"

lndk-cli --macaroon-path=$M --cert-path=/data/lndk/tls-cert.pem \
    decode-offer lno1...
```

The service waits for lnd rather than failing when it is not ready. This
device does not auto-unlock, so after a reboot lndk sits waiting until someone
runs `lncli unlock`, then starts on its own
([lndk-run](../meta-embedded-lnd/recipes-lnd/lndk/files/lndk-run)).

An offer survives a restart of lndk: it is derived from the node key rather
than stored, so the daemon can answer an invoice request for an offer it
issued before the reboot. Tested, not assumed.

## What is not solved

1. **The offer names the device.** See the privacy cost above. This is the
   biggest gap, and closing it means an announced hop in front.
2. **lndk is pinned to an unmerged branch.** Justified — the released version
   cannot receive anything against lnd 0.21 — but it is a fork of a third
   party's fork until the PR lands, and the pin is a commit hash rather than a
   signed tag.
3. **Only exercised on regtest**, between two nodes that are each other's only
   peer. Nothing here has met a real BOLT 12 wallet.
4. **No offer management.** There is no record on the device of which offers
   were issued or what was paid against which one; `lncli listinvoices` shows
   the settlements without saying which offer they came from.
5. **lndk is not static.** Unlike lnd and lnurlpd it links glibc, so a libc
   CVE reaches it. The image already carries glibc for dropbear, openvpn and
   iptables, so this adds no package — but it is one more consumer.
