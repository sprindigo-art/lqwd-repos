# Idea: a plug-and-play Lightning payment appliance for merchants

## The idea

We can build a hardened plug-and-play Lightning payment device where the
merchant does not need to manage LND or allow any inbound Internet access. The
device runs our minimal signed OS and LND and only establishes the required
outbound connections. Because our LQWD node/payment gateway is part of the
payment flow, the gateway can detect and verify successful payments from our end
without needing administrative access to the merchant's device. During setup,
the merchant provides an address from their hardware wallet as the cooperative-
close destination, so when the channel is eventually closed, their final balance
can settle directly to their hardware wallet without a separate withdrawal
transaction. This gives us a secure IoT-style payment appliance: plug it in,
receive and independently verify Lightning payments, and ultimately settle the
funds into the merchant's own Bitcoin custody.

The user experience can be very simple: we get their hardware-wallet Bitcoin
address, ship them a device with just power and LAN, and provide the inbound
liquidity. Our payment gateway verifies payments from our side and gives them a
dashboard showing what they've received. When they want to settle, we
cooperatively close the channel and their balance goes directly to their
hardware wallet.

## Status in this repository

| Piece of the idea | Where it stands |
| --- | --- |
| Minimal OS running lnd | Built and booting on RPi 4. 131 packages outside the kernel modules, BusyBox + sysvinit, no package manager, no compilers. [docs/HARDENING.md](docs/HARDENING.md) |
| No inbound Internet access | Default-deny firewall; only outbound is initiated. [meta-embedded-lnd/recipes-networking/firewall/](meta-embedded-lnd/recipes-networking/firewall/) |
| Outbound-only connectivity to us | OpenVPN client dials out; the device is reachable to us over the tunnel without being exposed to the Internet. [testbed/README.md](testbed/README.md) |
| Settle to the merchant's own wallet | **Demonstrated end to end** — [testbed/COOP-CLOSE-DEMO.md](testbed/COOP-CLOSE-DEMO.md) |
| Device cannot pay anywhere else | **Demonstrated end to end** — lnd patched with a one-entry destination allowlist and an RPC deny list, enforced under the macaroon layer. [security/](security/), [testbed/SECURITY-DEMO.md](testbed/SECURITY-DEMO.md) |
| A payment request a customer can actually scan | **Demonstrated end to end** — a lightning address and an LNURL QR, served publicly by the gateway and answered by the device over the tunnel. [testbed/LNURL-DEMO.md](testbed/LNURL-DEMO.md) |
| BOLT 12 offers | **Demonstrated end to end** — the device publishes a reusable offer and is paid through it, and still cannot pay one. [testbed/BOLT12-DEMO.md](testbed/BOLT12-DEMO.md) |
| Gateway-side payment verification | Partly. The device serves LUD-21 `verify`, so the gateway can confirm a settlement by payment hash without holding a credential on it. The stronger version — the gateway knowing from its own forwarding records — is not built. See below. |
| Signed OS | Not built. Stage 5 in [docs/PLAN.md](docs/PLAN.md). |
| Merchant dashboard | Not built. |

## How the settlement part actually works

The mechanism is Lightning's `option_upfront_shutdown_script`. At channel open,
each side may commit to the exact on-chain script its balance must be paid to on
a cooperative close. It is part of the channel, enforced by the protocol.

In lnd, on the device:

```
enable-upfront-shutdown=true
upfront-shutdown-address=<merchant hardware wallet address>
```

The important property is that the address is fixed **when the channel opens**,
not chosen when it closes. A device that is later compromised cannot redirect
the merchant's balance — the only cooperative close its peer will agree to is
one paying that script.

Proven on real hardware: 275,000 sat of merchant balance landed in the
merchant's own wallet as an output of the closing transaction, with no second
transaction and no withdrawal step. Full transcript in
[testbed/COOP-CLOSE-DEMO.md](testbed/COOP-CLOSE-DEMO.md).

## Why the merchant does not need inbound access

Worth stating precisely, because it is easy to get wrong:

Blocking inbound connections stops peers from **dialling** the device. It does
**not** stop the device from having channels opened to it. The TCP connection
and the channel are separate layers — once the device dials our gateway, that
connection is bidirectional and long-lived, and the gateway can send
`open_channel` back over it. This is how every mobile Lightning wallet gets
inbound liquidity.

So the device: dials out, keeps the connection up, and receives both its channel
and its payments over a connection it initiated. Nothing needs to reach it.

## Why the gateway can verify payments without touching the device

The gateway is the merchant's channel counterparty and the last hop before them.
Every payment to the merchant passes through it. The gateway therefore sees the
HTLC it forwarded and, on success, learns the preimage — cryptographic proof
that the invoice was settled. That is a stronger signal than asking the device,
and it needs no administrative access to it.

That is the basis for the dashboard: we can show a merchant what they have
received from our own records.

## What is not solved yet

Being clear about the gaps, in rough order of how much they matter:

1. **Force close bypasses the whole scheme.** Upfront shutdown governs the
   *cooperative* close only. A unilateral close pays out through the commitment
   transaction to a key the device holds, so those funds land on the device and
   need a sweep. "The merchant never needs a withdrawal" is true for the happy
   path only. Any real product needs an answer for the unhappy one.
2. **A signed OS.** The idea says "minimal signed OS"; today the image is
   minimal but unsigned, with a read-write rootfs and no verified boot. Secure
   boot, signed images and an encrypted data partition are stage 5 of
   [docs/PLAN.md](docs/PLAN.md). Until then, physical possession of the SD card
   is possession of the node.
3. **Provisioning.** The close address is currently set by hand. It has to be
   captured at order time and baked in at manufacture or first boot, along with
   per-device VPN credentials and SSH keys.
4. **One static close address.** `upfront-shutdown-address` is a single address,
   so every channel closes to the same output and an observer can link all of a
   merchant's closes. Per-channel addresses are possible but need more
   machinery.
5. **The device is a hot wallet until settlement.** Funds in the channel are
   controlled by keys on the appliance. Upfront shutdown protects the
   *destination*, not the balance in flight. Largely addressed since: the lnd
   on the device is patched so that the merchant's address is the only on-chain
   destination it may pay and the payment-sending RPCs are gone, under the
   macaroon layer rather than in it ([security/](security/)). Two holes remain,
   and they are gaps 1 and 2 on this list — a force close does not go through
   any of that, and the whole control lasts only as long as nobody replaces the
   binary.
6. **Clock trust.** The board has no RTC and takes its time from NTP, which is
   unauthenticated. Time affects certificate validity. A hardware RTC or NTS
   belongs in a shipped device.
7. **Liquidity and fee management.** We supply inbound liquidity; who pays for
   it, how it is topped up, and who pays the closing fee are commercial
   questions this repo does not touch.
8. **A BOLT 12 offer from this device names it.** lnd builds the blinded path
   in an offer out of the public channel graph, and the device's channel is
   unannounced, so the only path it can build has the device as its own
   introduction node. BOLT 12's recipient privacy needs an announced hop in
   front. [docs/BOLT12.md](docs/BOLT12.md)
9. **The gateway is load-bearing for the payment request.** It hosts the
   public LNURL endpoint because the device cannot, which means it terminates
   TLS and sees everything passing through. A wallet checking the description
   hash catches a swapped invoice; nothing catches a gateway that declines to
   forward. [docs/LNURL.md](docs/LNURL.md)

## Why this is worth doing

The merchant's alternative today is either a custodial processor, or running
their own node. The first means someone else holds their money; the second means
they operate Bitcoin infrastructure they did not ask for.

This sits between the two: we operate the hard parts, and the merchant's money
still ends up in their own custody without them signing anything. The device is
a payment terminal, not a node they administer.
