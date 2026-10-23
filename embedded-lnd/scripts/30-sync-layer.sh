#!/bin/sh
# Copy meta-embedded-lnd from this git checkout into the Yocto workspace.
#
# This is the deploy step: on the build server you 'git pull' this repo and
# then run this script. The Yocto workspace itself is never a git checkout.
. "$(dirname "$0")/env.sh"

say "Syncing $REPO_ROOT/meta-embedded-lnd -> $LAYER_DEST"
rsync -a --delete \
      --exclude '.git' \
      "$REPO_ROOT/meta-embedded-lnd/" "$LAYER_DEST/"

# The .wks lives in the layer; wic finds it through WKS_SEARCH_PATH, which
# includes each layer's wic/ directory automatically.
say "Layer synced"
find "$LAYER_DEST" -type f | sed "s#$LAYER_DEST/##" | sort
