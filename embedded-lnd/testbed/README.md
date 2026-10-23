# Testbed

Two containers on the build server plus the Raspberry Pi, wired together over
a private OpenVPN link, both lnd nodes on **Mutinynet** (a signet with 30-second
blocks).

```
                 internet
                    │
       ┌────────────┴─────────────┐
       │  srv02  192.243.215.98   │
       │                          │
       │  ┌────────────────────┐  │
       │  │ openvpn (host net) │  │  udp/1194
       │  │ tun0 = 10.99.0.1   │──┼──────────────┐
       │  └────────────────────┘  │              │
       │  ┌────────────────────┐  │              │
       │  │ lnd-server         │  │              │
       │  │ listen 10.99.0.1   │  │              │
       │  │       :9735        │  │              │
       │  └────────────────────┘  │              │
       └──────────────────────────┘              │
                                                 │
              ┌──────────────────────────────────┴──┐
              │                                     │
   ┌──────────┴───────────┐              ┌──────────┴───────────┐
   │ Raspberry Pi 4       │              │ your workstation     │
   │ eth0  192.168.1.50   │              │ admin.ovpn           │
   │ tun0  10.99.0.10     │              │ tun0  10.99.0.20     │
   │ lnd listen :9735     │              └──────────────────────┘
   └──────────────────────┘
```

## Why a VPN

Second layer of defence, and it makes the Pi *dialable* by the server without
exposing anything to the internet. SSH and lnd's p2p port are reachable on
`tun0` from `10.99.0.0/24` only — the LAN rules and the internet-facing
default-deny are unchanged.

Split tunnel: only `10.99.0.0/24` goes over the VPN. The Pi still reaches
Mutinynet directly, which is what you want — a full tunnel would push all
neutrino traffic through the server for no benefit.

## Addresses

| Host | VPN address | Notes |
| --- | --- | --- |
| srv02 | `10.99.0.1` | OpenVPN server, lnd-server |
| Raspberry Pi | `10.99.0.10` | pinned via `ccd/rpi` |
| your workstation | `10.99.0.20` | pinned via `ccd/admin` |

`10.99.0.0/24` was chosen because `10.8.0.0/24`, `10.8.1.0/24` and
`10.77.0.0/24` are already routed on srv02.

## Layout on the server

```
/vm/testbed/
├── compose/          ← rsynced from this repo
├── vpn/
│   ├── pki/          CA, server + client keys   (NEVER commit)
│   ├── ccd/          per-client fixed addresses
│   └── clients/      rpi.ovpn, admin.ovpn       (NEVER commit)
├── secrets/          bitcoind RPC credential, merchant address + LNURL endpoint
├── lnd/              lnd-server data dir
├── lnd-merchant/     lnd-merchant data dir
├── lndk-gateway/     lndk state: its gRPC TLS material and log
├── lndk-merchant/    the same, for the appliance stand-in
└── lnurl-gateway/    the gateway's TLS certificate for pay.testbed.local
```

Nothing under `/vm/testbed` is in git. The PKI holds private keys.

## The merchant node

`lnd-merchant` is a software stand-in for the Raspberry Pi: same binary, same
hardening policy, so the security layer can be exercised without flashing a
card. It shares the VPN container's network namespace like everything else, so
it uses its own ports:

| | p2p | gRPC | REST |
| --- | --- | --- | --- |
| `lnd-server` (gateway) | `10.99.0.1:9735` | `127.0.0.1:10009` | `127.0.0.1:8080` |
| `lnd-merchant` | `10.99.0.1:9736` | `127.0.0.1:10010` | `127.0.0.1:8081` |

And the daemons beside them:

| | listens on | reached with |
| --- | --- | --- |
| `lndk-gateway` | `127.0.0.1:7001` | `lndk-cli --grpc-port=7001` |
| `lndk-merchant` | `127.0.0.1:7000` | `lndk-cli --grpc-port=7000` |
| `lnurlpd` (merchant) | `10.99.0.1:8090` | the gateway's proxy, over the VPN |
| `lnurl-gateway` | `127.0.0.1:443` | `curl --resolve pay.testbed.local:443:127.0.0.1` |

`lnurlpd` binds the tunnel address deliberately: on the Pi that is
`10.99.0.10:8090`, and the public URL belongs to the gateway in front of it.

It is not one container but four, because the appliance is not one daemon:

| Container | What it is |
| --- | --- |
| `lnd-testbed-merchant` | lnd, with the hardening policy |
| `lnd-testbed-lndk-merchant` | lndk — BOLT 12 offers, which lnd has no RPC for |
| `lnd-testbed-lnurlpd` | lnurlpd — LNURL-pay, bound to the VPN address only |
| `lnd-testbed-lnurl-gateway` | nginx, standing in for the gateway's public endpoint. Not part of the appliance |

`lnd-testbed-lndk-gateway` runs alongside `lnd-server` for the same reason
BOLT 12 needs an understanding peer at both ends: it is the payer.

All of them are behind a compose profile, so a plain `docker compose up -d`
does not start them, and lnd-merchant refuses to start without a provisioned
merchant address — running it unhardened would quietly test the wrong thing:

```sh
./scripts/64-provision-merchant.sh           # mint the address, start the node
./scripts/62-init-server-wallet.sh merchant  # one-time wallet creation
./scripts/63-fund-server-lnd.sh 1 merchant   # on-chain coins
./scripts/66-security-demo.sh                # the policy, attacked with admin
./scripts/67-open-channel.sh                 # the gateway funds a channel to it
./scripts/68-lnurl-demo.sh                   # a lightning address, paid
./scripts/69-bolt12-demo.sh                  # an offer, paid
```

The address it mints is the single provisioned value behind both
`upfront-shutdown-address` and `security.onchain-allowlist`, here and in the Pi
image. See [../security/README.md](../security/README.md) and
[SECURITY-DEMO.md](SECURITY-DEMO.md).

## Running it

```sh
./scripts/60-sync-testbed.sh     # copy compose/ to /vm/testbed
./scripts/61-testbed-up.sh       # generate PKI on first run, then start
```

See [../docs/TESTPLAN.md](../docs/TESTPLAN.md) for the end-to-end payment test.
