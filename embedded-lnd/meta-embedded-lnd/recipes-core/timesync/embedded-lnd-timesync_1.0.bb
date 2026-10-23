SUMMARY = "NTP time synchronisation for the lnd appliance"
DESCRIPTION = "The Raspberry Pi 4 has no battery-backed clock. Without this \
the board boots with the rootfs build timestamp (2018), OpenVPN rejects the \
server certificate as not-yet-valid, and lnd mints TLS material with a wrong \
date. Runs a blocking one-shot sync before the VPN starts, then keeps busybox \
ntpd running to discipline drift."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://timesync.init \
           file://timesync.default \
"
S = "${WORKDIR}"

inherit update-rc.d

INITSCRIPT_NAME = "timesync"
# Runlevel 2, order 05: after networking (01) and before openvpn (10). The
# tunnel must not be attempted until the clock is right.
INITSCRIPT_PARAMS = "start 05 2 3 4 5 . stop 71 0 1 6 ."

# ntpd is a busybox applet, enabled by our busybox bbappend.
RDEPENDS:${PN} = "busybox"

do_install() {
    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/timesync.init ${D}${sysconfdir}/init.d/timesync

    install -d ${D}${sysconfdir}/default
    install -m 0644 ${WORKDIR}/timesync.default ${D}${sysconfdir}/default/timesync
}

CONFFILES:${PN} = "${sysconfdir}/default/timesync"
