#!/bin/sh
# Cross-compile lndk and lndk-cli, OUTSIDE Yocto - same model as 40-build-lnd.sh.
#
#   ./41-build-lndk.sh            -> arm64, for the Raspberry Pi image
#   ./41-build-lndk.sh amd64      -> x86_64, for the server test containers
#
# lndk is the BOLT 12 layer. lnd speaks onion messages but has no offers RPC,
# so the offer, the invoice_request and the BOLT 12 invoice are all lndk's;
# lnd is the transport and the signer underneath it.
#
# Why a branch and not a release tag: lnd v0.21 handles onion messages
# natively and no longer reports them on the custom-message stream, which is
# the transport released lndk v0.3.0 uses. LNDK_REV pins the upstream branch
# that adds the native SendOnionMessage/SubscribeOnionMessages path. See
# env.sh, and docs/BOLT12.md for what that means for us.
#
# Two libcs, one source revision:
#
#   arm64   aarch64-unknown-linux-gnu. The Pi image is glibc, and Ubuntu 24.04
#           and scarthgap are both on 2.39, so this runs there unmodified.
#   amd64   x86_64-unknown-linux-musl, statically linked, because the testbed
#           lnd container is Alpine.
#
# Unlike lnd, this is NOT a static binary on arm64. The image already carries
# glibc for dropbear, openvpn and iptables, so that costs nothing new.
. "$(dirname "$0")/env.sh"

ARCH="${1:-arm64}"
case "$ARCH" in
    arm64) OUT="$LNDK_ARTIFACTS_DIR" ;;
    amd64) OUT="$YOCTO_ROOT/artifacts/lndk-amd64" ;;
    *) echo "usage: $0 [arm64|amd64]" >&2; exit 1 ;;
esac
eval "TARGET=\$RUST_TARGET_$ARCH"
eval "STD_SHA256=\$RUST_STD_SHA256_$ARCH"

RUST_DIR="$TOOLCHAIN_DIR/rust"
HOST_TRIPLE="x86_64-unknown-linux-gnu"

mkdir -p "$TOOLCHAIN_DIR" "$OUT" "$(dirname "$LNDK_SRC_DIR")"

# --- host prerequisites -------------------------------------------------
# protoc builds lndk's gRPC stubs, and lndk needs >= 3.12 for
# --experimental_allow_proto3_optional. The cross compiler is for ring, the
# one dependency with C in it.
need() {
    command -v "$1" >/dev/null 2>&1 || {
        echo "ERROR: $1 not found - run ./scripts/00-host-prereqs.sh" >&2
        exit 1
    }
}
need protoc
case "$ARCH" in
    arm64) need aarch64-linux-gnu-gcc ;;
    amd64) need musl-gcc ;;
esac

# --- Rust toolchain, pinned and checksummed -----------------------------
# Tarballs from static.rust-lang.org rather than rustup: one pinned version,
# one checksum, and nothing that updates itself behind the build.
fetch_rust() {
    tarball="$1"; sha="$2"; components="$3"
    tmp="$TOOLCHAIN_DIR/$tarball"
    say "Fetching $tarball"
    curl -sSLo "$tmp" "https://static.rust-lang.org/dist/$tarball"
    echo "$sha  $tmp" | sha256sum -c -
    rm -rf "$TOOLCHAIN_DIR/rust-unpack"
    mkdir -p "$TOOLCHAIN_DIR/rust-unpack"
    tar -C "$TOOLCHAIN_DIR/rust-unpack" --strip-components=1 -xf "$tmp"
    "$TOOLCHAIN_DIR/rust-unpack/install.sh" \
        --prefix="$RUST_DIR" --components="$components" --disable-ldconfig
    rm -rf "$TOOLCHAIN_DIR/rust-unpack" "$tmp"
}

if [ ! -x "$RUST_DIR/bin/cargo" ]; then
    fetch_rust "rust-$RUST_VERSION-$HOST_TRIPLE.tar.xz" "$RUST_SHA256" \
               "rustc,cargo,rust-std-$HOST_TRIPLE"
fi
if [ ! -d "$RUST_DIR/lib/rustlib/$TARGET" ]; then
    fetch_rust "rust-std-$RUST_VERSION-$TARGET.tar.xz" "$STD_SHA256" \
               "rust-std-$TARGET"
fi

export PATH="$RUST_DIR/bin:$PATH"
export CARGO_HOME="$TOOLCHAIN_DIR/cargo"
export RUSTUP_TOOLCHAIN=""   # ignore any rustup on the host
rustc --version
cargo --version

# The cross compiler for ring's assembly, and the linker for the final binary.
case "$ARCH" in
    arm64)
        export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
        export CC_aarch64_unknown_linux_gnu=aarch64-linux-gnu-gcc
        export AR_aarch64_unknown_linux_gnu=aarch64-linux-gnu-ar
        STRIP=aarch64-linux-gnu-strip
        ;;
    amd64)
        export CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc
        export CC_x86_64_unknown_linux_musl=musl-gcc
        STRIP=strip
        ;;
esac

# --- lndk source, pinned to a revision ----------------------------------
if [ ! -d "$LNDK_SRC_DIR/.git" ]; then
    say "Cloning lndk $LNDK_REPO ($LNDK_BRANCH)"
    git clone -q --branch "$LNDK_BRANCH" "$LNDK_REPO" "$LNDK_SRC_DIR"
else
    say "lndk checkout present"
    git -C "$LNDK_SRC_DIR" fetch -q origin "$LNDK_BRANCH"
fi

git -C "$LNDK_SRC_DIR" checkout -q "$LNDK_REV"
git -C "$LNDK_SRC_DIR" reset -q --hard "$LNDK_REV"
git -C "$LNDK_SRC_DIR" clean -qfd

HEAD_REV=$(git -C "$LNDK_SRC_DIR" rev-parse HEAD)
[ "$HEAD_REV" = "$LNDK_REV" ] || {
    echo "ERROR: lndk checkout is at $HEAD_REV, expected $LNDK_REV" >&2
    exit 1
}

# --- build --------------------------------------------------------------
cd "$LNDK_SRC_DIR"
say "Building lndk $LNDK_VERSION for $TARGET"
cargo build --release --locked --target "$TARGET" --bin lndk --bin lndk-cli

BIN_DIR="$LNDK_SRC_DIR/target/$TARGET/release"
for b in lndk lndk-cli; do
    install -m 0755 "$BIN_DIR/$b" "$OUT/$b"
    "$STRIP" "$OUT/$b" 2>/dev/null || true
done

# lndk is MIT; the recipe's LIC_FILES_CHKSUM points at this copy.
cp LICENSE "$OUT/LICENSE"
printf '%s\n%s\n' "$LNDK_VERSION" "$HEAD_REV" > "$OUT/VERSION"

cd "$OUT"
sha256sum lndk lndk-cli > SHA256SUMS
say "Artifacts in $OUT"
file lndk lndk-cli
cat SHA256SUMS

# A build that picked up the host's OpenSSL would need a matching libssl on
# the target. lndk uses rustls, so there should not be one.
if file lndk | grep -q "dynamically linked" && \
   command -v readelf >/dev/null 2>&1; then
    say "Shared libraries lndk expects on the target"
    readelf -d lndk | grep NEEDED || true
    if readelf -d lndk | grep -q "libssl\|libcrypto"; then
        echo "ERROR: lndk links OpenSSL - the image does not ship it." >&2
        exit 1
    fi
fi
