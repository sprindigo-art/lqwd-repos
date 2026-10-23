# Building

## Deploy model

The Yocto workspace is **never** a git checkout. You pull this repo, then copy
the layer into the workspace:

```
/vm/git/embedded-lnd     git checkout (this repo)   ── 30-sync-layer.sh ──▶  /vm/yocto/meta-embedded-lnd
```

Edit locally, push to `develop`, then on the server:

```sh
cd /vm/git/embedded-lnd
git pull
./scripts/30-sync-layer.sh
./scripts/50-bake.sh
```

The server checkout is pull-only. Do not edit there — `30-sync-layer.sh` uses
`rsync --delete`, and a local edit will also block the next `git pull`.

## First time on a fresh host

```sh
./scripts/00-host-prereqs.sh    # apt packages, creates /vm/yocto  (needs sudo)
./scripts/10-fetch-layers.sh    # poky + meta-raspberrypi + meta-openembedded
./scripts/40-build-lnd.sh       # cross-compile lnd/lncli for aarch64
./scripts/41-build-lndk.sh      # cross-compile lndk/lndk-cli   (BOLT 12)
./scripts/42-build-lnurlpd.sh   # cross-compile lnurlpd         (LNURL-pay)
./scripts/30-sync-layer.sh      # copy the layer into the workspace
./scripts/20-setup-build.sh     # create build/conf from conf-templates/
./scripts/50-bake.sh            # bitbake embedded-lnd-image
```

The three `4x` scripts must run before `50-bake.sh` — the recipes install
binaries they produce, and bitbake fails at fetch time if they are missing.
`50-bake.sh` checks for all three and says which one to run.

`40-build-lnd.sh` resets the lnd checkout to the pinned tag and applies
[`security/patches/`](../security/patches/) before building; there is no
unpatched path, and it fails if the patch does not apply.

`41-build-lndk.sh` fetches a pinned, checksummed Rust toolchain the same way
Go is fetched, and builds lndk from a pinned revision — a branch rather than a
release tag, for the reason in [BOLT12.md](BOLT12.md). `42-build-lnurlpd.sh`
builds our own daemon from [`lnurlpd/`](../lnurlpd/) in this repository, and
runs its tests first.

The recipe also substitutes two per-device values into `lnd.conf` that come
from the testbed, so those have to exist before the first bake:

```sh
./scripts/60-sync-testbed.sh        # stage the compose stack
./scripts/61-testbed-up.sh          # -> secrets/bitcoind-rpc.env
./scripts/64-provision-merchant.sh  # -> secrets/merchant.env
```

`merchant.env` holds the merchant's settlement address, and it becomes both
`upfront-shutdown-address` and `security.onchain-allowlist` in the image. An
empty one is a hard build failure rather than an image that can pay anybody.

It also holds `LNURL_BASE_URL` and `LNURL_NAME` — the public endpoint the
gateway serves for this merchant, which is baked into `/etc/default/lnurlpd`
as the callback the device advertises. Same rule: empty is a build failure.

## Run the bake in tmux

A from-scratch build takes hours. Run it detached so it survives a dropped SSH
connection and can be watched from anywhere:

```sh
./scripts/55-bake-tmux.sh              # starts (or reuses) session "lnd-bake"
ssh tester-98 -t tmux attach -t lnd-bake
```

Detach with `Ctrl-b d`. The full log is also written to
`/vm/yocto/bake-<timestamp>.log`, so you can `tail -f` it instead.

## Output

```
/vm/yocto/build/tmp/deploy/images/raspberrypi4-64/
├── embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2   ← flash this
├── embedded-lnd-image-raspberrypi4-64.rootfs.wic.bmap
└── embedded-lnd-image-raspberrypi4-64.rootfs.manifest  ← exact package list
```

Read the manifest. It is the authoritative answer to "what is actually in this
image", and it is the thing to review when you care about attack surface.

## Flashing

`bmaptool` only writes the used blocks, so it is much faster than `dd`:

```sh
bmaptool copy --bmap embedded-lnd-image-raspberrypi4-64.rootfs.wic.bmap \
              embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2 /dev/sdX
```

Check `/dev/sdX` twice. Flashing the wrong device destroys it.

## Iterating

bitbake is incremental and `sstate-cache` is shared, so a change to one recipe
rebuilds only what depends on it.

```sh
bitbake -c cleansstate lnd-bin && bitbake embedded-lnd-image   # after a new lnd build
bitbake -e lnd-bin | grep ^FILESPATH=                          # debug file lookup
bitbake -c listtasks embedded-lnd-image
```

To pick up a rebuilt lnd binary you must `cleansstate lnd-bin` — bitbake
fingerprints the file contents, but the artifacts live outside the layer, so
force it rather than trusting the cache.
