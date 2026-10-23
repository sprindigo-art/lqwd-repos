# Shadow the stock fstab to add the /data partition mount. Upstream already
# has file://fstab in SRC_URI.
FILESEXTRAPATHS:prepend := "${THISDIR}/files:"

hostname = "lnd-rpi4"
