SUMMARY = "Minimal LAN-only Raspberry Pi 4 image running lnd"
DESCRIPTION = "A headless appliance image: BusyBox userland, dropbear bound to \
the LAN address, a default-deny firewall, and lnd with its data on a separate \
partition. No package manager, no compilers, no shells beyond BusyBox ash."
LICENSE = "MIT"

inherit core-image

# Start from nothing rather than subtracting from core-image-base.
CORE_IMAGE_BASE_INSTALL = ""
CORE_IMAGE_EXTRA_INSTALL = ""

IMAGE_INSTALL = "\
    packagegroup-core-boot \
    dropbear \
    iptables \
    kernel-modules \
    lnd-bin \
    lndk-bin \
    lnurlpd \
    openvpn \
    openvpn-client-config \
    embedded-lnd-timesync \
    embedded-lnd-firewall \
    embedded-lnd-ssh-keys \
"

# No debug-tweaks: that would set an empty root password for SSH too.
# empty-root-password applies to the SERIAL CONSOLE, which needs physical
# access to the board. It is the recovery path if the SSH key is lost.
# Remove it for production - see docs/HARDENING.md.
IMAGE_FEATURES = "empty-root-password"

IMAGE_LINGUAS = ""

# Room for lnd's neutrino filter headers and the sqlite database is on the
# data partition, so the rootfs only needs slack for logs.
IMAGE_ROOTFS_EXTRA_SPACE = "16384"

# Fail loudly if the rootfs outgrows the fixed 1024M partition in the .wks,
# rather than producing an image that silently will not flash.
IMAGE_ROOTFS_MAXSIZE = "1000000"

# Nothing on the device compiles or installs software.
IMAGE_INSTALL:remove = "packagegroup-core-full-cmdline"
