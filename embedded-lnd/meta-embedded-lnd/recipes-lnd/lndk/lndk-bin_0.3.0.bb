SUMMARY = "lndk - BOLT 12 offers for lnd (prebuilt, cross-compiled outside Yocto)"
DESCRIPTION = "Installs the lndk and lndk-cli aarch64 binaries produced by \
scripts/41-build-lndk.sh, plus a sysvinit script that waits for lnd to be \
unlocked before starting. lnd carries onion messages but has no offers RPC: \
the offer, the invoice_request and the BOLT 12 invoice are all lndk's."
HOMEPAGE = "https://github.com/lndk-org/lndk"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE;md5=cb50d72db4696e2e34bcc1b71e5d8134"

# Pinned revision. Keep in sync with scripts/env.sh, which is where the reason
# for a branch rather than a release tag is written down: released lndk reads
# onion messages off the custom-message stream, and lnd v0.21 handles message
# 513 natively and no longer puts them there.
LNDK_VERSION = "v0.3.0+native-onion-messages"
LNDK_SRCREV = "dc75e34215e6d57f8c3e0d7b49367988366f06be"

# Built by scripts/41-build-lndk.sh and staged outside git.
LNDK_ARTIFACTS_DIR ?= "/vm/yocto/artifacts/lndk"
FILESEXTRAPATHS:prepend := "${LNDK_ARTIFACTS_DIR}:"

SRC_URI = "file://lndk \
           file://lndk-cli \
           file://LICENSE \
           file://lndk.init \
           file://lndk-run \
           file://lndk.default \
"

S = "${WORKDIR}"

COMPATIBLE_MACHINE = "^rpi$"

inherit update-rc.d

INITSCRIPT_NAME = "lndk"
# After lnd (90). It waits for lnd to be unlocked anyway, but there is no
# reason to start it first.
INITSCRIPT_PARAMS = "defaults 91 09"

# No user of its own: lndk runs as lnd, because it holds lnd's admin macaroon.
# See lndk-run for why, and what bounds it instead.
#
# Unlike lnd and lnurlpd this is not a static binary - Rust against glibc -
# so it needs the C runtime the image already carries for dropbear, openvpn
# and iptables.
RDEPENDS:${PN} = "lnd-bin libgcc"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/lndk     ${D}${bindir}/lndk
    install -m 0755 ${WORKDIR}/lndk-cli ${D}${bindir}/lndk-cli

    install -d ${D}${libexecdir}
    install -m 0755 ${WORKDIR}/lndk-run ${D}${libexecdir}/lndk-run

    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/lndk.init ${D}${sysconfdir}/init.d/lndk

    install -d ${D}${sysconfdir}/default
    install -m 0644 ${WORKDIR}/lndk.default ${D}${sysconfdir}/default/lndk
}

FILES:${PN} += "${libexecdir}/lndk-run"
CONFFILES:${PN} = "${sysconfdir}/default/lndk"

# Prebuilt and already stripped outside Yocto.
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_SYSROOT_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
INSANE_SKIP:${PN} += "ldflags already-stripped buildpaths"
