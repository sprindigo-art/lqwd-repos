#!/bin/sh
# Cross-compile lnd and lncli, OUTSIDE Yocto.
#
#   ./40-build-lnd.sh            -> arm64, for the Raspberry Pi image
#   ./40-build-lnd.sh amd64      -> x86_64, for the server test container
#
# Why outside Yocto: lnd v0.21 pins Go 1.26.6 while Yocto scarthgap ships Go
# 1.22, and lnd does not vendor its modules (a recipe would need network access
# during do_compile, which bitbake forbids by default). Building here with the
# upstream-pinned toolchain also matches how the lnd project builds its own
# release binaries.
#
# CGO_ENABLED=0 gives a fully static binary, so the target needs no libc, no
# OpenSSL and no sqlite library for lnd to run.
#
# Both architectures come from the same source tree and the same flags, so the
# two ends of the test channel run identical lnd code.
. "$(dirname "$0")/env.sh"

ARCH="${1:-arm64}"
case "$ARCH" in
    arm64) OUT="$LND_ARTIFACTS_DIR" ;;
    amd64) OUT="$YOCTO_ROOT/artifacts/lnd-amd64" ;;
    *) echo "usage: $0 [arm64|amd64]" >&2; exit 1 ;;
esac

mkdir -p "$TOOLCHAIN_DIR" "$OUT" "$(dirname "$LND_SRC_DIR")"

# --- Go toolchain, pinned and checksummed (see env.sh) ------------------
ensure_go
go version

# --- lnd source, pinned to a release tag --------------------------------
if [ ! -d "$LND_SRC_DIR/.git" ]; then
    say "Cloning lnd $LND_VERSION"
    git clone -q --depth 1 --branch "$LND_VERSION" \
        https://github.com/lightningnetwork/lnd.git "$LND_SRC_DIR"
else
    say "lnd checkout present"
    git -C "$LND_SRC_DIR" fetch -q --depth 1 origin "refs/tags/$LND_VERSION"
    git -C "$LND_SRC_DIR" checkout -q "$LND_VERSION"
fi

# Start from pristine upstream every time. The patches below are applied to a
# clean tree, so a rebuild cannot end up with them applied twice, half applied,
# or silently skipped because a previous run left the tree dirty.
git -C "$LND_SRC_DIR" reset -q --hard "$LND_VERSION"
git -C "$LND_SRC_DIR" clean -qfd

# --- local hardening patches -------------------------------------------
# These are the security layer, not a fork: an on-chain destination allowlist
# and a gRPC deny list, both enforced below the macaroon layer. See
# security/README.md.
say "Applying hardening patches from $LND_PATCHES_DIR"
patch_count=0
for patch in "$LND_PATCHES_DIR"/*.patch; do
    [ -f "$patch" ] || continue
    echo "  $(basename "$patch")"
    git -C "$LND_SRC_DIR" apply --whitespace=nowarn "$patch" || {
        echo "ERROR: $patch does not apply to lnd $LND_VERSION." >&2
        echo "It was written against that tag - rebase it before bumping." >&2
        exit 1
    }
    patch_count=$((patch_count + 1))
done
if [ "$patch_count" -eq 0 ]; then
    echo "ERROR: no patches found in $LND_PATCHES_DIR." >&2
    echo "The hardened build is not optional - refusing to build lnd" >&2
    echo "without it. Set LND_PATCHES_DIR if the layout moved." >&2
    exit 1
fi
say "$patch_count patch(es) applied"

# Fail early and loudly if the patch applied but did not bring the security
# package with it: a build without it would look completely normal and simply
# ignore every [security] setting in lnd.conf.
[ -f "$LND_SRC_DIR/security/policy.go" ] || {
    echo "ERROR: security/policy.go is missing after patching." >&2
    exit 1
}

cd "$LND_SRC_DIR"
COMMIT="$(git describe --tags)$LND_BUILD_SUFFIX"
HASH=$(git rev-parse HEAD)
GOVER=$(go version | sed -nre 's/^[^0-9]*(([0-9]+\.)*[0-9]+).*/\1/p')
RAWTAGS=$(echo "$LND_BUILD_TAGS" | tr ' ' ',')

P=github.com/lightningnetwork/lnd/build
LDFLAGS="-s -w -X $P.Commit=$COMMIT -X $P.CommitHash=$HASH -X $P.GoVersion=$GOVER -X $P.RawTags=$RAWTAGS"

export GOOS=linux GOARCH="$ARCH" CGO_ENABLED=0

# Cheap, and the one place the allowlist logic is checked directly rather
# than through a running node. Tests run on the host, not the target.
say "Testing the hardening patches"
GOARCH=amd64 go test ./security/...

say "Building lnd $COMMIT for $GOOS/$GOARCH"
say "tags: $LND_BUILD_TAGS"
go build -trimpath -ldflags "$LDFLAGS" -tags "$LND_BUILD_TAGS" -o "$OUT/lnd" ./cmd/lnd

say "Building lncli"
go build -trimpath -ldflags "$LDFLAGS" -tags "$LND_BUILD_TAGS" -o "$OUT/lncli" ./cmd/lncli

# The lnd-bin recipe's LIC_FILES_CHKSUM points at this.
cp LICENSE "$OUT/LICENSE"

cd "$OUT"
sha256sum lnd lncli > SHA256SUMS
say "Artifacts in $OUT"
file lnd lncli
cat SHA256SUMS

# A dynamically linked binary means CGO crept back in and the target would need
# matching libraries.
if file lnd | grep -q "dynamically linked"; then
    echo "ERROR: lnd is dynamically linked - expected a static binary." >&2
    exit 1
fi
