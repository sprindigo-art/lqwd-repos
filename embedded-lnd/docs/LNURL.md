# LNURL-pay on the appliance

The merchant gets a lightning address — `merchant@pay.example.com` — and a QR
code. A customer scans it, their wallet fetches a payment request, asks for an
invoice for the amount they choose, and pays it. The invoice is minted on the
device, by the device.

Demonstrated end to end: [../testbed/LNURL-DEMO.md](../testbed/LNURL-DEMO.md).

## The constraint that shapes all of this

LNURL-pay is a URL a stranger's phone has to fetch. The appliance accepts no
inbound connection from the internet — that is the point of it — so it cannot
host that URL.

The gateway can. It already has a public name and a certificate, and it
already reaches the device over the tunnel the **device** dialled out to. So
it owns the endpoint and proxies to the device:

```
customer's wallet
      │  https://pay.example.com/.well-known/lnurlp/merchant
      v
  gateway (nginx)          public name, TLS, one vhost per merchant
      │  http, over the management VPN
      │  ── a connection the DEVICE made possible by dialling out ──
      v
  lnurlpd  10.99.0.10:8090   binds tun0 only, firewalled to 10.99.0.0/24
      │  https, loopback
      v
  lnd REST 127.0.0.1:8080    invoice macaroon
```

Nothing on the internet reaches the device. The gateway reaches it exactly the
way it already does to dial its p2p port and open a channel.

The consequence to keep in mind: **the callback URL lnurlpd advertises is the
gateway's, not its own**. `-base-url` is the public name, and a wallet that
was handed `10.99.0.10:8090` would have nowhere to go with it.

## What it implements

[lnurlpd](../lnurlpd/) is about 400 lines of Go with no dependencies outside
the standard library — no protobuf, no generated stubs, nothing to audit but
itself.

| Spec | What it means here |
| --- | --- |
| LUD-06 | `payRequest`: the amount range, the metadata, the callback |
| LUD-16 | lightning addresses, `/.well-known/lnurlp/<name>` |
| LUD-12 | an optional comment, which becomes the invoice memo |
| LUD-21 | `verify`: did this invoice settle, for whoever holds the payment hash |
| LUD-01 | the bech32 `LNURL1…` string, for a QR code that predates addresses |

The description hash is the part worth naming explicitly. LUD-06 requires the
invoice's `h` tag to be the sha256 of the metadata string, byte for byte, and
a wallet that checks it will refuse an invoice that does not match. It is
computed once at startup and passed to lnd with every invoice; the test
recomputes it independently from what the wallet was served.

## The credential

lnurlpd uses lnd's **invoice** macaroon, not the admin one, and gets a copy of
it and of lnd's certificate — the two files it needs — under its own user, so
it cannot read lnd's directory at all
([lnurlpd-run](../meta-embedded-lnd/recipes-lnd/lnurlpd/files/lnurlpd-run)).

This matters more here than anywhere else on the device: lnurlpd is the one
process on the appliance that anything outside ever reaches. If it is taken
over completely, what the attacker has is the ability to mint invoices and
read them back. There is no path from there to the money.

## Provisioning

The public endpoint is per-merchant, so it is provisioning input rather than
configuration, and it lives beside the settlement address in
`/vm/testbed/secrets/merchant.env`:

```
MERCHANT_ADDRESS=bcrt1q…      where the channel closes to
LNURL_BASE_URL=https://pay.testbed.local
LNURL_NAME=merchant
```

[64-provision-merchant.sh](../scripts/64-provision-merchant.sh) writes it, the
recipe substitutes it into `/etc/default/lnurlpd` at bake time, and the
testbed container reads the same file. One value, both consumers.

The device will print its own QR payload:

```sh
lnurlpd -print-lnurl -base-url=https://pay.testbed.local -name=merchant
```

```
lightning address: merchant@pay.testbed.local
lnurl-pay URL:     https://pay.testbed.local/.well-known/lnurlp/merchant
LNURL (QR):        LNURL1DP68GURN8GHJ7URP0YH8GETNW33X2EPWD3HKXCTV9UH8WETVDSK…
```

## What is not solved

1. **Route hints need a public gateway.** Invoices are requested with
   `private=true`, but lnd only turns an unannounced channel into a hop hint
   if the peer on the other end is a public node. In the testbed neither node
   is, so the invoices carry no hints and only the direct peer can pay them.
   In the product the gateway is a public routing node and the hints appear —
   but that is an assumption this testbed cannot check.
2. **The gateway must not be able to mint invoices, and nothing enforces
   that.** It proxies; it does not hold a credential for the device. But it
   terminates TLS, so it sees and could alter what passes through. A wallet
   checking the description hash detects a swapped invoice; nothing detects a
   gateway that simply declines to forward.
3. **No per-payment metadata.** Every invoice for a merchant carries the same
   description, so the merchant's own records are `lncli listinvoices` plus
   whatever comment the payer typed.
4. **The rate limit is one global bucket**, not per payer: every request
   arrives from the proxy, so per-IP counting would be counting the proxy. It
   protects the device's invoice database, and it is not a defence against a
   hostile gateway.
5. **TLS stops at the gateway.** The device is reached over the VPN in plain
   HTTP. That is a deliberate trade — the tunnel is already authenticated and
   encrypted, and a certificate on the device would need a public name — but
   it does mean the VPN is load-bearing for payment integrity.
