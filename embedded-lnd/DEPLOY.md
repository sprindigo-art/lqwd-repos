# Deploying the image to the Raspberry Pi 4

How to get the Yocto output off the build server onto a Raspberry Pi 4 Model B,
and how to confirm the board actually came up.

Building is [docs/BUILD.md](docs/BUILD.md). Updating an already-deployed board
without losing lnd's data is [docs/UPDATES.md](docs/UPDATES.md). Once the Pi is
up, the end-to-end exercise is [docs/TESTPLAN.md](docs/TESTPLAN.md).

## 0. What you are deploying

A finished bake leaves these on `tester-98`:

```
/vm/yocto/build/tmp/deploy/images/raspberrypi4-64/
├── embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2    ← flash this  (~89 MiB)
├── embedded-lnd-image-raspberrypi4-64.rootfs.wic.bmap   ← block map, copy it too
└── embedded-lnd-image-raspberrypi4-64.rootfs.manifest   ← exact package list
```

Those three names are symlinks to the timestamped files from the last bake, so
they always point at the newest image.

| | |
| --- | --- |
| Compressed | ~89 MiB (`.wic.bz2`) |
| Uncompressed | 5,507,121,152 bytes — 5.13 GiB |
| Actually written by `bmaptool` | ~338 MiB (86,484 mapped 4 KiB blocks) |
| Minimum SD card | **8 GB** |

The image is a complete disk: MBR partition table plus three partitions.
Nothing is resized on first boot; the sizes are fixed on purpose so that an OS
update can rewrite `p1`+`p2` and leave `p3` alone.

| Part | Device | Size | FS | Mount | Contents |
| --- | --- | --- | --- | --- | --- |
| p1 | `mmcblk0p1` | 128 MB | vfat | not mounted at runtime | firmware, kernel, dtbs, `config.txt` |
| p2 | `mmcblk0p2` | 1024 MB | ext4 | `/` | the OS |
| p3 | `mmcblk0p3` | 4096 MB | ext4 | `/data` | lnd wallet, macaroons, TLS, database |

## 1. Check what is baked in, before you flash

These are compiled into the image. Changing any of them means editing the layer
and rebaking — you cannot fix them on the card from Windows, because everything
except the 128 MB boot partition is ext4.

| Baked in | Where it comes from | Change it if |
| --- | --- | --- |
| `192.168.1.50/24`, gw/DNS `192.168.1.1` | [`recipes-core/init-ifupdown/files/interfaces`](meta-embedded-lnd/recipes-core/init-ifupdown/files/interfaces) | your LAN is not `192.168.1.0/24` |
| SSH public key (root, key-only login) | [`recipes-core/ssh-keys/files/authorized_keys`](meta-embedded-lnd/recipes-core/ssh-keys/files/authorized_keys) | you do not hold the matching private key |
| OpenVPN client profile → `/etc/openvpn/client.conf` | `/vm/testbed/vpn/clients/rpi.ovpn` on the server | the testbed VPN was regenerated after the bake |
| lnd config (chain backend, network) | [`recipes-lnd/lnd/files/lnd.conf`](meta-embedded-lnd/recipes-lnd/lnd/files/lnd.conf) | the server node moved network or backend |
| bitcoind RPC credential, substituted into `lnd.conf` | `/vm/testbed/secrets/bitcoind-rpc.env` on the server | the testbed credential was regenerated after the bake |
| **Merchant address**, substituted into `lnd.conf` twice — the cooperative-close destination *and* the only address this device may pay | `/vm/testbed/secrets/merchant.env` on the server, written by [`scripts/64-provision-merchant.sh`](scripts/64-provision-merchant.sh) | this image is for a different merchant |

**The SSH key is the one that bites.** dropbear runs with `-s` (no passwords at
all), so if you do not hold the private half of the key in `authorized_keys`,
the only way into the board is the physical console. Check first:

```sh
ssh-keygen -y -f ~/.ssh/id_ed25519      # compare against authorized_keys
```

To change any of the above: edit locally, push to `develop`, then on the server
`git pull && ./scripts/30-sync-layer.sh && ./scripts/55-bake-tmux.sh`.

Worth reading once per bake — it is the authoritative answer to what is on the
board:

```sh
ssh tester-98 'grep -E "^(lnd-bin|openvpn|dropbear|iptables|kernel-image) " \
  /vm/yocto/build/tmp/deploy/images/raspberrypi4-64/embedded-lnd-image-raspberrypi4-64.rootfs.manifest'
```

## 2. Copy the image off the build server

From your workstation (the `tester-98` alias is in `~/.ssh/config`):

```sh
D=/vm/yocto/build/tmp/deploy/images/raspberrypi4-64
scp tester-98:$D/embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2  .
scp tester-98:$D/embedded-lnd-image-raspberrypi4-64.rootfs.wic.bmap .
```

`scp` resolves the symlinks server-side, so you get the real files.

Verify the transfer — a truncated image flashes happily and then fails to boot:

```sh
ssh tester-98 "sha256sum $D/embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2"
```

```powershell
# Windows PowerShell
Get-FileHash -Algorithm SHA256 .\embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2
```

## 3. Flash the SD card

> Identify the target device **twice**. Flashing the wrong disk destroys it,
> and on a laptop the wrong disk is usually the system disk.

### A. Linux or WSL — `bmaptool`, the fast and exact path

Writes only the ~338 MiB that contain data rather than the full 5.13 GiB, and
checksums every block as it goes.

```sh
lsblk                                    # find the card: /dev/sdX, /dev/mmcblk0
sudo umount /dev/sdX*                    # if the desktop auto-mounted it

sudo bmaptool copy \
  --bmap embedded-lnd-image-raspberrypi4-64.rootfs.wic.bmap \
        embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2 \
        /dev/sdX

sync
```

Write to the **whole disk** (`/dev/sdX`), never to a partition (`/dev/sdX1`) —
the image carries its own partition table.

Under WSL2 the card reader has to be handed to Linux first, from an elevated
PowerShell:

```powershell
wmic diskdrive list brief          # note the PHYSICALDRIVE number
wsl --mount --bare \\.\PHYSICALDRIVE2
```

It then appears inside WSL as `/dev/sdX`. Detach afterwards with
`wsl --unmount \\.\PHYSICALDRIVE2`.

### B. Windows — Rufus, Raspberry Pi Imager or balenaEtcher

No `bmaptool`, so the full 5.13 GiB gets written; budget 5–15 minutes depending
on the card.

**Rufus** cannot read `.bz2`, so decompress first. Python 3.13 is already
installed, so nothing extra is needed:

```powershell
cd C:\Users\Lenovo\Desktop\embedded-lnd-image
python -c "import bz2,shutil; s=bz2.BZ2File('embedded-lnd.img.bz2'); o=open('embedded-lnd.img','wb'); shutil.copyfileobj(s,o,1024*1024); o.close(); s.close()"
```

That yields a 5,507,121,152-byte `embedded-lnd.img`. Then, running Rufus **as
Administrator**:

1. **Device** - the SD card. Confirm the size matches the card, not another disk.
2. **Boot selection** - dropdown, **Disk or ISO image**, then **SELECT**, and
   pick `embedded-lnd.img`. Set the file filter to **All files** if `.img` is
   not offered.
3. Leave Partition scheme and Target system alone; they are ignored for a raw
   image.
4. **START**. If Rufus offers **ISO Image mode vs DD Image mode**, pick
   **DD Image mode** - this is a raw disk image and ISO mode would corrupt it.

When it finishes, Windows will mount the 128 MB FAT boot partition and fail to
recognise the two ext4 ones. **It will offer to format them - click Cancel.**
Those are the root and data partitions and they are fine.

**Raspberry Pi Imager**: *Choose OS* → *Use custom* → the `.wic.bz2` → *Choose
Storage* → the SD card → *Write*. When it asks **"Would you like to apply OS
customisation settings?" answer NO** — that injects a `firstrun.sh`,
`userconf.txt` and its own `cmdline.txt` edits into the boot partition, none of
which this image expects or uses.

**balenaEtcher**: *Flash from file* → the `.wic.bz2` → target → *Flash!*.
Etcher reads bz2 directly and verifies the write.

If a tool refuses the `.bz2`, decompress it first (7-Zip, right-click →
*Extract here*) and flash the resulting 5.13 GiB `.wic` file instead.

### C. `dd` fallback

```sh
bzcat embedded-lnd-image-raspberrypi4-64.rootfs.wic.bz2 \
  | sudo dd of=/dev/sdX bs=4M conv=fsync status=progress
sync
```

### Confirm the card before pulling it out

```sh
sudo partprobe /dev/sdX
lsblk -o NAME,SIZE,FSTYPE,LABEL /dev/sdX
```

Expect three partitions labelled `boot` (128M, vfat), `root` (1G, ext4) and
`lnddata` (4G, ext4). One partition, or sizes that do not match, means the write
did not land.

## 4. Wire it up and boot

1. Card into the Pi.
2. Ethernet into the switch — **this image has no Wi-Fi.** The `disable-wifi`
   and `disable-bt` overlays are applied at the device-tree level, so the radios
   never appear at all.
3. Serial console — optional, but do it for a first boot.
4. Power last. A genuine 5V/3A USB-C supply; an underpowered one produces
   undervoltage stalls that look exactly like a corrupt image.

### Serial console

3.3V USB-TTL adapter onto the GPIO header, 115200 8N1:

| Adapter | Pi header |
| --- | --- |
| GND | pin 6 |
| RX | pin 8 (Pi TXD, GPIO14) |
| TX | pin 10 (Pi RXD, GPIO15) |
| 5V | **do not connect** |

```sh
picocom -b 115200 /dev/ttyUSB0        # or: screen /dev/ttyUSB0 115200
```

On Windows, PuTTY: Serial, the adapter's COM port, 115200.

The kernel command line is `console=serial0,115200`, so boot messages come out
here. **A login prompt probably will not.** `SERIAL_CONSOLES` is inherited from
meta-raspberrypi as `115200;ttyS0`, so the getty is spawned on `ttyS0` (the mini
UART), while `dtoverlay=disable-bt` moves the header UART to `ttyAMA0`. `ttyrun`
skips a getty whose device does not exist, which leaves kernel output and no
prompt. Untested on hardware so far; if it bites, the fix is one line in
[`conf/distro/embedded-lnd.conf`](meta-embedded-lnd/conf/distro/embedded-lnd.conf)
plus a rebake:

```
SERIAL_CONSOLES = "115200;ttyAMA0"
```

Until then the local login path is HDMI plus a USB keyboard: there is a getty on
`tty1`, and `IMAGE_FEATURES = "empty-root-password"` means `root` logs in there
with no password.

## 5. First-boot checks

From a workstation **on `192.168.1.0/24`** — the firewall accepts SSH and ping
from that subnet on `eth0` only (plus `10.99.0.0/24` on `tun0`):

```sh
ping -c3 192.168.1.50
ssh root@192.168.1.50
```

Then on the board:

```sh
ip -br addr                       # eth0 192.168.1.50/24, tun0 10.99.0.10/24
grep " /data " /proc/mounts       # p3 must be mounted, or lnd refuses to start
df -h /data                       # ~4G
/etc/init.d/firewall status       # policy DROP on INPUT and FORWARD
/etc/init.d/lnd status
tail -f /data/lnd/logs/bitcoin/*/lnd.log
```

### Check the clock

The Pi 4 has no RTC, so it boots at the rootfs build timestamp - years in the
past. That used to break everything downstream: OpenVPN rejected the server
certificate as not-yet-valid, so the tunnel never came up, and lnd would have
minted TLS material with a 2018 date.

The image now runs busybox `ntpd` as the `timesync` service at rc order **05**,
before openvpn (10) and lnd (90). It blocks on a one-shot sync first, so the
clock is right before anything validates a certificate.

```sh
/etc/init.d/timesync status      # shows the daemon state and the current time
date
```

If the date is still wrong, the board could not reach a time source. Sources
are in `/etc/default/timesync`; the LAN gateway is tried first because it needs
no DNS, then the public pools:

```sh
cat /etc/default/timesync
nslookup pool.ntp.org            # DNS comes from the static /etc/resolv.conf
```

Plain NTP is unauthenticated, so anything that can intercept UDP/123 can move
this clock. For production use NTS (chrony) or fit a hardware RTC - see
[docs/HARDENING.md](docs/HARDENING.md).

### Create the wallet (once)

lnd starts at boot but sits with no wallet until you make one. `lncli` needs
`--lnddir` because the data lives on `/data` rather than `~/.lnd`, and
`--network` has to match `lnd.conf`:

```sh
NET=$(grep -oE '^bitcoin\.(mainnet|testnet|signet|regtest)' /etc/lnd/lnd.conf | cut -d. -f2)
lncli --lnddir=/data/lnd --network=$NET create
```

Write the 24-word seed down on paper. It is the only way back from a dead SD
card. Then:

```sh
lncli --lnddir=/data/lnd --network=$NET getinfo
```

**After every reboot the wallet comes up locked.**
`wallet-unlock-password-file` is deliberately not set, so nothing on the device
holds the password:

```sh
lncli --lnddir=/data/lnd --network=$NET unlock
```

At that point the board is deployed. Continue with
[docs/TESTPLAN.md](docs/TESTPLAN.md) part 3 to open a channel against the server
node.

## 6. Redeploying

- **New OS, keep the wallet** — reflash `p1`+`p2` only, per
  [docs/UPDATES.md](docs/UPDATES.md). Do *not* `bmaptool` the whole card: that
  rewrites `p3` and destroys the channel state.
- **Start over** — flash the whole card as in section 3. Everything on `/data`
  is gone; you need the seed, and for open channels the `channel.backup`, to
  recover anything.

Either way, `/etc/init.d/lnd stop` and let it finish before cutting power. lnd
needs time to close its database cleanly; the init script gives it 90 seconds
before SIGKILL.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| No boot messages on serial at all | wrong pins, wrong baud, or a bad flash | re-check pins 6/8/10 and 115200; reflash |
| Boot messages but no login prompt | getty is on `ttyS0`, header UART is `ttyAMA0` | HDMI + USB keyboard, or set `SERIAL_CONSOLES` and rebake (section 4) |
| No ping on `192.168.1.50` | wrong subnet, or something else already holds `.50` | the address is static and baked in — put the workstation on `192.168.1.0/24` |
| Ping works, SSH refused | you do not hold the baked-in private key | rebake with your key in `authorized_keys` |
| `lnd: /data is not mounted - refusing to start` | `p3` missing or unformatted | reflash the whole card; the init script is stopping lnd from creating a throwaway wallet on the rootfs |
| `lncli` cannot find the macaroon or cert | `--lnddir=/data/lnd` omitted | lncli defaults to `~/.lnd`; this image keeps everything on `/data` |
| `lncli` reports a macaroon for a different network | `--network` disagrees with `lnd.conf` | read the network out of `/etc/lnd/lnd.conf` (section 5) |
| No `tun0` | server VPN down, or a stale profile baked in | `logread \| grep openvpn`; check `lnd-testbed-vpn` on the server; rebake if `rpi.ovpn` was regenerated |
| Chain never syncs, TLS looks expired, VPN handshake fails | clock is wrong and `timesync` could not reach a time source | `/etc/init.d/timesync status`; check `/etc/default/timesync` and DNS (section 5) |
| Random reboots, filesystem corruption | undervoltage | a real 5V/3A supply, and a card that is not counterfeit |
