#!/bin/sh
# Build lnurlpd, the LNURL-pay daemon in this repository.
#
#   ./42-build-lnurlpd.sh            -> arm64, for the Raspberry Pi image
#   ./42-build-lnurlpd.sh amd64      -> x86_64, for the server test containers
#
# Unlike lnd and lndk this is our own code and it lives in git, in ../lnurlpd.
# It has no dependencies outside Go's standard library, so the build needs no
# network at all and there is no module graph to audit.
#
# CGO_ENABLED=0, like lnd: a static binary, nothing to link against on target.
. "$(dirname "$0")/env.sh"

ARCH="${1:-arm64}"
case "$ARCH" in
    arm64) OUT="$LNURLPD_ARTIFACTS_DIR" ;;
    amd64) OUT="$YOCTO_ROOT/artifacts/lnurlpd-amd64" ;;
    *) echo "usage: $0 [arm64|amd64]" >&2; exit 1 ;;
esac

SRC="$REPO_ROOT/lnurlpd"
[ -f "$SRC/go.mod" ] || { echo "no Go module at $SRC" >&2; exit 1; }

mkdir -p "$OUT"
ensure_go
go version

cd "$SRC"

# The LNURL bech32 encoding and the description hash are both protocol
# surface: get either wrong and every wallet refuses the invoice, with no
# error the device would ever see. Tests run on the host, not the target.
say "Testing lnurlpd"
go vet ./...
GOARCH=amd64 go test ./...

VERSION="$(git -C "$REPO_ROOT" describe --always --dirty 2>/dev/null || echo unknown)"
export GOOS=linux GOARCH="$ARCH" CGO_ENABLED=0

say "Building lnurlpd $VERSION for $GOOS/$GOARCH"
go build -trimpath -ldflags "-s -w -X main.version=$VERSION" -o "$OUT/lnurlpd" .

cd "$OUT"
sha256sum lnurlpd > SHA256SUMS
say "Artifacts in $OUT"
file lnurlpd
cat SHA256SUMS

if file lnurlpd | grep -q "dynamically linked"; then
    echo "ERROR: lnurlpd is dynamically linked - expected a static binary." >&2
    exit 1
fi
