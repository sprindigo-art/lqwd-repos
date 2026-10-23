# Prerequisites

## Build host

The build runs on `tester-98` (`192.243.215.98`, user `tester`), Ubuntu 24.04.4
LTS, 12 cores, 125 GB RAM.

Everything lives under **`/vm`** (3.1 TB free). This matters: a Yocto build
needs roughly 100 GB for `downloads/`, `sstate-cache/` and `tmp/`, and the root
filesystem only has ~40 GB free.

```
/vm/yocto/
├── poky/              Yocto 5.0 LTS (scarthgap)
├── layers/
│   ├── meta-raspberrypi
│   └── meta-openembedded
├── meta-embedded-lnd/ ← rsynced from this repo by scripts/30-sync-layer.sh
├── toolchain/go/      Go 1.26.6, pinned + checksummed
├── src/lnd/           lnd v0.21.3-beta checkout
├── artifacts/lnd/     cross-compiled lnd + lncli (~120 MB)
├── downloads/         Yocto source mirror
├── sstate-cache/      Yocto shared state
└── build/             bitbake build dir (conf/, tmp/, deploy/)
```

None of that is in git. This repository holds only the layer, the scripts and
these docs.

### Host packages

Installed by `scripts/00-host-prereqs.sh`:

```
gawk wget git diffstat unzip texinfo gcc build-essential chrpath socat cpio
python3 python3-pip python3-pexpect xz-utils debianutils iputils-ping
python3-git python3-jinja2 python3-subunit zstd liblz4-tool file locales
libacl1 rsync bmap-tools
```

Plus `tmux`, so the bake can run detached and be watched from any session.

### Server gotchas

- **`git://` (port 9418) is blocked.** All clones must use `https://`. This is
  why `10-fetch-layers.sh` uses HTTPS URLs.
- `/vm` itself is owned by `lqwd:lqwd` and is not writable by `tester`.
  `00-host-prereqs.sh` uses `sudo install -d` once to create `/vm/yocto`.
- `oe-init-build-env` needs **bash** and is not `set -u` clean, which is why
  `20-setup-build.sh` and `50-bake.sh` are bash and relax `-u` around it.

## Target hardware

- Raspberry Pi 4 Model B
- SD card ≥ 8 GB (the image is ~5.2 GB: 128 MB boot + 1 GB OS + 4 GB data)
- Ethernet on a `192.168.1.0/24` LAN with a gateway at `192.168.1.1`
- Serial console (USB-TTL on the GPIO header) strongly recommended for the
  first boot — it is the only recovery path if the SSH key is wrong

## What you must change before a real deployment

1. `meta-embedded-lnd/recipes-core/ssh-keys/files/authorized_keys` — currently
   holds the key found at `Work/id_rsa/id_ed25519.pub`. Replace it with the key
   you actually intend to use. Password login is disabled, so this file is the
   only way in over the network.
2. `meta-embedded-lnd/recipes-lnd/lnd/files/lnd.conf` — network is `testnet`.
3. Addresses, if your LAN is not `192.168.1.0/24`: they appear in
   `interfaces`, `dropbear.default`, `iptables.rules` and `lnd.conf`.
