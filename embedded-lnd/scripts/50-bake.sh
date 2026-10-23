#!/bin/bash
# Build the image. Assumes 00..40 have been run.
# bash, not sh: poky's oe-init-build-env uses BASH_SOURCE.
#
# Usage: ./50-bake.sh [bitbake target]
. "$(dirname "$0")/env.sh"

target="${1:-$IMAGE_TARGET}"

[ -f "$LND_ARTIFACTS_DIR/lnd" ] || {
    echo "No lnd binary at $LND_ARTIFACTS_DIR - run 40-build-lnd.sh first" >&2
    exit 1
}
[ -f "$LNDK_ARTIFACTS_DIR/lndk" ] || {
    echo "No lndk binary at $LNDK_ARTIFACTS_DIR - run 41-build-lndk.sh first" >&2
    exit 1
}
[ -f "$LNURLPD_ARTIFACTS_DIR/lnurlpd" ] || {
    echo "No lnurlpd at $LNURLPD_ARTIFACTS_DIR - run 42-build-lnurlpd.sh first" >&2
    exit 1
}

# shellcheck disable=SC1090
# oe-init-build-env is not written to survive 'set -u' (it reads
# BBSERVER and friends unconditionally), so relax it just for this.
set +u
. "$POKY_DIR/oe-init-build-env" "$BUILD_DIR" >/dev/null
set -u

say "Baking $target for $MACHINE_TARGET"
bitbake "$target"

say "Output"
ls -la "$BUILD_DIR/tmp/deploy/images/$MACHINE_TARGET/" | grep -E "wic|manifest" || true
