# Shadow the stock DHCP-on-eth0 interfaces file with the fixed LAN address.
# The upstream recipe already has file://interfaces in SRC_URI; prepending our
# files/ directory is enough to override it.
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

# Ship a static resolv.conf as well.
#
# The "dns-nameservers" line in interfaces is a resolvconf feature, and we do
# not install resolvconf - so it was silently doing nothing and the image had
# no working DNS at all. Everything used raw IPs so it went unnoticed until
# NTP needed to resolve a pool hostname.
SRC_URI += "file://resolv.conf"

do_install:append() {
    install -m 0644 ${WORKDIR}/resolv.conf ${D}${sysconfdir}/resolv.conf
}

CONFFILES:${PN} += "${sysconfdir}/resolv.conf"
