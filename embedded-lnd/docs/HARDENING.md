# Attack surface

## What is in the image, and what is not

The authoritative list is the build manifest:

```
/vm/yocto/build/tmp/deploy/images/raspberrypi4-64/embedded-lnd-image-raspberrypi4-64.rootfs.manifest
```

Review it. Everything below is a claim about that file.

### Deliberately absent

| Not present | Why it would have been there |
| --- | --- |
| systemd | Default init on most distros. Pulls in dbus, journald, resolved, networkd — a lot of code for a box running one service. We use BusyBox + sysvinit. |
| Package manager | `IMAGE_FEATURES` has no `package-management`, so there is no opkg/dnf on device and no way to install software at runtime. |
| Compilers, headers, `-dev`/`-dbg` packages | Standard in a dev image. Nothing on an appliance needs to compile. |
| Wi-Fi and Bluetooth | `disable-wifi` / `disable-bt` device-tree overlays. The radios never initialise and no firmware is loaded — not merely "interface down". |
| IPv6 | Removed from `DISTRO_FEATURES` *and* `ipv6.disable=1` on the kernel command line. No link-local address ever appears, so there is nothing to filter. |
| X11/Wayland/OpenGL/ALSA/PulseAudio | Headless box. |
| A libc dependency for lnd | `CGO_ENABLED=0` makes lnd static. A libc CVE does not reach it. |
| postgres / etcd | Supported lnd backends, both network daemons. sqlite is a file. |
| bitcoind | neutrino needs no local node. |

### Present, and why

| Package | Reason |
| --- | --- |
| `packagegroup-core-boot` | kernel, BusyBox, sysvinit, mount tools |
| `dropbear` | SSH. Far smaller than OpenSSH. |
| `iptables` | the default-deny ruleset |
| `kernel-modules` | RPi Ethernet and SD drivers |
| `lnd-bin` | lnd + lncli, static, and patched — see [the lnd security layer](#the-lnd-security-layer) |
| `lndk-bin` | lndk + lndk-cli, BOLT 12 offers. lnd carries onion messages but has no offers RPC — [BOLT12.md](BOLT12.md) |
| `lnurlpd` | LNURL-pay, static, standard library only — [LNURL.md](LNURL.md) |
| `libgcc1` | the C runtime lndk needs. Unlike lnd and lnurlpd it is not static; the image already carried glibc for dropbear, openvpn and iptables |
| `openvpn` + `openvpn-client-config` | the management VPN, second path in |
| `embedded-lnd-timesync` | busybox `ntpd`. The Pi 4 has no RTC; without it the board boots in 2018 and every certificate check fails |

## Network posture

```
INPUT   DROP     ← default
FORWARD DROP
OUTPUT  ACCEPT   ← neutrino block filters, Lightning peers, DNS

allowed inbound:
  lo
  ESTABLISHED,RELATED
  tcp/22   from 192.168.1.0/24    SSH
  icmp echo from 192.168.1.0/24   reachability
  tcp/22   from 10.99.0.0/24      SSH over the VPN
  tcp/9735 from 10.99.0.0/24      Lightning p2p, so the gateway can dial us
  tcp/8090 from 10.99.0.0/24      LNURL-pay, proxied by the gateway
  icmp echo from 10.99.0.0/24
```

**8090/tcp is the only inbound port that serves the outside world**, and only
at one remove: the gateway holds the public name and certificate and proxies
to it over the tunnel. lnurlpd binds `10.99.0.10:8090` rather than `0.0.0.0`,
so the socket is not on the LAN even before the firewall is consulted, and it
holds lnd's INVOICE macaroon under its own user — it can mint invoices and
read them back, and nothing else. See [LNURL.md](LNURL.md).

Not open, on purpose:

- **10009/tcp (lnd gRPC)** and **8080/tcp (REST)** — bound to `127.0.0.1` in
  `lnd.conf` *and* firewalled. The admin macaroon is full control of the node.
  Use `lncli` over SSH. If you must reach it from the LAN, understand that you
  are exposing the wallet.
- **7000/tcp (lndk gRPC)** — bound to `127.0.0.1` and firewalled, for the
  same reason as lnd's own RPC: it authenticates with lnd's admin macaroon.
  Use `lndk-cli` over SSH.
- **9735/tcp (Lightning p2p inbound)** — peers cannot dial this node, so it
  cannot be an announced public routing node. It does *not* prevent inbound
  channels: a peer can open a channel back over a connection we initiated.
  See [PLAN.md](PLAN.md#network-posture).

SSH is additionally bound to `192.168.1.50:22` in `dropbear.default`, so even
if an interface appeared unexpectedly, sshd is not listening on it. Belt and
braces with the firewall.

`firewall.init` starts at rc order **39**, immediately before networking at 40,
so no interface is ever up without the ruleset loaded. If `iptables-restore`
fails it applies a fail-closed policy rather than leaving the kernel default of
ACCEPT.

## The lnd security layer

Everything above is about reaching the box. This is about what the box can do
once someone has reached it — because on an appliance, they eventually will.
The device holds its own admin macaroon and its own wallet, and the SD card is
removable. The interesting attacker is one *with* credentials.

lnd is therefore patched ([../security/](../security/)) with two controls that
sit **under** the macaroon layer, configured in `[security]` of `lnd.conf`:

```
security.onchain-allowlist=<the merchant's own address>
security.disable-rpc=/routerrpc.Router/SendPaymentV2
security.disable-rpc=/routerrpc.Router/SendToRouteV2
security.disable-rpc=/lnrpc.Lightning/BakeMacaroon
security.disable-rpc=/lnrpc.Lightning/RegisterRPCMiddleware
```

- The allowlist has one entry, and it is the same address the channel
  cooperatively closes to (`upfront-shutdown-address`). Both are substituted
  from one provisioned value at bake time, and lnd refuses to start if they
  disagree. So the only place this device can send money is the merchant.
- The deny list removes what a receive-only terminal has no use for. Setting an
  allowlist additionally closes off the RPCs that can build, sign or broadcast
  a transaction without naming an address (PSBT, `PublishTransaction`,
  `SignOutputRaw`, MuSig2, `FundingStateStep`) — otherwise the allowlist is one
  call away from being bypassed.

Neither is a macaroon permission: they apply to the admin macaroon, and
`BakeMacaroon` is gone anyway. Demonstrated against a running node with full
credentials in [../testbed/SECURITY-DEMO.md](../testbed/SECURITY-DEMO.md).

Two things this does **not** do, and they matter:

1. A **force close** pays out through the commitment transaction and is swept
   by lnd internally, with no RPC involved. None of this touches that path.
2. It is enforced by the lnd on the device, so it lasts exactly as long as
   nobody replaces that binary. Weak point 5 below is the reason this is a
   speed bump rather than a guarantee.

`lncli getinfo` reports `commit=v0.21.3-beta+lqwd-hardened`, so a device can be
asked whether it is running the patched build.

## Known weak points in this POC

These are real and deliberate, to get a bootable POC. Fix them before this is
anything but a lab device.

1. **`empty-root-password` is set.** It applies to the serial console, which
   needs physical access, and it is the only recovery path if the SSH key is
   wrong. Remove it from `IMAGE_FEATURES` in `embedded-lnd-image.bb` and
   disable the serial getty for production.
2. **Root logs in over SSH.** A non-root admin user with a narrow escalation
   path would be better; on a single-service appliance the difference is small,
   but it is not nothing.
3. **The rootfs is read-write.** With OS and data already separated, a
   read-only rootfs plus a tmpfs `/var` is a small change and a large win.
   `IMAGE_FEATURES += "read-only-rootfs"`.
4. **No exploit-mitigation flags.** poky ships
   `conf/distro/include/security_flags.inc` (PIE, `_FORTIFY_SOURCE`, stack
   protector, relro). It is commented out in `embedded-lnd.conf` because a
   first bake should establish a working baseline first. Enable it next — but
   note it does not affect lnd, which is Go and already built `-trimpath`.
5. **No secure boot, no signed images, no encrypted data partition.** A person
   holding the SD card holds the wallet. This is stage 5.
6. **Wallet password.** Auto-unlock requires a plaintext password file on the
   data partition. It is commented out. Manual `lncli unlock` after each reboot
   is the safer default.
7. **The build is not bit-reproducible** — the lnd cross-build resolves Go
   modules over the network. Vendoring or a pinned module proxy would close it.
8. **`kernel-modules` installs every built module.** Trimming to the handful
   actually needed (Ethernet, SD, ext4) would shrink both the image and the
   in-kernel attack surface.
9. **NTP is unauthenticated.** The board has no RTC, so it trusts whatever
   UDP/123 tells it at boot. Anyone able to intercept that traffic can move the
   clock, which in turn decides whether TLS certificates look valid. A real
   deployment wants NTS (chrony) or a hardware RTC. The LAN gateway is queried
   first so the common case does not leave the local network.
10. **OpenVPN adds attack surface** - it is a network-facing daemon holding a
    private key. That is the deliberate trade for a second, authenticated path
    in that does not depend on the LAN.
11. **lnurlpd is reachable from outside, at one remove.** It is the only thing
    on the device that is, and it is deliberately the smallest and least
    privileged part: standard library only, its own user, and the invoice
    macaroon. But it does parse attacker-controlled input, and the gateway
    that fronts it terminates TLS and could alter what passes through.
12. **lndk holds the admin macaroon and is not static.** It needs signer, peer
    and invoice access across three sub-servers and this device cannot bake a
    narrower credential, since `BakeMacaroon` is disabled. What bounds it is
    the security layer, which the admin macaroon does not lift. Being Rust
    against glibc, it is also the one daemon here a libc CVE reaches.

## Suggested order for stage 3

1. Read-only rootfs (item 3) — biggest win per unit of effort.
2. Drop `empty-root-password` + serial getty (item 1), once you trust the keys.
3. `security_flags.inc` (item 4).
4. Trim `kernel-modules` (item 8).
5. Encrypted data partition (item 5), which needs a key-storage story first.
