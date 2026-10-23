# Demo: paying a lightning address on a device with no inbound access

**Result: PASS, 17 checks.** A customer's wallet resolved
`merchant@pay.testbed.local`, was handed an invoice minted on the appliance,
paid it, and confirmed the settlement — all through a public URL served by the
gateway, while the appliance itself accepted no inbound connection from the
internet and listened on nothing but the VPN.

Run on 2026-09-09 against the regtest testbed in [README.md](README.md), with
`lnd-merchant` standing in for the Raspberry Pi. Reproduce with
[../scripts/68-lnurl-demo.sh](../scripts/68-lnurl-demo.sh).

## What is being demonstrated

LNURL-pay is a URL a stranger's phone fetches. The appliance cannot host one:
it accepts no inbound connection from the internet, and that is the property
the whole product rests on.

The way out is not to weaken it. The gateway already has a public name and a
certificate, and already reaches the device over the tunnel the **device**
dialled out to — the same path it uses to dial the device's p2p port and open
a channel. So the gateway owns the endpoint and proxies to `lnurlpd` on the
device, which binds the VPN address and nothing else.

Design notes and the specs implemented: [../docs/LNURL.md](../docs/LNURL.md).

## Cast

| Role in the product | In this test |
| --- | --- |
| Merchant appliance | `lnd-merchant` + `lnurlpd`, the same binaries the Pi image carries |
| LQWD gateway, public endpoint | `lnurl-gateway`, nginx with TLS for `pay.testbed.local` |
| A customer's wallet | `curl` from the gateway node's container, verifying the gateway's certificate |
| The customer's payment | `lnd-server` paying the invoice |

The one honest simplification: the gateway node is also the payer, because on
a private regtest there is nobody else. In the product the payer is a
stranger's phone and the gateway is only the last hop.

## Transcript

```
=== 0. What the merchant hands out
lightning address: merchant@pay.testbed.local
lnurl-pay URL:     https://pay.testbed.local/.well-known/lnurlp/merchant
LNURL (QR):        LNURL1DP68GURN8GHJ7URP0YH8GETNW33X2EPWD3HKXCTV9UH8WETVDSKKKMN0WAHZ7MRWW4EXCUP0D4JHYCMGV9H8GWZRFLX

=== 1. The appliance is listening on the VPN only
  PASS  nothing answers on loopback
  PASS  the VPN address does answer

=== 2. A wallet resolves merchant@pay.testbed.local
{
  "tag": "payRequest",
  "callback": "https://pay.testbed.local/lnurlp/merchant/callback",
  "minSendable": 1000,
  "maxSendable": 1000000000,
  "metadata": "[[\"text/plain\",\"Pay merchant@pay.testbed.local\"],[\"text/identifier\",\"merchant@pay.testbed.local\"]]",
  "commentAllowed": 140
}
  PASS  tag is payRequest
  PASS  the callback is the gateway's public URL, not the device's
  PASS  the metadata carries the lightning address

=== 3. The wallet asks for an invoice
  invoice: lnbcrt210n1p42zwwapp5e84gh3eqme8ww60uer6pvjskzu24794rmj9msqs...
  verify:  https://pay.testbed.local/lnurlp/merchant/verify/c9ea8bc720de4ee769fcc8f4164a1617155f16a3dc8bb8020e7be0698a7f16b0
  PASS  the invoice is for the amount asked for
  PASS  its description hash is sha256 of the metadata

=== 4. Before payment
  PASS  verify says it has not settled
  PASS  and gives out no preimage

=== 5. The customer pays it
  PASS  the payment succeeded

=== 6. After payment
  PASS  verify says it settled
  PASS  and now returns the preimage the payer got
  PASS  the merchant's channel balance grew by the payment

=== 7. What the endpoint refuses
  PASS  an amount below the minimum
  PASS  an amount above the maximum
  PASS  a recipient this device does not serve
  PASS  any path outside the LNURL surface

=== Result
  17 passed, 0 failed
```

## The checks that are not obvious

**"nothing answers on loopback."** Every container in this testbed shares one
network namespace, so `127.0.0.1` here is the same loopback lnurlpd would be
sitting on if it had been bound to `0.0.0.0` or left on its default. The
connection is refused, and the same request to `10.99.0.1:8090` returns 200 —
so the bind is genuinely restricted to the tunnel, not merely firewalled.

**"the callback is the gateway's public URL, not the device's."** The easiest
way to build this wrong is to let the daemon advertise its own address. A
wallet handed `http://10.99.0.10:8090/...` has nowhere to go with it. What the
device serves has to be the name the gateway answers on.

**"its description hash is sha256 of the metadata."** This is LUD-06's real
requirement and the one a hand-rolled implementation usually gets wrong. The
metadata string is hashed and the result must be the invoice's `h` tag, byte
for byte. A wallet that checks it — and they do — refuses the invoice
otherwise, with an error the merchant never sees. The test recomputes the hash
from the JSON the wallet was served and compares it with the decoded invoice,
rather than trusting the daemon to agree with itself.

**"and gives out no preimage."** This one was a bug, found by running it. lnd
returns an invoice's preimage whatever its state — it generated the preimage,
so it knows it long before anyone pays — and the verify endpoint was passing
it straight through. That publishes the proof of payment for a payment nobody
has made. It is now gated on the invoice's state, and the fake lnd in the unit
tests returns a preimage for an open invoice so the test would catch it again.

**"any path outside the LNURL surface."** The gateway proxies the two LNURL
routes and 404s everything else, so an endpoint added to the daemon later does
not become public by accident. `/healthz` exists on the device and is not
reachable through the gateway.

## What this does not show

- **Route hints.** The invoice carries none, because lnd only turns an
  unannounced channel into a hop hint when the peer at the other end is a
  public node, and in this testbed neither node is. The payment works because
  the payer is the direct peer. In the product the gateway is a public routing
  node and the hints appear — this testbed cannot check that.
- **A real wallet.** The customer is `curl` following LUD-06 and LUD-16 by
  hand. No phone has scanned this QR code.
- **A hostile gateway.** It terminates TLS, so it sees everything passing
  through. A wallet checking the description hash catches a swapped invoice;
  nothing here catches a gateway that declines to forward at all.
