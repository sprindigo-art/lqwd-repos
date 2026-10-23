# Plan

## Goal

A Raspberry Pi 4 Model B that boots straight into `lnd`, exposes as little as
possible, and can be updated without losing its Lightning data. Yocto is the
vehicle because it builds the whole image from source with an explicit,
reviewable package list — unlike a stock Raspberry Pi OS install, where you
subtract from thousands of packages you did not choose.

## Stages

| Stage | Scope | State |
| --- | --- | --- |
| 1 | RPi 4 Model B POC: minimal image, lnd + sqlite, LAN-only, two partitions | **in progress** |
| 2 | Boot on real hardware, create a wallet, sync on testnet, prove data survives an OS reflash | next |
| 3 | Hardening pass — see [HARDENING.md](HARDENING.md) | planned |
| 4 | Other boards (newer Pi, secure-boot capable SBCs) | planned |
| 5 | Verified boot, signed images, encrypted data partition | planned |

## Key decisions and why

### lnd is cross-compiled outside Yocto

The obvious approach is a Yocto Go recipe. It does not work well here:

- lnd v0.21.3-beta pins **Go 1.26.6** (its `Makefile`). Yocto scarthgap ships
  Go 1.22. Recipes cannot easily use a newer toolchain than the release
  provides.
- lnd does not vendor its Go modules, so a recipe would need network access
  during `do_compile`, which bitbake forbids by default for good reasons.

So `scripts/40-build-lnd.sh` cross-compiles with the exact toolchain upstream
uses, and `lnd-bin_0.21.3.bb` installs the resulting binaries. This is also how
the lnd project builds its own release artifacts, so we inherit their testing.

`CGO_ENABLED=0` makes the binaries **fully static**. The image therefore needs
no libc, no OpenSSL and no sqlite library on the target for lnd to run — a
large chunk of attack surface that simply is not present.

### sqlite, not postgres or etcd

lnd supports bbolt, sqlite, postgres and etcd. postgres and etcd are network
daemons; putting either on the device would mean another listening socket,
another set of credentials and another CVE feed. sqlite is a file. It is
compiled in via the `kvdb_sqlite` build tag and needs no library on target
(the driver is pure Go).

### Two partitions

`p2` (OS) and `p3` (data) are separate, and `p1`/`p2` are **fixed size**, which
pins the byte offset of `p3`. An OS update rewrites `p1`+`p2` and leaves the
wallet, macaroons, TLS material and database untouched. See [UPDATES.md](UPDATES.md).

### Network posture

Static `192.168.1.50/24`, no DHCP — the box must be at a known address and must
never take a route or resolver from an untrusted network. Outbound is open so
neutrino can fetch block filters and lnd can reach Lightning peers; inbound is
default-deny with a LAN-only exception for SSH and ping.

What this does and does not cost, stated precisely - the distinction matters
and is easy to get wrong:

**Inbound channels still work.** In Lightning the TCP connection and the
channel are separate layers. Once this node dials out to a peer, that Brontide
connection is bidirectional and long-lived, and the peer can send
`open_channel` back over it. Nothing has to dial us. This is exactly how NAT'd
and mobile nodes (Phoenix, Breez, Muun) get inbound liquidity from an LSP.

The requirement is that **we** initiate and keep the connection up. lnd
reconnects automatically to peers it already has channels with; for a peer you
have no channel with yet, `lncli connect <pubkey>@<host>:<port>` first, then
ask them to open.

**What is actually lost** is being *dialable*: arbitrary peers cannot reach us,
so this node cannot serve as an announced public routing node. Receiving
payments is unaffected - use private channels, and lnd puts the necessary
route hints in the invoices.

### neutrino, not bitcoind

With outbound internet available, neutrino (BIP157/158 light client) needs no
Bitcoin node anywhere on the LAN and stores a few hundred MB instead of
hundreds of GB. A full `bitcoind` does not fit the "minimal appliance" goal and
would not fit the SD card.

Defaults to **testnet**. Switching networks is one line in `lnd.conf`.

## Open items

- Wallet creation is manual on first boot (`lncli create`). Auto-unlock needs a
  plaintext password file; the config has it commented out.
- The data partition is a fixed 4 GB and does not grow to fill a larger SD
  card. Growing it needs `parted`/`resize2fs` on the device, which is more
  attack surface; do it from a workstation instead.
- Reproducibility: the lnd build resolves Go modules from the network. Pinning
  a module proxy or vendoring would make it airtight.
