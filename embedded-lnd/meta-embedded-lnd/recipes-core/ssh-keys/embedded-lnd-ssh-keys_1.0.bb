SUMMARY = "Authorized SSH public keys for the lnd appliance root account"
DESCRIPTION = "Password authentication is disabled in dropbear, so these keys \
are the only way in over the network. Replace files/authorized_keys with your \
own key before building an image you intend to keep."
LICENSE = "MIT"
LIC_FILES_CHKSUM = "file://${COMMON_LICENSE_DIR}/MIT;md5=0835ade698e0bcf8506ecda2f7b4f302"

SRC_URI = "file://authorized_keys"
S = "${WORKDIR}"

do_install() {
    # Fail the build rather than ship an image nobody can log into: dropbear
    # runs with -s, so a keyless file means no network access at all.
    if ! grep -qE '^[^#[:space:]]' ${WORKDIR}/authorized_keys; then
        bbfatal "authorized_keys contains no keys - the image would be unreachable over SSH. Add a public key to meta-embedded-lnd/recipes-core/ssh-keys/files/authorized_keys"
    fi

    install -d -m 0700 ${D}/home/root/.ssh
    install -m 0600 ${WORKDIR}/authorized_keys ${D}/home/root/.ssh/authorized_keys
}

FILES:${PN} = "/home/root/.ssh"
