# Shadow /etc/default/dropbear to bind SSH to the LAN address and disable
# passwords and port forwarding. Upstream already installs this file.
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"
