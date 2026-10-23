# Partition layout, updates and data migration

## Layout

Defined in [`meta-embedded-lnd/wic/embedded-lnd-rpi.wks`](../meta-embedded-lnd/wic/embedded-lnd-rpi.wks).

| Part | Device | Size | FS | Mount | Contents |
| --- | --- | --- | --- | --- | --- |
| p1 | `mmcblk0p1` | 128 MB (fixed) | vfat | not mounted at runtime | RPi firmware, kernel, dtbs, `config.txt` |
| p2 | `mmcblk0p2` | 1024 MB (fixed) | ext4 | `/` | the OS |
| p3 | `mmcblk0p3` | 4096 MB (fixed) | ext4 | `/data` | **lnd state** |

`p1` and `p2` are fixed size **on purpose**. That pins the byte offset at which
`p3` begins, which is what makes an in-place OS update possible.

`p1` is not in `/etc/fstab`. Nothing on a running system needs to write
firmware or kernel files, so it stays unmounted; mount it by hand when updating.

`/data` is mounted `nosuid,nodev,noexec` — nothing there is ever executed.

## What lives on the data partition

Everything that is expensive or impossible to recreate:

```
/data/lnd/
├── data/chain/bitcoin/<network>/   wallet.db, channel state, sqlite db
├── data/graph/<network>/           channel graph, neutrino filter headers
├── tls.cert, tls.key
└── logs/
```

`lnd.conf` sets `lnddir=/data/lnd`, so lnd writes nothing persistent to the
rootfs. The init script **refuses to start if `/data` is not mounted** rather
than letting lnd quietly create a fresh wallet on the OS partition — a wallet
that the next update would destroy.

## Updating the OS without touching data

Because `p3`'s offset is fixed, write only the first two partitions:

```sh
# On the device: stop lnd and flush its database first.
/etc/init.d/lnd stop

# From a workstation, with the SD card in a reader.
# 128 MiB + 1024 MiB = 1152 MiB of image, at 1 MiB blocks.
bzcat embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2 \
  | dd of=/dev/sdX bs=1M count=1152 conv=fsync
```

`p3` is untouched. On boot the new OS mounts the existing `/data` and lnd picks
up where it left off.

**Before you do this**, confirm the new image really is 1152 MiB of `p1`+`p2`:

```sh
parted -s embedded-lnd-image-raspberrypi4-64.rootfs.wic unit MiB print
```

If the sizes in the `.wks` ever change, this procedure moves `p3` and orphans
the data. That is why the `.wks` says not to change them.

## Upgrading lnd

1. Bump `LND_VERSION` in `scripts/env.sh` and `LND_VERSION`/`LND_SRCREV` in
   `lnd-bin_0.21.3.bb` (rename the recipe to the new version).
2. `./scripts/40-build-lnd.sh`
3. `bitbake -c cleansstate lnd-bin && ./scripts/50-bake.sh`
4. Update the OS as above.

lnd migrates its own database schema on first start after an upgrade. The
migration is **one-way** — an older lnd will refuse to open a newer database.

**Always back up before upgrading:**

```sh
/etc/init.d/lnd stop
tar czf lnd-backup-$(date +%F).tar.gz -C /data lnd
```

Also keep `channel.backup` (lnd's static channel backup) somewhere off the
device. A filesystem backup of channel state is not a safe thing to restore
from — restoring a stale channel database can cost you funds. `channel.backup`
is the supported path.

## Switching Bitcoin networks

Changing `bitcoin.testnet` to `bitcoin.mainnet` does not migrate anything: lnd
keys data by network, so it creates a fresh wallet under a new directory. Treat
it as a new node.
