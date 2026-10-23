#!/bin/bash
# Deploy the testbed compose stack to /vm/testbed, same pull-then-copy model as
# the Yocto layer. Also stages the amd64 lnd binaries into the build context.
#
# The server node is x86_64: the Pi image gets the aarch64 build, this gets the
# amd64 build, both from the same lnd commit.
. "$(dirname "$0")/env.sh"

TESTBED_ROOT="${TESTBED_ROOT:-/vm/testbed}"
COMPOSE_DIR="$TESTBED_ROOT/compose"
LND_AMD64="$YOCTO_ROOT/artifacts/lnd-amd64"
LNDK_AMD64="$YOCTO_ROOT/artifacts/lndk-amd64"
LNURLPD_AMD64="$YOCTO_ROOT/artifacts/lnurlpd-amd64"

# All three daemons the appliance runs go into the container image, so the
# testbed exercises the same code the Pi does.
[ -f "$LND_AMD64/lnd" ] || {
    echo "No amd64 lnd at $LND_AMD64 - run: ./scripts/40-build-lnd.sh amd64" >&2
    exit 1
}
[ -f "$LNDK_AMD64/lndk" ] || {
    echo "No amd64 lndk at $LNDK_AMD64 - run: ./scripts/41-build-lndk.sh amd64" >&2
    exit 1
}
[ -f "$LNURLPD_AMD64/lnurlpd" ] || {
    echo "No amd64 lnurlpd at $LNURLPD_AMD64 - run: ./scripts/42-build-lnurlpd.sh amd64" >&2
    exit 1
}

say "Creating $TESTBED_ROOT"
# /vm is owned by lqwd and not writable by tester, so this one mkdir needs sudo.
sudo install -d -o "$(id -u -n)" -g "$(id -g -n)" \
    "$TESTBED_ROOT" "$COMPOSE_DIR" \
    "$TESTBED_ROOT/vpn" "$TESTBED_ROOT/vpn/pki" "$TESTBED_ROOT/vpn/ccd" \
    "$TESTBED_ROOT/vpn/clients" "$TESTBED_ROOT/lnd" \
    "$TESTBED_ROOT/lnd-merchant" \
    "$TESTBED_ROOT/lndk-gateway" "$TESTBED_ROOT/lndk-merchant" \
    "$TESTBED_ROOT/lnurl-gateway" \
    "$TESTBED_ROOT/bitcoind" "$TESTBED_ROOT/secrets"

# docker compose reads every env_file when it loads the project, whether or not
# the service using it is being started, so this has to exist before anything
# runs. 64-provision-merchant.sh fills in the address; an empty value here
# stops the merchant node from starting rather than starting it unhardened.
MERCHANT_ENV="$TESTBED_ROOT/secrets/merchant.env"
if [ ! -f "$MERCHANT_ENV" ]; then
    say "Creating an empty $MERCHANT_ENV"
    {
        echo "MERCHANT_ADDRESS="
        echo "LNURL_BASE_URL="
        echo "LNURL_NAME="
    } > "$MERCHANT_ENV"
    chmod 600 "$MERCHANT_ENV"
fi

say "Syncing testbed -> $COMPOSE_DIR"
# --delete would wipe .env and lnd/bin, which are generated here, so exclude them.
rsync -a --delete --exclude '.env' --exclude 'lnd/bin' \
      "$REPO_ROOT/testbed/" "$COMPOSE_DIR/"

say "Staging amd64 binaries into the build context"
mkdir -p "$COMPOSE_DIR/lnd/bin"
cp "$LND_AMD64/lnd" "$LND_AMD64/lncli" "$COMPOSE_DIR/lnd/bin/"
cp "$LNDK_AMD64/lndk" "$LNDK_AMD64/lndk-cli" "$COMPOSE_DIR/lnd/bin/"
cp "$LNURLPD_AMD64/lnurlpd" "$COMPOSE_DIR/lnd/bin/"
file "$COMPOSE_DIR/lnd/bin/"*

if [ ! -f "$COMPOSE_DIR/.env" ]; then
    cp "$COMPOSE_DIR/.env.sample" "$COMPOSE_DIR/.env"
    say "Created $COMPOSE_DIR/.env from the sample - review it"
else
    say ".env already present, left alone"
fi

say "Testbed staged at $COMPOSE_DIR"
