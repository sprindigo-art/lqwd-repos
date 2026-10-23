SUMMARY = "LNURL-pay endpoint for the lnd appliance"
DESCRIPTION = "Installs lnurlpd, the LNURL-pay daemon built from lnurlpd/ in \
this repository, plus its service user and sysvinit script. It serves LUD-06, \
LUD-16, LUD-12 and LUD-21 on the VPN address only: the public URL belongs to \
the gateway, which reverse-proxies to this over the tunnel the device dialled \
out. The binary is static (CGO_ENABLED=0) with no dependencies outside Go's \
standard library."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

# Built by scripts/42-build-lnurlpd.sh and staged outside git.
LNURLPD_ARTIFACTS_DIR ?= "/vm/yocto/artifacts/lnurlpd"
FILESEXTRAPATHS:prepend := "${LNURLPD_ARTIFACTS_DIR}:"

# The merchant's provisioning input, generated on the build server and kept
# out of git. LNURL_BASE_URL is the public endpoint the gateway serves for
# this merchant; LNURL_NAME is the username half of their lightning address.
LND_SECRETS_DIR ?= "/vm/testbed/secrets"
FILESEXTRAPATHS:prepend := "${LND_SECRETS_DIR}:"

SRC_URI = "file://lnurlpd \
           file://lnurlpd.init \
           file://lnurlpd-run \
           file://lnurlpd.default \
           file://merchant.env \
"

S = "${WORKDIR}"

COMPATIBLE_MACHINE = "^rpi$"

inherit useradd update-rc.d

USERADD_PACKAGES = "${PN}"
# Its own user, not lnd's. lnurlpd holds the INVOICE macaroon and needs to
# hold nothing else; sharing lnd's uid would give the one process anything
# outside can reach read access to the admin macaroon as well.
USERADD_PARAM:${PN} = "--system --home-dir /data/lnurlpd --no-create-home \
                       --shell /sbin/nologin --user-group lnurlpd"

INITSCRIPT_NAME = "lnurlpd"
# After lnd (90). It waits for lnd to be usable anyway, but there is no reason
# to start it first.
INITSCRIPT_PARAMS = "defaults 92 08"

RDEPENDS:${PN} = "lnd-bin"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/lnurlpd ${D}${bindir}/lnurlpd

    install -d ${D}${libexecdir}
    install -m 0755 ${WORKDIR}/lnurlpd-run ${D}${libexecdir}/lnurlpd-run

    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/lnurlpd.init ${D}${sysconfdir}/init.d/lnurlpd

    # The public URL is per-merchant provisioning, not a default, so it is
    # substituted at build time the same way the settlement address is.
    . ${WORKDIR}/merchant.env
    if [ -z "${LNURL_BASE_URL:-}" ]; then
        bbfatal "LNURL_BASE_URL is empty - run scripts/64-provision-merchant.sh"
    fi
    install -d ${D}${sysconfdir}/default
    sed -e "s|@LNURL_BASE_URL@|$LNURL_BASE_URL|g" \
        -e "s|@LNURL_NAME@|${LNURL_NAME:-merchant}|g" \
        ${WORKDIR}/lnurlpd.default > ${D}${sysconfdir}/default/lnurlpd
    chmod 0644 ${D}${sysconfdir}/default/lnurlpd
    if grep -q "@LNURL_" ${D}${sysconfdir}/default/lnurlpd; then
        bbfatal "provisioning values were not substituted into lnurlpd.default"
    fi
}

FILES:${PN} += "${libexecdir}/lnurlpd-run"
CONFFILES:${PN} = "${sysconfdir}/default/lnurlpd"

# A prebuilt, already-stripped, statically linked Go binary: the usual ELF QA
# checks do not apply.
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_SYSROOT_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
EXCLUDE_FROM_SHLIBS = "1"
INSANE_SKIP:${PN} += "ldflags textrel already-stripped staticdev buildpaths arch"
