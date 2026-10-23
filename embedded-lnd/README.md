# embedded-lnd

Yocto-based ARM builds of [lnd](https://github.com/lightningnetwork/lnd) (the
Lightning Network Daemon) for single-board computers.

The goal is a reproducible, image-level build — lnd baked into a Yocto image
rather than dropped onto a stock distro — so the same recipes can be retargeted
across boards and hardened for production.

## Status

Stage 1 proof of concept. `lnd` cross-compiles for aarch64 and the image
recipes are complete; first hardware boot is pending. Not production-ready —
read [docs/HARDENING.md](docs/HARDENING.md) before trusting it with anything.

## Targets

| Stage | Board | Notes |
| --- | --- | --- |
| 1 (current) | Raspberry Pi 4 Model B | First POC target — hardware on hand |
| 2 | Newer Raspberry Pi / other SBCs | After the RPi 4 POC builds and boots |
| 3 | Secure-boot / hardened SBCs | Secure POCs — verified boot, signed images, encrypted storage |

## What it builds

A headless RPi 4 image, Yocto `scarthgap` (5.0 LTS), that boots into lnd:

- **BusyBox + sysvinit.** No systemd, no package manager, no compilers.
- **lnd v0.21.3-beta**, cross-compiled `CGO_ENABLED=0` — a fully static
  binary, so the image carries no libc dependency for it.
- **BOLT 12 offers**, through lndk beside lnd. lnd carries onion messages but
  has no offers RPC. The device can publish an offer and be paid through it,
  and still cannot pay one. [docs/BOLT12.md](docs/BOLT12.md)
- **LNURL-pay** — a lightning address and a QR code — through `lnurlpd`, our
  own daemon, bound to the VPN only. The device accepts no inbound connection
  from the internet, so the gateway owns the public URL and proxies to it over
  the tunnel the device dialled out. [docs/LNURL.md](docs/LNURL.md)
- **A patched lnd.** One on-chain destination — the merchant's own wallet,
  the same address the channel closes to — and a list of RPCs that are simply
  gone. Enforced under the macaroon layer, so the admin macaroon does not lift
  it. [security/](security/)
- **sqlite** as the lnd database (`kvdb_sqlite`). A file, not a daemon.
- **neutrino** as the chain backend. No bitcoind anywhere.
- **Static `192.168.1.50/24`**, no DHCP. Wi-Fi and Bluetooth disabled at the
  device-tree level; IPv6 compiled out and disabled in the kernel.
- **Default-deny firewall.** Inbound is SSH + ping from `192.168.1.0/24` only;
  outbound is open so lnd can reach peers. Nothing on the internet can
  initiate a connection.
- **dropbear** bound to `192.168.1.50:22`, public-key auth only.
- **Two partitions** — OS and data are separate, with fixed sizes so the data
  partition survives an OS reflash.

## Repository layout

```
meta-embedded-lnd/    Yocto layer: distro, image, lnd, lndk, lnurlpd, firewall, wic
lnurlpd/              Our LNURL-pay daemon: Go, standard library only
security/             Patches to lnd, and what they enforce
scripts/              Numbered build steps, run in order
conf-templates/       local.conf / bblayers.conf templates
docs/                 Plan, prerequisites, build, updates, hardening
testbed/              Server-side test stack: VPN, regtest chain, two lnd nodes
```

Nothing Yocto-generated is committed — poky, the layers and the build tree are
tens of gigabytes and live at `/vm/yocto` on the build server.

## Documentation

| Document | What it covers |
| --- | --- |
| [idea.md](idea.md) | The product idea this prototypes, and what is and is not solved |
| [security/README.md](security/README.md) | The lnd patches: destination allowlist, RPC deny list, and why neither is a macaroon |
| [docs/LNURL.md](docs/LNURL.md) | LNURL-pay: why the gateway hosts the URL, what `lnurlpd` implements, and what it holds |
| [docs/BOLT12.md](docs/BOLT12.md) | BOLT 12: why lndk, the onion message transport, and what a blinded path costs an unannounced node |
| [testbed/COOP-CLOSE-DEMO.md](testbed/COOP-CLOSE-DEMO.md) | Demonstration: a merchant balance settling straight to their own wallet |
| [testbed/LNURL-DEMO.md](testbed/LNURL-DEMO.md) | Demonstration: a lightning address paid on a device with no inbound access |
| [testbed/BOLT12-DEMO.md](testbed/BOLT12-DEMO.md) | Demonstration: an offer published, paid, and refused in the other direction |
| [testbed/SECURITY-DEMO.md](testbed/SECURITY-DEMO.md) | Demonstration: the admin macaroon still cannot move the money anywhere else |
| [docs/TESTPLAN.md](docs/TESTPLAN.md) | Test topology and the end-to-end channel/payment exercise |
| [docs/PLAN.md](docs/PLAN.md) | Goal, staged roadmap, and why each key decision was made |
| [docs/PREREQUISITES.md](docs/PREREQUISITES.md) | Build host, workspace layout, server gotchas, what to change before a real deployment |
| [docs/BUILD.md](docs/BUILD.md) | Deploy model, build steps, tmux, flashing, iterating |
| [DEPLOY.md](DEPLOY.md) | Getting a baked image onto the Pi: flashing, first boot, wallet creation |
| [docs/UPDATES.md](docs/UPDATES.md) | Partition layout, updating the OS without losing data, upgrading lnd |
| [docs/HARDENING.md](docs/HARDENING.md) | What is in the image and what is not, and the known weak points |

## Where builds run

Yocto builds are not run on a laptop. They run on the project server:

- Host: `tester-98` (`192.243.215.98`, user `tester`, hostname `srv02`)
- Build/checkout root: under `/vm` on that server

Everything for this project lives under `/vm` on the server. See
[.claude/CLAUDE.md](.claude/CLAUDE.md).

## Branching

`develop` is the working branch.

- Local checkout: commit and **push** to `develop`.
- Server checkout: **pull** `develop`.

The server checkout is a build/test workspace — treat it as read-only for
source changes; make edits locally, push, then pull on the server.

## Getting started

On the build server:

```sh
cd /vm/git/embedded-lnd
git pull
./scripts/00-host-prereqs.sh   # once
./scripts/10-fetch-layers.sh   # once
./scripts/40-build-lnd.sh      # cross-compile lnd for aarch64
./scripts/41-build-lndk.sh     # lndk, for BOLT 12
./scripts/42-build-lnurlpd.sh  # lnurlpd, for LNURL-pay
./scripts/30-sync-layer.sh     # copy the layer into /vm/yocto
./scripts/20-setup-build.sh    # once
./scripts/55-bake-tmux.sh      # bake, detached
```

Watch it: `ssh tester-98 -t tmux attach -t lnd-bake` (`Ctrl-b d` to detach).

See [docs/BUILD.md](docs/BUILD.md) for the details.
