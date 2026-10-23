#!/bin/bash
# Generate the PKI on first run, then run the OpenVPN server.
#
# The VPN lives entirely inside this container's network namespace. The host
# gets no tun0, no route and no firewall change; only udp/1194 is published.
set -euo pipefail

# One bind mount at /etc/openvpn/state holds all persistent VPN state.
#
# These must be SUBDIRECTORIES of the mount, not the mount point itself:
# "easyrsa init-pki" removes and recreates the PKI directory, and you cannot
# remove a bind-mount point from inside the container.
STATE=/etc/openvpn/state
PKI="$STATE/pki"
CCD="$STATE/ccd"
OUT="$STATE/clients"
mkdir -p "$STATE"

VPN_NET="${VPN_NET:-10.99.0.0}"
VPN_MASK="${VPN_MASK:-255.255.255.0}"
VPN_PORT="${VPN_PORT:-1194}"
VPN_PUBLIC_HOST="${VPN_PUBLIC_HOST:?set VPN_PUBLIC_HOST in .env}"
RPI_VPN_IP="${RPI_VPN_IP:-10.99.0.10}"
ADMIN_VPN_IP="${ADMIN_VPN_IP:-10.99.0.20}"

export EASYRSA_BATCH=1
export EASYRSA_ALGO=ec
export EASYRSA_CURVE=secp384r1
export EASYRSA_CA_EXPIRE=3650
export EASYRSA_CERT_EXPIRE=3650
export EASYRSA_PKI="$PKI"

# Check for every artifact, not just ca.crt. A half-finished PKI used to be
# treated as complete on the next restart, which turned one failed command into
# a permanently broken container.
pki_complete() {
    [ -f "$PKI/ca.crt" ] &&
    [ -f "$PKI/issued/server.crt" ] && [ -f "$PKI/private/server.key" ] &&
    [ -f "$PKI/issued/rpi.crt" ]    && [ -f "$PKI/private/rpi.key" ] &&
    [ -f "$PKI/issued/admin.crt" ]  && [ -f "$PKI/private/admin.key" ] &&
    [ -f "$PKI/tc.key" ]
}

if pki_complete; then
    echo ">>> PKI already complete, reusing it"
else
    echo ">>> generating PKI (elliptic curve, $EASYRSA_CURVE)"
    rm -rf "$PKI"
    easyrsa init-pki
    # --req-cn is only valid for build-ca; build-server-full and
    # build-client-full take the common name as their positional argument.
    easyrsa --req-cn="embedded-lnd-ca" build-ca nopass
    easyrsa build-server-full server nopass
    easyrsa build-client-full rpi nopass
    easyrsa build-client-full admin nopass

    # tls-crypt encrypts and authenticates the whole control channel. Without
    # this key the server does not answer at all, so it is invisible to
    # internet-wide scanners.
    openvpn --genkey secret "$PKI/tc.key"
    chmod 600 "$PKI/tc.key"

    pki_complete || { echo "ERROR: PKI generation did not produce all files" >&2; exit 1; }
    echo ">>> PKI generated"
fi

echo ">>> writing client-config-dir entries"
mkdir -p "$CCD"
echo "ifconfig-push $RPI_VPN_IP $VPN_MASK"   > "$CCD/rpi"
echo "ifconfig-push $ADMIN_VPN_IP $VPN_MASK" > "$CCD/admin"

echo ">>> writing server config"
cat > /etc/openvpn/server.conf <<CONF
port $VPN_PORT
proto udp
dev tun
topology subnet
server $VPN_NET $VPN_MASK

# Fixed addresses per client.
client-config-dir $CCD

# Lets the Pi and your workstation reach each other, and both reach lnd, which
# shares this container's network namespace. Handled inside OpenVPN, so no
# kernel forwarding and no NAT is needed on the host.
client-to-client

# Split tunnel on purpose: only the VPN subnet is routed here. The Pi keeps
# using its own default route for Mutinynet.
# (no "push redirect-gateway")

ca $PKI/ca.crt
cert $PKI/issued/server.crt
key $PKI/private/server.key
tls-crypt $PKI/tc.key
dh none

cipher AES-256-GCM
data-ciphers AES-256-GCM
auth SHA256
tls-version-min 1.2
remote-cert-tls client

keepalive 10 60
persist-key
persist-tun
explicit-exit-notify 1
status /tmp/openvpn-status.log
verb 3
CONF

echo ">>> writing client configs"
mkdir -p "$OUT"
write_client() {
    name="$1"; out="$OUT/$name.ovpn"
    cat > "$out" <<CLIENT
client
dev tun
proto udp
remote $VPN_PUBLIC_HOST $VPN_PORT
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
cipher AES-256-GCM
data-ciphers AES-256-GCM
auth SHA256
tls-version-min 1.2
verb 3

<ca>
$(cat "$PKI/ca.crt")
</ca>
<cert>
$(openssl x509 -in "$PKI/issued/$name.crt")
</cert>
<key>
$(cat "$PKI/private/$name.key")
</key>
<tls-crypt>
$(cat "$PKI/tc.key")
</tls-crypt>
CLIENT
    chmod 600 "$out"
    echo "    $out"
}
write_client rpi
write_client admin

echo ">>> starting openvpn"
exec openvpn --config /etc/openvpn/server.conf
