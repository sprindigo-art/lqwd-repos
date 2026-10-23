# Demo: a BOLT 12 offer on a receive-only appliance

**Result: PASS, 10 checks.** The appliance published a BOLT 12 offer, answered
an invoice request for it over onion messages, and was paid. It then refused
to pay an offer itself — refused by the security layer, not by anything going
wrong.

Run on 2026-09-09 against the regtest testbed in [README.md](README.md), with
`lnd-merchant` standing in for the Raspberry Pi. Reproduce with
[../scripts/69-bolt12-demo.sh](../scripts/69-bolt12-demo.sh).

## What is being demonstrated

lnd v0.21 carries onion messages — it relays them, and delivers the ones
addressed to it — but has no offers RPC. The protocol itself is
[lndk](https://github.com/lndk-org/lndk), running beside lnd on both nodes.

Two things are being shown at once. The first is that BOLT 12 works here at
all, which was not a given: released lndk reads onion messages off lnd's
custom-message stream, and lnd v0.21 handles message 513 natively and no
longer puts them there. The second is that gaining a way to be paid did not
quietly give the device a way to pay.

Design notes, and why lndk is pinned to a branch:
[../docs/BOLT12.md](../docs/BOLT12.md).

## Cast

| Role in the product | In this test |
| --- | --- |
| Merchant appliance | `lnd-merchant` + `lndk-merchant`, gRPC on `127.0.0.1:7000` |
| LQWD gateway | `lnd-server` + `lndk-gateway`, gRPC on `127.0.0.1:7001` |
| A customer paying an offer | the gateway's lndk paying it |

## Transcript

```
=== 1. The transport underneath
  PASS  the merchant's lndk uses lnd's native onion messages
  PASS  the gateway's lndk does too

=== 2. The appliance publishes an offer
  lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcgqtp4qzsgv4ehqun9wdek...
  PASS  it is a BOLT 12 offer
  PASS  the gateway can decode it, and it is for 50000 msat
  PASS  carrying the description

=== 3. An invoice_request over onion messages, answered
  PASS  the appliance answered with an invoice

=== 4. The gateway pays the offer
  PASS  the payment succeeded
  merchant channel balance: 100261 -> 100312 sat
  PASS  the merchant received at least the offer amount
  PASS  and settled an invoice for it

=== 5. It still cannot pay one
  PASS  paying an offer is refused by the security policy

=== Result
  10 passed, 0 failed
```

## The checks that are not obvious

**"uses lnd's native onion messages."** This is the check that the whole
arrangement is even wired up. Released lndk v0.3.0 asks lnd for onion messages
on the custom-message stream, which requires `--protocol.custom-message=513`.
lnd v0.21 knows message 513 and its decoder says so: custom message overrides
may not replace types lnd already handles. A released lndk against lnd 0.21
therefore starts cleanly, logs nothing unusual, and never receives an invoice
request. The build is pinned to the upstream branch that uses
`SendOnionMessage`/`SubscribeOnionMessages` instead, and the test reads the
log line rather than trusting the pin:

```
INFO lndk - Using Native onion message transport for LND 0.21.3-beta.
```

**Step 3, separately from step 4.** Fetching an invoice is the round trip that
matters: an `invoice_request` goes out over an onion message, and the BOLT 12
invoice comes back over a blinded reply path. Checking it on its own means a
failure in step 4 is a payment failure and not a messaging one.

**"received at least the offer amount", not exactly.** The merchant received
51,100 msat for a 50,000 msat offer. The payer also pays the blinded path's
dummy hop, and a dummy hop is not a real node, so that fee arrives with the
recipient. See [../docs/BOLT12.md](../docs/BOLT12.md).

**"refused by the security policy."** The mirror image of the demo: the
gateway publishes an offer, the appliance fetches an invoice for it happily,
and then cannot pay it.

```
ERROR (ROUTE_FAILURE): Failed to route payment:
/routerrpc.Router/SendToRouteV2 is disabled by the security policy of this
node (security.disable-rpc)
```

lndk holds lnd's **admin** macaroon on this device — it needs signer, peer and
invoice access across three sub-servers, and the appliance cannot bake a
narrower credential because `BakeMacaroon` is disabled. The refusal above is
therefore the point: the [security layer](../security/README.md) sits under
the macaroon layer, so the admin macaroon does not lift it, and adding BOLT 12
did not reopen the spending path.

## What this does not show

- **Privacy.** The offer names the device. lnd builds blinded paths from the
  public channel graph, the appliance's channel is unannounced, so the only
  path it can build has itself as the introduction node. Hiding the recipient
  needs an announced hop in front of it. This is the largest gap and it is
  discussed in [../docs/BOLT12.md](../docs/BOLT12.md).
- **A real BOLT 12 wallet.** Both ends are lndk, on regtest, and the two nodes
  are each other's only peer.
- **Hardware.** The Raspberry Pi image contains the same lndk build and starts
  it the same way, and that image builds; but this ran on the software
  stand-in.

## Restarting

An offer survives a restart of lndk — it is derived from the node key rather
than stored — so the daemon answers an invoice request for an offer it issued
before a reboot. Checked by hand rather than in the script:

```sh
docker restart lnd-testbed-lndk-merchant
# then pay the offer created before the restart
Successfully paid for offer!
```

That matters for an appliance: a merchant's printed QR code does not stop
working because the device power-cycled.
