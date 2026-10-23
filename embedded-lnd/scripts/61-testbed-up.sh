#!/bin/bash
# Build and start the testbed: openvpn, regtest bitcoind, the block miner and
# lnd-server. First run generates the VPN PKI and the bitcoind RPC credential.
. "$(dirname "$0")/env.sh"

TESTBED_ROOT="${TESTBED_ROOT:-/vm/testbed}"
COMPOSE_DIR="$TESTBED_ROOT/compose"
SECRETS="$TESTBED_ROOT/secrets/bitcoind-rpc.env"

# bitcoind RPC credential. Generated once here and shared by lnd-server (via
# the environment) and the Pi (substituted into lnd.conf at bake time), so it
# never has to live in git.
if [ ! -f "$SECRETS" ]; then
    say "Generating bitcoind RPC credentials"
    mkdir -p "$(dirname "$SECRETS")"
    {
        echo "BITCOIND_RPCUSER=lnd"
        echo "BITCOIND_RPCPASS=$(head -c 24 /dev/urandom | base64 | tr -d '\n/+=')"
    } > "$SECRETS"
    chmod 600 "$SECRETS"
else
    say "Reusing existing bitcoind RPC credentials"
fi

# lnd auto-unlocks from these files, one per test node. Generated once here,
# never committed.
for PWFILE in "$TESTBED_ROOT/lnd/wallet-password" \
              "$TESTBED_ROOT/lnd-merchant/wallet-password"; do
    if [ ! -f "$PWFILE" ]; then
        say "Generating lnd wallet password: $PWFILE"
        mkdir -p "$(dirname "$PWFILE")"
        head -c 32 /dev/urandom | base64 | tr -d '\n' > "$PWFILE"
        chmod 600 "$PWFILE"
    fi
done

# The gateway's public TLS certificate.
#
# LNURL is https only - a wallet will not fetch a payRequest over plain http -
# so the testbed terminates real TLS at the gateway rather than pretending.
# Self-signed and local: pay.testbed.local resolves nowhere, and the demo
# script passes this certificate as the payer's trust root.
GW_TLS="$TESTBED_ROOT/lnurl-gateway"
if [ ! -f "$GW_TLS/gateway.crt" ]; then
    say "Generating the gateway certificate for pay.testbed.local"
    mkdir -p "$GW_TLS"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650         -subj "/CN=pay.testbed.local"         -addext "subjectAltName=DNS:pay.testbed.local"         -keyout "$GW_TLS/gateway.key" -out "$GW_TLS/gateway.crt" 2>/dev/null
    chmod 644 "$GW_TLS/gateway.crt"
    chmod 640 "$GW_TLS/gateway.key"
else
    say "Reusing the existing gateway certificate"
fi

cd "$COMPOSE_DIR"

say "Building images"
docker compose build

say "Starting openvpn"
docker compose up -d openvpn

# tun0 lives inside the container, NOT on the host - check it there.
say "Waiting for tun0 / 10.99.0.1 inside the openvpn container"
for i in $(seq 1 60); do
    docker exec lnd-testbed-vpn ip -4 addr show 2>/dev/null | grep -qw 10.99.0.1 && break
    [ "$i" = 60 ] && { echo "tun0 never came up; docker compose logs openvpn" >&2; exit 1; }
    sleep 1
done
say "VPN up inside container:"
docker exec lnd-testbed-vpn ip -4 -br addr show tun0

say "Starting bitcoind, miner and lnd-server"
docker compose up -d

# The container writes these as root 0600. bitbake runs as the build user and
# has to read rpi.ovpn to bake it into the image.
say "Fixing client config ownership so the image build can read them"
sudo chown "$(id -u -n):$(id -g -n)" "$TESTBED_ROOT"/vpn/clients/*.ovpn
sudo chmod 640 "$TESTBED_ROOT"/vpn/clients/*.ovpn

say "Client configs"
ls -la "$TESTBED_ROOT/vpn/clients/"

say "Status"
docker compose ps
