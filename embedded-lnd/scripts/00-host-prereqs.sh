#!/bin/sh
# Install the Yocto build-host packages. Ubuntu 24.04. Needs sudo.
. "$(dirname "$0")/env.sh"

say "Installing Yocto host dependencies"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y -qq \
    gawk wget git diffstat unzip texinfo gcc build-essential chrpath socat \
    cpio python3 python3-pip python3-pexpect xz-utils debianutils \
    iputils-ping python3-git python3-jinja2 python3-subunit zstd \
    liblz4-tool file locales libacl1 rsync bmap-tools

# Not Yocto: the toolchain lndk needs. protoc builds its gRPC stubs (>= 3.12,
# for --experimental_allow_proto3_optional); the cross compilers build ring,
# its one dependency with C in it. Rust itself is fetched and checksummed by
# 41-build-lndk.sh, not installed from apt - the distro's is too old.
say "Installing the lndk cross-build toolchain"
sudo apt-get install -y -qq \
    protobuf-compiler gcc-aarch64-linux-gnu musl-tools

sudo locale-gen en_US.UTF-8

say "Creating $YOCTO_ROOT"
sudo install -d -o "$(id -u -n)" -g "$(id -g -n)" "$YOCTO_ROOT" "$LAYERS_DIR"

say "Host prerequisites done"
