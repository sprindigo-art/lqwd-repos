#!/bin/bash
# Create the bitbake build directory and install our conf templates.
# bash, not sh: poky's oe-init-build-env uses BASH_SOURCE.
# Safe to re-run: existing conf files are backed up, not clobbered.
. "$(dirname "$0")/env.sh"

[ -d "$POKY_DIR" ] || { echo "poky missing - run 10-fetch-layers.sh first" >&2; exit 1; }

say "Initialising build dir at $BUILD_DIR"
# oe-init-build-env writes conf/ defaults and drops us in the build dir.
# shellcheck disable=SC1090
# oe-init-build-env is not written to survive 'set -u' (it reads
# BBSERVER and friends unconditionally), so relax it just for this.
set +u
. "$POKY_DIR/oe-init-build-env" "$BUILD_DIR" >/dev/null
set -u

for f in local.conf bblayers.conf; do
    src="$REPO_ROOT/conf-templates/$f.sample"
    dst="$BUILD_DIR/conf/$f"
    if [ -f "$dst" ] && ! cmp -s "$src" "$dst"; then
        cp "$dst" "$dst.bak.$(date +%Y%m%d%H%M%S)"
        say "Backed up existing $f"
    fi
    sed "s#@YOCTO_ROOT@#$YOCTO_ROOT#g" "$src" > "$dst"
    say "Installed $f"
done

say "Build dir ready: $BUILD_DIR"
