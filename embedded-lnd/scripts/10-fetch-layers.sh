#!/bin/sh
# Clone poky and the BSP layers.
#
# NOTE: this server blocks the git:// protocol (port 9418). All clones must
# use https://.
. "$(dirname "$0")/env.sh"

clone() {
    url="$1"; dest="$2"
    if [ -d "$dest/.git" ]; then
        say "$dest already present, fetching"
        git -C "$dest" fetch --quiet origin "$YOCTO_BRANCH"
    else
        say "Cloning $url -> $dest"
        git clone -q -b "$YOCTO_BRANCH" --single-branch "$url" "$dest"
    fi
}

mkdir -p "$LAYERS_DIR"
clone https://git.yoctoproject.org/poky            "$POKY_DIR"
clone https://git.yoctoproject.org/meta-raspberrypi "$LAYERS_DIR/meta-raspberrypi"
clone https://git.openembedded.org/meta-openembedded "$LAYERS_DIR/meta-openembedded"

say "Layers ready"
du -sh "$POKY_DIR" "$LAYERS_DIR"/*
