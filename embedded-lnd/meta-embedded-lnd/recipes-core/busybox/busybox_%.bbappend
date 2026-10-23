# Enable the ntpd applet. The Pi 4 has no RTC, so without a time source it
# boots believing it is 2018 and OpenVPN rejects the server certificate as
# not-yet-valid. busybox ntpd costs about 10KB, against ~500KB for chrony or
# the reference ntp daemon.
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

SRC_URI += "file://ntpd.cfg"
