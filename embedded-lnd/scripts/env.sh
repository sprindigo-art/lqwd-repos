# Shared settings. Sourced by every script here.
#
# Nothing under YOCTO_ROOT is in git: poky, the layers, the Go toolchain, the
# lnd source checkout, the built binaries and the build output are all far too
# large. Only this repository is versioned; it is copied into the Yocto
# workspace by 30-sync-layer.sh.

set -eu

# Where the Yocto workspace lives on the build server. Must be on /vm - a
# full build needs ~100GB and / only has ~40GB free.
YOCTO_ROOT="${YOCTO_ROOT:-/vm/yocto}"

# This git checkout.
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

POKY_DIR="$YOCTO_ROOT/poky"
LAYERS_DIR="$YOCTO_ROOT/layers"
BUILD_DIR="$YOCTO_ROOT/build"
LAYER_DEST="$YOCTO_ROOT/meta-embedded-lnd"

# Pinned versions.
YOCTO_BRANCH="scarthgap"          # 5.0 LTS, supports Ubuntu 24.04
GO_VERSION="1.26.6"               # required by lnd v0.21.x (see its Makefile)
GO_SHA256="708effb774be8237570d0add163225abbdfaf4fca28b2611df167beba4feef89"
LND_VERSION="v0.21.3-beta"

# Local hardening patches, applied to the pristine lnd source before it is
# built. See security/README.md for what they do and why they are patches
# rather than configuration.
LND_PATCHES_DIR="${LND_PATCHES_DIR:-$REPO_ROOT/security/patches}"

# Appended to the commit string baked into the binary, so that `lncli getinfo`
# on a device tells you whether it is running the hardened build.
LND_BUILD_SUFFIX="+lqwd-hardened"

# lnd build tags. Trimmed from upstream RELEASE_TAGS: dropped autopilotrpc,
# watchtowerrpc, neutrinorpc, monitoring (prometheus listener), kvdb_postgres
# and kvdb_etcd. Kept kvdb_sqlite - the embedded database, no daemon.
LND_BUILD_TAGS="signrpc walletrpc chainrpc invoicesrpc peersrpc kvdb_sqlite"

# --- Rust, for lndk -----------------------------------------------------
# Pinned the same way Go is: a checksummed tarball from static.rust-lang.org,
# no rustup. 1.88 is what lndk's own Dockerfile builds with.
RUST_VERSION="1.88.0"
RUST_SHA256="7b5437c1d18a174faae253a18eac22c32288dccfc09ff78d5ee99b7467e21bca"

# lndk gives lnd BOLT 12 offers. lnd v0.21 handles onion messages natively and
# no longer reports them as custom messages, which is the transport released
# lndk v0.3.0 uses - so it is pinned to the upstream branch that adds the
# native SendOnionMessage/SubscribeOnionMessages path (lndk PR #266). Move this
# to a release tag once that merges.
LNDK_REPO="${LNDK_REPO:-https://github.com/Alex71btc/lndk.git}"
LNDK_BRANCH="${LNDK_BRANCH:-feat/native-onion-messages}"
LNDK_REV="${LNDK_REV:-dc75e34215e6d57f8c3e0d7b49367988366f06be}"
LNDK_VERSION="v0.3.0+native-onion-messages"

# Rust target per architecture, and the sha256 of its rust-std tarball.
#
#   arm64  the Pi image, which is glibc (poky). Ubuntu 24.04 and scarthgap are
#          both on glibc 2.39, so a plain gnu cross build runs there as is.
#   amd64  the testbed container, which is Alpine - musl, statically linked.
#
# Same source and same revision either way; only the libc differs.
RUST_TARGET_arm64="aarch64-unknown-linux-gnu"
RUST_TARGET_amd64="x86_64-unknown-linux-musl"
RUST_STD_SHA256_arm64="e9ac4ff3c87247a2195fcceddbf1bdeee5c4fd337f014d8f4c4e3ac99002021f"
RUST_STD_SHA256_amd64="0c42b63c18a6343851e0f27aeb5cff73146c86fc95bc4e2bf51b726c4311249e"

TOOLCHAIN_DIR="$YOCTO_ROOT/toolchain"
LND_SRC_DIR="$YOCTO_ROOT/src/lnd"
LND_ARTIFACTS_DIR="$YOCTO_ROOT/artifacts/lnd"
LNDK_SRC_DIR="$YOCTO_ROOT/src/lndk"
LNDK_ARTIFACTS_DIR="$YOCTO_ROOT/artifacts/lndk"
LNURLPD_ARTIFACTS_DIR="$YOCTO_ROOT/artifacts/lnurlpd"

MACHINE_TARGET="raspberrypi4-64"
IMAGE_TARGET="embedded-lnd-image"

say() { printf '\n=== %s\n' "$*"; }

# Fetch the pinned Go toolchain into TOOLCHAIN_DIR and put it on PATH. Used by
# 40-build-lnd.sh and 42-build-lnurlpd.sh, which build different things with
# the same compiler.
ensure_go() {
    if [ ! -x "$TOOLCHAIN_DIR/go/bin/go" ]; then
        say "Fetching Go $GO_VERSION"
        mkdir -p "$TOOLCHAIN_DIR"
        tgz="$TOOLCHAIN_DIR/go.tgz"
        curl -sSLo "$tgz" "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz"
        echo "$GO_SHA256  $tgz" | sha256sum -c -
        rm -rf "$TOOLCHAIN_DIR/go"
        tar -C "$TOOLCHAIN_DIR" -xf "$tgz"
        rm -f "$tgz"
    fi

    export PATH="$TOOLCHAIN_DIR/go/bin:$PATH"
    export GOPATH="$TOOLCHAIN_DIR/gopath"
    export GOMODCACHE="$TOOLCHAIN_DIR/gomodcache"
    export GOCACHE="$TOOLCHAIN_DIR/gocache"
}
