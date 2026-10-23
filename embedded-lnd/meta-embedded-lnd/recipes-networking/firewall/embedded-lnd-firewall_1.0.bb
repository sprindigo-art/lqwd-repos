SUMMARY = "Default-deny iptables ruleset for the LAN-only lnd appliance"
DESCRIPTION = "INPUT policy DROP. Inbound is limited to SSH from the local \
LAN and ICMP echo; outbound is unrestricted so lnd can reach Lightning peers \
and neutrino. Nothing from the internet can initiate a connection."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://iptables.rules \
           file://firewall.init \
"
S = "${WORKDIR}"

inherit update-rc.d

INITSCRIPT_NAME = "firewall"
# Start at 39, immediately BEFORE networking (40), so no interface is ever up
# without the ruleset loaded.
INITSCRIPT_PARAMS = "start 39 S . stop 89 0 6 ."

RDEPENDS:${PN} = "iptables"

do_install() {
    install -d ${D}${sysconfdir}/iptables
    install -m 0600 ${WORKDIR}/iptables.rules ${D}${sysconfdir}/iptables/rules.v4

    install -d ${D}${sysconfdir}/init.d
    install -m 0755 ${WORKDIR}/firewall.init ${D}${sysconfdir}/init.d/firewall
}

FILES:${PN} += "${sysconfdir}/iptables"
CONFFILES:${PN} = "${sysconfdir}/iptables/rules.v4"
