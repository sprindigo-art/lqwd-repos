SUMMARY = "Lightning Network Daemon (prebuilt, cross-compiled outside Yocto)"
DESCRIPTION = "Installs the lnd and lncli aarch64 binaries produced by \
scripts/40-build-lnd.sh, plus the LAN-only configuration, service user and \
sysvinit script. The binaries are static (CGO_ENABLED=0) so this package has \
no runtime library dependencies at all."
HOMEPAGE = "https://github.com/lightningnetwork/lnd"
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://LICENSE;md5=b4aa6d31cf274261de603d41e58accad"

# Pinned upstream release. Keep in sync with scripts/40-build-lnd.sh.
LND_VERSION = "v0.21.3-beta"
LND_SRCREV = "572b561bf05f03dfe6135110970c4d858c3482dc"

# Binaries are staged outside git (they are ~60MB each). LND_ARTIFACTS_DIR is
# set in conf/layer.conf and can be overridden in local.conf.
FILESEXTRAPATHS:prepend := "${LND_ARTIFACTS_DIR}:"

# Per-device provisioning inputs, generated on the build server and kept out
# of git: the bitcoind RPC credentials for the test chain (61-testbed-up.sh)
# and the merchant's own Bitcoin address (64-provision-merchant.sh). Both are
# substituted into lnd.conf below.
LND_SECRETS_DIR ?= "/vm/testbed/secrets"
FILESEXTRAPATHS:prepend := "${LND_SECRETS_DIR}:"

SRC_URI = "file://lnd \
           file://lncli \
           file://LICENSE \
           file://lnd.conf \
           file://lnd.init \
           file://bitcoind-rpc.env \
           file://merchant.env \
"

S = "${WORKDIR}"

COMPATIBLE_MACHINE = "^rpi$"

inherit useradd update-rc.d

USERADD_PACKAGES = "${PN}"
# No login shell, no home directory creation - /data/lnd lives on the data
# partition and is created by the init script at first start.
USERADD_PARAM:${PN} = "--system --home-dir /data/lnd --no-create-home \
                       --shell /sbin/nologin --user-group lnd"

INITSCRIPT_NAME = "lnd"
INITSCRIPT_PARAMS = "defaults 90 10"

do_install() {
    install -d ${D}${bindir}
    install -m 0755 ${WORKDIR}/lnd   ${D}${bindir}/lnd
    install -m 0755 ${WORKDIR}/lncli ${D}${bindir}/lncli

    install -d ${D}${sysconfdir}/lnd
    # Substitute the per-device provisioning values into the config at build
    # time. MERCHANT_ADDRESS becomes both the cooperative-close destination and
    # the only entry in the on-chain send allowlist, so the one address the
    # merchant gave us is the only place this image can ever pay.
    . ${WORKDIR}/bitcoind-rpc.env
    . ${WORKDIR}/merchant.env
    if [ -z "$MERCHANT_ADDRESS" ]; then
        bbfatal "MERCHANT_ADDRESS is empty - run scripts/64-provision-merchant.sh"
    fi
    sed -e "s|@BITCOIND_RPCUSER@|$BITCOIND_RPCUSER|g"         -e "s|@BITCOIND_RPCPASS@|$BITCOIND_RPCPASS|g"         -e "s|@MERCHANT_ADDRESS@|$MERCHANT_ADDRESS|g"         ${WORKDIR}/lnd.conf > ${D}${sysconfdir}/lnd/lnd.conf
    chmod 0640 ${D}${sysconfdir}/lnd/lnd.conf
    if grep -q "@BITCOIND_" ${D}${sysconfdir}/lnd/lnd.conf ||        grep -q "@MERCHANT_" ${D}${sysconfdir}/lnd/lnd.conf; then
        bbfatal "provisioning values were not substituted into lnd.conf"
    fi

    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/lnd.init ${D}${sysconfdir}/init.d/lnd

    # Mountpoint for the data partition (p3). Empty on the rootfs.
    install -d -m 0750 ${D}/data
}

pkg_postinst:${PN}() {
    chown lnd:lnd $D${sysconfdir}/lnd/lnd.conf || true
}

FILES:${PN} += "${sysconfdir}/lnd /data"
CONFFILES:${PN} = "${sysconfdir}/lnd/lnd.conf"

# Prebuilt, already-stripped, statically linked Go binaries: the usual ELF
# QA checks do not apply.
INHIBIT_PACKAGE_STRIP = "1"
INHIBIT_SYSROOT_STRIP = "1"
INHIBIT_PACKAGE_DEBUG_SPLIT = "1"
EXCLUDE_FROM_SHLIBS = "1"
INSANE_SKIP:${PN} += "ldflags textrel already-stripped staticdev buildpaths arch"
RDEPENDS:${PN} = ""
