# The security layer

Two extra controls compiled into the lnd that ships on the appliance:

1. **An on-chain destination allowlist.** The device may only pay addresses on
   a list. In practice that list has one entry: the merchant's own wallet.
2. **An RPC deny list.** Named gRPC methods are refused for every caller.

Both are applied as a patch to upstream lnd
([patches/](patches/)), configured in a new `[security]` section of
`lnd.conf`, and enforced **below the macaroon layer**.

## Why not macaroons

Macaroons answer "is this caller allowed to call this method". That is the
wrong question for this device.

The appliance sits in a shop. It holds its own admin macaroon, its own wallet,
and an SD card anyone can take out. The threat we care about is not a caller
without credentials — it is a caller **with** them. Macaroon permissions do not
help there:

- the admin macaroon is on the device, and it grants everything;
- anything a macaroon grants, a macaroon can be baked to grant again;
- caveats are checked before the request is even looked at, so they can say
  "may call SendCoins" but never "may only pay this address".

So the policy here is not a permission. It is a property of the binary and its
config file: it applies to every caller including the admin macaroon, and there
is no credential that lifts it.

## Where it runs

```
gRPC request
    |
    v
panic recovery / logging          upstream lnd
    |
    v
RPC state (wallet locked?)        upstream lnd
    |
    v
macaroon authentication          <-- "who are you, what may you call"
    |
    v
RPC middleware (if registered)    <-- may rewrite the request
    |
    v
security policy                  <-- THIS. innermost.
    |
    v
handler
```

Innermost is deliberate, and it is where the interesting property comes from:
the policy sees the request exactly as the handler will. A middleware that
rewrites `SendCoins.addr` after the macaroon check cannot use that to smuggle a
different destination past the allowlist, because the allowlist runs after the
rewrite.

## The allowlist

Checked wherever a request names an on-chain destination:

| RPC | Field |
| --- | --- |
| `/lnrpc.Lightning/SendCoins` | `addr` |
| `/lnrpc.Lightning/SendMany` | every key of `AddrToAmount` |
| `/lnrpc.Lightning/CloseChannel` | `delivery_address` |
| `/lnrpc.Lightning/OpenChannel`, `OpenChannelSync` | `close_address` |
| `/lnrpc.Lightning/BatchOpenChannel` | `close_address` of each channel |
| `/walletrpc.WalletKit/SendOutputs` | every output `pk_script` |

Addresses are compared as **output scripts**, not strings, so an equivalent
encoding of the same script is still the same destination.

Requests that name no destination are not the allowlist's business and pass
untouched: change returning to the node's own wallet, the funding output of a
channel, a force close paying out through the commitment transaction. None of
those leave the node's custody.

### The escape hatches

Several RPCs can build, sign or broadcast a transaction without ever naming an
address in the request. There is nothing in them for an allowlist to inspect,
so leaving them reachable would make it bypassable in one call. While an
allowlist is in force these are refused:

```
/lnrpc.Lightning/FundingStateStep
/signrpc.Signer/ComputeInputScript
/signrpc.Signer/MuSig2CombineSig
/signrpc.Signer/MuSig2CreateSession
/signrpc.Signer/MuSig2RegisterNonces
/signrpc.Signer/MuSig2Sign
/signrpc.Signer/SignOutputRaw
/walletrpc.WalletKit/FinalizePsbt
/walletrpc.WalletKit/FundPsbt
/walletrpc.WalletKit/PublishTransaction
/walletrpc.WalletKit/SignPsbt
/walletrpc.WalletKit/SubmitPackage
```

`security.allow-unsafe-rpc` reopens them. It exists so the trade-off is
explicit rather than hidden; setting it makes the allowlist decorative, and lnd
says so in the log at startup.

## The deny list

`security.disable-rpc` refuses named methods outright. Fully qualified names,
or a whole service with a wildcard:

```
security.disable-rpc=/routerrpc.Router/SendPaymentV2
security.disable-rpc=/signrpc.Signer/*
```

What the appliance ships with, and why:

| Disabled | Reason |
| --- | --- |
| `/routerrpc.Router/SendPaymentV2` | a payment terminal receives; it does not spend |
| `/routerrpc.Router/SendToRouteV2` | the same, one layer down |
| `/lnrpc.Lightning/BakeMacaroon` | nothing on the device needs to mint credentials |
| `/lnrpc.Lightning/RegisterRPCMiddleware` | nothing should be inserting itself into the RPC path |

## Configuration

```ini
[security]
security.onchain-allowlist=bcrt1q69xmkz08062v59psqj4m2tqg30cyn2yycnt40g
security.disable-rpc=/routerrpc.Router/SendPaymentV2
security.disable-rpc=/lnrpc.Lightning/BakeMacaroon
```

Both lists may be repeated, or given comma separated on one line. Leaving them
empty means lnd behaves exactly as upstream.

Bad policies stop the daemon at startup rather than surfacing at the first
call:

- an address that is not valid on the active chain;
- a deny list entry that is not a method name;
- a deny list entry naming a method **this build does not serve** — checked
  against the gRPC server after every service is registered, so a typo cannot
  become a control that silently does nothing;
- an `upfront-shutdown-address` that is not itself on the allowlist.

That last one is the point of the whole exercise, so it is worth stating
plainly: **the address the channel closes to is the only address the device may
pay.** One provisioned value fills both fields
([64-provision-merchant.sh](../scripts/64-provision-merchant.sh) writes it,
the recipe substitutes it into `lnd.conf`), and lnd refuses to run if they ever
drift apart.

## How it gets into the build

`scripts/40-build-lnd.sh` resets the lnd checkout to the pinned tag, applies
every patch in [patches/](patches/), runs the unit tests that come with them,
and only then cross-compiles. There is no unpatched path: the build fails if
the patch directory is empty or the patch does not apply.

The binary reports itself: `lncli getinfo` shows
`commit=v0.21.3-beta+lqwd-hardened`.

Bumping lnd means rebasing the patch. It touches four upstream lines
(`config.go`, `lnd.go`) and adds a package; everything else is new files.

## Testing it

The testbed runs a container, `lnd-merchant`, on the same binary and the same
policy as the Pi image, so this can be exercised without flashing a card:

```sh
./scripts/64-provision-merchant.sh           # mint the address, start the node
./scripts/62-init-server-wallet.sh merchant  # one-time wallet creation
./scripts/63-fund-server-lnd.sh 1 merchant   # coins to try to steal
./scripts/66-security-demo.sh                # the checks
```

Results from a real run: [../testbed/SECURITY-DEMO.md](../testbed/SECURITY-DEMO.md).

## What this does not do

- **It does not protect a force close.** Upfront shutdown and this allowlist
  both govern where money goes when the node is asked nicely. A unilateral
  close pays out through the commitment transaction, to keys on the device,
  and sweeping those is lnd's own internal path — no RPC, no allowlist.
- **It does not survive replacing the binary.** Anyone who can write to the OS
  partition can install an lnd without the patch. That is stage 5 of
  [../docs/PLAN.md](../docs/PLAN.md): secure boot and a signed image. Until
  then this raises the cost of an attack from "use the admin macaroon" to
  "reflash the device", which is worth having but is not the same thing.
- **It does not stop the peer.** The gateway is the counterparty; a channel
  is a two-party arrangement, and this says nothing about its behaviour.
- **It does not hide anything.** Every rejection names the address it refused
  and the allowlist it checked against. This is a safety rail, not a secret.
