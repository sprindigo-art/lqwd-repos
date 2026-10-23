# Test topology and end-to-end plan

Goal: open a Lightning channel between an lnd running on the build server and
an lnd running on the Raspberry Pi, over a private VPN, and settle an invoice
in each direction.

## Topology

Everything runs on a private regtest chain. There is no external dependency:
no faucet, no public network, nothing to be down when you want to test.

```
+--------------------------------------------------------------+
| srv02   192.243.215.98                                        |
|                                                               |
|   HOST NETWORK IS UNTOUCHED - no tun0, no route, no iptables  |
|   change. Only udp/1194 is published to a container.          |
|                                                               |
|  +---------------------------------------------------------+ |
|  | network namespace owned by lnd-testbed-vpn              | |
|  |                                                          | |
|  |  tun0 = 10.99.0.1        eth0 = 172.18.0.2 (docker br)  | |
|  |                                                          | |
|  |  +-----------------+  +---------------+  +------------+ | |
|  |  | openvpn         |  | bitcoind      |  | lnd-server | | |
|  |  | udp/1194        |  | regtest       |  | amd64      | | |
|  |  |                 |  | rpc  :18443   |  | listen     | | |
|  |  |                 |  | zmq  :28332/3 |  | 10.99.0.1  | | |
|  |  |                 |  |               |  |     :9735  | | |
|  |  +-----------------+  +---------------+  +------------+ | |
|  |                       +---------------+                  | |
|  |                       | miner         |                  | |
|  |                       | 1 block/10min |                  | |
|  |                       +---------------+                  | |
|  +---------------------------------------------------------+ |
|                              ^                                |
+------------------------------|--------------------------------+
                               | udp/1194 published
                               | (docker PREROUTING/FORWARD,
                               |  NOT the host INPUT chain)
              +----------------+----------------+
              |                                 |
   +----------+-----------+       +-------------+--------------+
   | Raspberry Pi 4       |       | your workstation           |
   | Yocto, lnd aarch64   |       | openvpn client             |
   |                      |       |                            |
   | eth0 192.168.1.50    |       | tun0 10.99.0.20            |
   | tun0 10.99.0.10      |       | admin.ovpn                 |
   | lnd  listen :9735    |       |                            |
   | chain -> 10.99.0.1   |       | ssh root@10.99.0.10        |
   +----------------------+       +----------------------------+
```

### Who talks to whom

| From | To | Transport | Why |
| --- | --- | --- | --- |
| Pi | srv02 `udp/1194` | internet | brings up the tunnel; the Pi is the client |
| workstation | srv02 `udp/1194` | internet | same |
| Pi lnd | `10.99.0.1:18443` + `:28332/3` | VPN | its chain backend - RPC and ZMQ |
| lnd-server | `127.0.0.1:18443` | loopback | same bitcoind, same namespace |
| lnd-server | Pi lnd `10.99.0.10:9735` | VPN | **the server opens the channel** |
| workstation | Pi `10.99.0.10:22` | VPN | management, second path alongside LAN SSH |

The VPN is a **split tunnel**: only `10.99.0.0/24` is routed through it, so the
Pi keeps its own default route for everything else.

### Addresses

| Component | Address | Notes |
| --- | --- | --- |
| srv02 public | `192.243.215.98` | only `udp/1194` published |
| VPN subnet | `10.99.0.0/24` | `10.8.0.0/24`, `10.8.1.0/24`, `10.77.0.0/24` are already routed on srv02 |
| openvpn / bitcoind / lnd-server | `10.99.0.1` | one shared network namespace |
| Raspberry Pi | `10.99.0.10` | pinned in `ccd/rpi` |
| workstation | `10.99.0.20` | pinned in `ccd/admin` |
| Pi LAN | `192.168.1.50/24` | gateway `192.168.1.1` |

### Design notes

- **The server host is not a VPN participant.** `tun0` exists only inside the
  container namespace; the host has no VPN interface and no route to
  `10.99.0.0/24`. Verified with `ip route get 10.99.0.10` on the host, which
  goes out the default gateway.
- **The server lnd is x86_64**, the Pi's is aarch64, both from the same lnd
  commit and build script.
- **bitcoind RPC** is bound broadly inside the namespace but authorised only
  for `127.0.0.1` and `10.99.0.0/24`. Its credential is generated on the server
  and never enters git: lnd-server gets it as flags from the environment, and
  the Pi gets it substituted into `lnd.conf` at bake time.
- **ZMQ has no authentication.** It is publish-only and confined to the
  container namespace plus the VPN. Fine for a regtest testbed; it is not a
  pattern to carry to a real deployment.

## Why regtest

The original plan used Mutinynet, but it is unreachable: its API returns
Cloudflare 403/1006 and its documented P2P node `45.79.52.207:38333` refuses
connections, while a public signet node on the same port connects fine from
this server. Rather than depend on someone else's uptime, the chain is local.

Regtest also makes funding trivial - there is no faucet because coins come
from mining.

**Block cadence:** the miner container produces one block every
`MINE_INTERVAL` seconds, default **600 (10 minutes)**, so the chain advances on
its own at roughly mainnet pace. That is realistic but slow when you are
waiting on a channel to confirm, so mine on demand during a test:

```sh
./scripts/65-mine.sh        # 6 blocks now
./scripts/65-mine.sh 1      # just one
```

## Part 1 - server side (already done)

```sh
./scripts/40-build-lnd.sh amd64   # x86_64 lnd for the container
./scripts/60-sync-testbed.sh      # stage compose + binaries to /vm/testbed
./scripts/61-testbed-up.sh        # PKI, RPC credential, start all four services
./scripts/62-init-server-wallet.sh
./scripts/63-fund-server-lnd.sh 5 # 5 BTC from the miner wallet
```

Current state:

| Item | Value |
| --- | --- |
| server lnd pubkey | see `62-init-server-wallet.sh` output |
| server lnd balance | 5 BTC (500,000,000 sat) |
| chain height | 101+ (primed for coinbase maturity) |
| client profiles | `/vm/testbed/vpn/clients/{rpi,admin}.ovpn` |

## Part 2 - bake and flash the Pi image

`rpi.ovpn` and the bitcoind credential are baked in, so the Pi joins the VPN
and finds its chain backend on boot with no manual step.

```sh
./scripts/30-sync-layer.sh
./scripts/55-bake-tmux.sh
```

Then flash per [DEPLOY.md](../DEPLOY.md).

## Part 3 - after the Pi boots

Set up your workstation VPN first: import `admin.ovpn` into your OpenVPN
client and connect. You should get `10.99.0.20`.

### 3.1 Tunnel

On the Pi (`ssh root@192.168.1.50` from the LAN, or the serial console):

```sh
ip -br addr show tun0        # expect 10.99.0.10/24
ping -c3 10.99.0.1
```

From the server, checking inside the VPN namespace (the host cannot reach it):

```sh
docker exec lnd-testbed-vpn ping -c3 10.99.0.10
docker logs lnd-testbed-vpn | tail -20
```

From your workstation, `ssh root@10.99.0.10` - the VPN as the second path in.

### 3.2 The Pi found its chain backend

```sh
lncli --network=regtest getinfo
```

`block_height` should match the server's, and `synced_to_chain` should be true:

```sh
docker exec lnd-testbed-node lncli --network=regtest --lnddir=/data/lnd getinfo
```

If the Pi cannot sync, its bitcoind RPC credential or the VPN route is the
place to look - `lncli` will say so in `/data/lnd/logs`.

### 3.3 Create and unlock the Pi's wallet

The Pi does **not** auto-unlock (that would mean a plaintext password on the
data partition), so this is manual:

```sh
lncli --network=regtest create      # first boot only
lncli --network=regtest unlock      # after every reboot
```

Keep the seed it prints.

### 3.4 Connect and open the channel

```sh
# on the Pi
lncli --network=regtest getinfo | grep identity_pubkey
```

Then on the server, with that pubkey:

```sh
PI=<pi_pubkey>
docker exec lnd-testbed-node lncli --network=regtest --lnddir=/data/lnd \
    connect "$PI@10.99.0.10:9735"

docker exec lnd-testbed-node lncli --network=regtest --lnddir=/data/lnd \
    openchannel --node_key="$PI" --local_amt=1000000 --push_amt=100000
```

`--push_amt` hands the Pi 100k sats of outbound liquidity immediately, so the
reverse payment works without a rebalance.

Confirm it (do not wait ten minutes for the miner):

```sh
./scripts/65-mine.sh 6
docker exec lnd-testbed-node lncli --network=regtest --lnddir=/data/lnd listchannels
```

### 3.5 Server pays the Pi

```sh
# on the Pi
lncli --network=regtest addinvoice --amt=50000 --memo="server to pi"
# on the server
docker exec lnd-testbed-node lncli --network=regtest --lnddir=/data/lnd \
    payinvoice --force <PAYREQ>
```

### 3.6 The Pi cannot pay the server

This used to be a payment test. Since the hardening it is the opposite: the Pi
is a receive-only terminal and `SendPaymentV2` is disabled in `[security]`, so
the expected result is a refusal.

```sh
# on the server
docker exec lnd-testbed-node lncli --network=regtest --lnddir=/data/lnd \
    addinvoice --amt=25000 --memo="pi to server"
# on the Pi
lncli --network=regtest payinvoice --force <PAYREQ>
```

```
[lncli] rpc error: code = PermissionDenied desc = /routerrpc.Router/SendPaymentV2
is disabled by the security policy of this node (security.disable-rpc)
```

Same for sending its on-chain balance anywhere but the merchant address baked
into the image. The full set of checks, and what each one means, is
[../security/README.md](../security/README.md) and
[../testbed/SECURITY-DEMO.md](../testbed/SECURITY-DEMO.md).

### 3.7 Confirm

```sh
lncli --network=regtest listchannels    # local/remote balance moved
lncli --network=regtest listpayments
lncli --network=regtest listinvoices
```

## Part 4 - the payment surfaces

Two things a merchant actually uses, both exercised end to end against the
software stand-in rather than the Pi, because they need no hardware and the
stand-in runs the same binaries:

```sh
./scripts/67-open-channel.sh    # the gateway funds a channel to the appliance
./scripts/68-lnurl-demo.sh      # LNURL-pay: 17 checks
./scripts/69-bolt12-demo.sh     # BOLT 12 offers: 10 checks
```

Transcripts and what each check means:
[../testbed/LNURL-DEMO.md](../testbed/LNURL-DEMO.md),
[../testbed/BOLT12-DEMO.md](../testbed/BOLT12-DEMO.md).

On the Pi itself the same two surfaces are there, started by init and waiting
for the wallet to be unlocked:

```sh
# on the Pi, after lncli unlock
/etc/init.d/lndk status
/etc/init.d/lnurlpd status

lnurlpd -print-lnurl -base-url=https://pay.testbed.local -name=merchant

M=/data/lnd/data/chain/bitcoin/regtest/admin.macaroon
lndk-cli --macaroon-path=$M --cert-path=/data/lndk/tls-cert.pem     create-offer --amount 50000 --description "espresso"
```

Then, from the gateway, fetch `https://pay.testbed.local/.well-known/lnurlp/
merchant` through the proxy and pay what comes back, and pay the offer with
`lndk-cli --grpc-port=7001 pay-offer`. Both are the same exchanges the demo
scripts automate, with `10.99.0.10` in place of the stand-in.

## Pass criteria

1. The Pi gets `10.99.0.10` on boot with no manual step, and the VPN container
   can ping it.
2. The Pi's lnd syncs to the server's regtest chain (same block height).
3. The channel reaches `active: true`.
4. The server's payment to the Pi settles, and the Pi's attempt to pay back is
   refused by the security policy rather than by anything going wrong.
4b. `lndk` and `lnurlpd` come up on their own after `lncli unlock`, the Pi's
   lightning address resolves through the gateway, and an offer created on the
   Pi can be paid by the gateway. On the stand-in this is criteria 1-7 of
   [68-lnurl-demo.sh](../scripts/68-lnurl-demo.sh) and
   [69-bolt12-demo.sh](../scripts/69-bolt12-demo.sh), both passing.
5. Reboot the Pi: the tunnel comes back on its own, and after `lncli unlock`
   the channel is active again.
6. Reflash **p1+p2 only** per [UPDATES.md](UPDATES.md), reboot, unlock, and the
   channel is still there - proving the data partition survived an OS update.

Criterion 6 is the one that actually justifies the two-partition design.

## Known limitations

- Regtest is a private chain. Nothing here touches real funds or real peers.
- The Pi's lnd is not announced and cannot be dialed from the internet. Inbound
  channels still work over a connection it initiates; here the VPN makes it
  directly dialable from the server anyway.
- `wallet-unlock-password-file` is used on the **server** node only, so it
  restarts unattended. The Pi needs a manual unlock after each boot.
- The Pi depends on the server for its chain backend. If the VPN or bitcoind is
  down, the Pi's lnd cannot sync. That is inherent to using a shared regtest.
